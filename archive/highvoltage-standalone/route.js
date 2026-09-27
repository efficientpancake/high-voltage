// High Voltage — server route. Generates crypto-native social content with Claude.
// Runs on the server; the API key never reaches the browser. Streams text back.
import Anthropic from "@anthropic-ai/sdk";

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const VIBES = {
  builder:
    "a measured, credible builder. Technical when it counts, dry wit allowed, substance over hype. Talks like someone actually shipping.",
  degen:
    "high-energy and crypto-native. Playful, irreverent, meme-aware, fast. Still sharp and never cringe or try-hard.",
  visionary:
    "conviction-heavy and big-picture. Paints where the world is going and makes people believe. Bold but not vague.",
  clean:
    "clean, confident, human. Professional without the corporate stiffness. Clear and direct.",
};

function buildSystem({ voiceSamples, vibe }) {
  const voiceBlock = voiceSamples?.trim()
    ? `The founder pasted samples of their own posts below. Mirror their voice closely:
diction, sentence length, rhythm, capitalization habits, emoji use (or none), and slang.
Sound like THEM, not like a generic crypto account.

THEIR SAMPLES:
"""
${voiceSamples.trim()}
"""`
    : `No voice samples were given. Default voice: ${VIBES[vibe] || VIBES.builder}`;

  return `You are a world-class crypto Twitter ghostwriter who has run social for real
crypto projects and understands how Crypto Twitter (CT) actually talks. You write
content founders are proud to post.

${voiceBlock}

HARD RULES (anti-AI-slop, tuned for Crypto Twitter):
- Write like a sharp human on CT, not like a brand or a press release.
- First line is a real hook. No "Excited to announce", no "We are thrilled".
- No hashtag stuffing. At most one, only if it genuinely fits. Usually zero.
- Concrete beats vague. Name the specific thing. No vague declaratives like
  "the implications are significant" — say what the implication actually is.
- Active voice. A human or the project is doing something. No passive constructions,
  no inanimate things performing human verbs ("the roadmap delivers value").
- Cut adverbs and filler. No throat-clearing openers ("Here's the thing", "Let's
  be real" unless it's genuinely the voice). Get to the point.
- No "not X, it's Y" contrast scaffolding. State Y directly.
- No AI tells: avoid "delve", "robust", "game-changer", "revolutionize", "unlock",
  "in the ever-evolving world of", "seamless", and similar filler.
- No em dashes. Use line breaks, periods, and short lines for rhythm.
- Vary sentence length. Don't let three sentences in a row match.
- CT EXCEPTIONS (keep these, they are native, not slop): punchy one-line takes,
  deliberate fragments, and a strong quotable closer are good here. Use them on purpose.
- Match the energy of the chosen voice; never sound corporate or desperate.

SAFETY (protect the founder): never make price predictions, promise returns, guarantee
gains, or write anything that reads as financial advice. Hype the product and the
vision, not the token's price.

Output ONLY the post content, ready to paste. No preamble, no explanations, no labels
unless the format needs them (e.g. numbering a thread).`;
}

function buildUser({ project, topic, outputType, tweak }) {
  const formats = {
    thread:
      "Write a Twitter/X THREAD (5-8 tweets). Number them (1/, 2/, ...). Strong hook tweet, each tweet earns the next, end with a clear CTA or punchy closer.",
    posts:
      "Write 3 standalone tweets (each under 280 chars) that could each stand alone. Vary the angle: one hook/bold take, one concrete/proof, one community/CTA.",
    announcement:
      "Write ONE launch/announcement post (can be a short thread of 2-4 if it needs it). Make it feel like an event, not a memo.",
    replies:
      "Write 3 sharp reply/quote-tweet options the founder could use to jump into conversations and grow, in their voice.",
  };

  let u = `PROJECT (what they're building):
${project?.trim() || "(not specified)"}

WHAT TO POST ABOUT (this specific update/idea):
${topic?.trim() || "(not specified — infer something sensible from the project)"}

FORMAT:
${formats[outputType] || formats.posts}`;

  if (tweak?.trim()) {
    u += `\n\nADJUSTMENT for this regeneration (apply it): ${tweak.trim()}`;
  }
  return u;
}

export async function POST(req) {
  const body = await req.json();

  if (!process.env.ANTHROPIC_API_KEY) {
    return new Response("Server is missing ANTHROPIC_API_KEY.", { status: 500 });
  }

  const system = buildSystem(body);
  const userMsg = buildUser(body);
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      try {
        const s = anthropic.messages.stream({
          model: "claude-sonnet-4-6",
          max_tokens: 4000,
          system,
          messages: [{ role: "user", content: userMsg }],
        });
        for await (const event of s) {
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
