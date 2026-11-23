// This is a Next.js API route — it runs on the server, never in the browser.
// It streams Claude's response back to the client in real-time.
import Anthropic from "@anthropic-ai/sdk";
import { cookies } from "next/headers";
import { getServerSupabase } from "../../../lib/supabase";
import { keyForEmail } from "../../../lib/keys";
import { webSearchBlock } from "../../../lib/tavily";
import { latestModel } from "../../../lib/models";

// Let long responses keep streaming on Vercel (seconds) instead of timing out.
export const maxDuration = 300;

// Writing rules applied to every agent and every chat reply, in Amp and Spark.
// Brand-agnostic: works for any founder.
const WRITING_RULES = `You work for Voltage Labs, a team that helps founders and brands research ideas and write content.

HARD RULES (anti-AI-slop) for everything you write:
- Write like a sharp human, not like a brand or a press release.
- First line is a real hook. No "Excited to announce", no "We are thrilled".
- No hashtag stuffing. Only where the platform genuinely expects them.
- Concrete beats vague. Name the specific thing. No vague declaratives like
  "the implications are significant". Say what the implication actually is.
- Active voice. A human or the brand is doing something. No passive constructions,
  no inanimate things performing human verbs ("the roadmap delivers value").
- Cut adverbs and filler. No throat-clearing openers ("Here's the thing", "Let's
  be real") unless it's genuinely the voice. Get to the point.
- No "not X, it's Y" contrast scaffolding. State Y directly.
- No AI tells: avoid "delve", "robust", "game-changer", "revolutionize", "unlock",
  "in the ever-evolving world of", "seamless", and similar filler.
- No em dashes. Use line breaks, periods, and short lines for rhythm.
- Vary sentence length. Don't let three sentences in a row match.
- Punchy one-line takes, deliberate fragments, and a strong quotable closer are
  fine when they suit the platform and the voice. Use them on purpose.
- If the brief includes the person's own posts, mirror their voice closely:
  diction, sentence length, rhythm, capitalization habits, emoji use (or none).
  Sound like THEM, not like a generic account.
- Never invent statistics, testimonials, or results.

STRANGER TEST (every post, hook and idea must pass it):
- Write for a stranger: someone who has never heard of this person or brand and
  sees the post cold in their feed.
- No product names, project names, internal terms or jargon unless the same
  sentence explains them in plain words.
- Open with a problem or moment the reader already knows, in their own words.
  The person's own story comes second, as the proof.
- Every post needs one point a reader could repeat back in a single sentence.
  If you can't state that point, don't write the post.`;

export async function POST(req) {
  const { prompt, messages, agentIndex, isChat, app, webSearch } = await req.json();

  // Bill this person's usage to their own Anthropic key if they have one (see
  // lib/keys.js). The email comes from the signed-in session on the server,
  // never from anything the browser sends.
  const { data: { user } } = await getServerSupabase(await cookies()).auth.getUser();
  const anthropic = new Anthropic({ apiKey: keyForEmail(user?.email) });

  // The deepest-thinking agents use the newest Opus; everything else, including
  // follow-up chat, uses the newest Sonnet (see lib/models.js).
  //   Amp:   Brand Strategist (0), Post Writer (3), Contrarian (5)
  //   Spark: Researcher (0), Steel Man (3), Contrarian (4)
  const OPUS_AGENTS = app === "spark" ? [0, 3, 4] : [0, 3, 5];
  const model = await latestModel(anthropic, !isChat && OPUS_AGENTS.includes(agentIndex) ? "opus" : "sonnet");

  // 128K is the maximum output for both models, so responses never get cut off.
  // You're only billed for tokens actually generated, not this ceiling.
  const maxTokens = 128000;

  // Accept either a messages array (for chat) or a single prompt string
  let messageArray = messages || [{ role: "user", content: prompt }];

  // Spark's Researcher gets live web search results, fetched here on the server
  // so the search key never reaches the browser. They go at the end of the last
  // message, after the cached brief, so the cache still works.
  if (app === "spark" && typeof webSearch === "string" && webSearch.trim()) {
    const results = await webSearchBlock(webSearch.trim());
    messageArray = messageArray.map((m, i) => {
      if (i !== messageArray.length - 1) return m;
      const extra = { type: "text", text: results };
      return { ...m, content: Array.isArray(m.content) ? [...m.content, extra] : [{ type: "text", text: m.content }, extra] };
    });
  }

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      try {
        const anthropicStream = anthropic.messages.stream({
          model,
          max_tokens: maxTokens,
          system: WRITING_RULES,
          messages: messageArray,
        });

        for await (const event of anthropicStream) {
          if (
            event.type === "content_block_delta" &&
            event.delta?.type === "text_delta"
          ) {
            controller.enqueue(encoder.encode(event.delta.text));
          }
        }
        controller.close();
      } catch (err) {
        controller.enqueue(encoder.encode(`\n\nError: ${err.message}`));
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
}
