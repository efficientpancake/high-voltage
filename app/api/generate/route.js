// This is a Next.js API route — it runs on the server, never in the browser.
// It streams Claude's response back to the client in real-time.
import Anthropic from "@anthropic-ai/sdk";

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

export async function POST(req) {
  const { prompt, messages, agentIndex, isChat } = await req.json();

  // Brand Strategist (0) and Contrarian (5) use Opus — they do the deepest thinking.
  // Chat always uses Sonnet for good conversation quality without Opus cost.
  const model = isChat
    ? "claude-sonnet-4-6"
    : (agentIndex === 0 || agentIndex === 3 || agentIndex === 5)
      ? "claude-opus-4-6"
      : "claude-haiku-4-5-20251001";

  const maxTokens = 8000;

  // Accept either a messages array (for chat) or a single prompt string
  const messageArray = messages || [{ role: "user", content: prompt }];

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      try {
        const anthropicStream = anthropic.messages.stream({
          model,
          max_tokens: maxTokens,
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
