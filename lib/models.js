// Finds the newest Opus and the newest Sonnet, so every agent and chat upgrades
// on its own when Anthropic releases a new model. Anthropic has no "latest" name
// for these, so this asks the Models API which models exist and picks the most
// recently released one in each family. The answer is remembered for an hour;
// if the lookup fails, it uses the fallback below.

const FALLBACK = { opus: "claude-opus-5-5", sonnet: "claude-sonnet-5-5" };
const ONE_HOUR = 60 * 60 * 1000;
let cached = { models: null, at: 0 };

async function lookup(anthropic) {
  const newest = {};
  for await (const m of anthropic.models.list()) {
    // Plain family models only, e.g. claude-opus-5-5 (skips variants such as "-fast").
    const family = m.id.match(/^claude-(opus|sonnet)-\d+(-\d+)?$/)?.[1];
    if (!family) continue;
    if (!newest[family] || new Date(m.created_at) > new Date(newest[family].created_at)) newest[family] = m;
  }
  return { opus: newest.opus?.id || FALLBACK.opus, sonnet: newest.sonnet?.id || FALLBACK.sonnet };
}

/** family: "opus" or "sonnet" */
export async function latestModel(anthropic, family) {
  if (!cached.models || Date.now() - cached.at >= ONE_HOUR) {
    try {
      cached = { models: await lookup(anthropic), at: Date.now() };
    } catch (err) {
      console.error("[models] couldn't check for the newest models:", err.message);
    }
  }
  return cached.models?.[family] || FALLBACK[family];
}
