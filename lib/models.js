// Finds the newest Opus model, so the Opus agents upgrade on their own when
// Anthropic releases a new one. Anthropic has no "latest Opus" name, so this asks
// the Models API which models exist and picks the most recently released Opus.
// The answer is remembered for an hour; if the lookup fails, it uses FALLBACK.

const FALLBACK = "claude-opus-5-5";
const ONE_HOUR = 60 * 60 * 1000;
let cached = { model: null, at: 0 };

export async function latestOpus(anthropic) {
  if (cached.model && Date.now() - cached.at < ONE_HOUR) return cached.model;
  try {
    let newest = null;
    for await (const m of anthropic.models.list()) {
      // Plain Opus models only (skips special variants such as "-fast").
      if (!/^claude-opus-\d+(-\d+)?$/.test(m.id)) continue;
      if (!newest || new Date(m.created_at) > new Date(newest.created_at)) newest = m;
    }
    cached = { model: newest?.id || FALLBACK, at: Date.now() };
  } catch (err) {
    console.error("[models] couldn't check for the newest Opus:", err.message);
    return cached.model || FALLBACK;
  }
  return cached.model;
}
