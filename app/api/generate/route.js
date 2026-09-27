// This is a Next.js API route — it runs on the server, never in the browser.
// It streams Claude's response back to the client in real-time.
import Anthropic from "@anthropic-ai/sdk";

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// Let long responses keep streaming on Vercel (seconds) instead of timing out.
export const maxDuration = 300;

// Writing rules applied to every agent and every chat reply (merged in from the
// old standalone High Voltage generator). Brand-agnostic: works for any founder.
const WRITING_RULES = `You work for High Voltage, a content team for founders and brands.

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
- Never invent statistics, testimonials, or results.`;

export async function POST(req) {
  const { prompt, messages, agentIndex, isChat } = await req.json();

  // Brand Strategist (0), Post Writer (3) and Contrarian (5) use Opus 5.5 for the
  // deepest thinking. Everything else, including follow-up chat, uses Sonnet 5.
  const model = !isChat && [0, 3, 5].includes(agentIndex)
    ? "claude-opus-5-5"
    : "claude-sonnet-5";

  // 128K is the maximum output for both models, so responses never get cut off.
  // You're only billed for tokens actually generated, not this ceiling.
  const maxTokens = 128000;

  // Accept either a messages array (for chat) or a single prompt string
  const messageArray = messages || [{ role: "user", content: prompt }];

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
