// Tavily: live web search for Spark's Researcher, and reading a web page so a
// link can be added as research material. Server-only: the key never reaches the
// browser, and this server never fetches arbitrary addresses itself (Tavily
// does), so a user can't point it at private or internal addresses.

const TIMEOUT_MS = 15000;

async function tavily(path, body) {
  const apiKey = process.env.TAVILY_API_KEY;
  if (!apiKey) throw new Error("TAVILY_API_KEY is not set");
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`https://api.tavily.com/${path}`, {
      method: "POST",
      // Search takes the key in the body and page reading in a header, matching
      // the calls that already work in Kitchen Cabinet.
      headers: path === "extract"
        ? { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` }
        : { "Content-Type": "application/json" },
      body: JSON.stringify(path === "extract" ? body : { api_key: apiKey, ...body }),
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`Tavily ${path} failed: ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timeout);
  }
}

async function search(query) {
  const data = await tavily("search", { query, search_depth: "advanced", max_results: 5, include_answer: false });
  return (data.results || []).map(r => `Title: ${r.title}\nURL: ${r.url}\nContent: ${r.content}`).join("\n\n---\n\n");
}

/**
 * Three searches around the topic, formatted for the Researcher. Never throws:
 * if search is unavailable, the Researcher is told so and works from the
 * materials alone.
 */
export async function webSearchBlock(topic) {
  if (!process.env.TAVILY_API_KEY) {
    return "(Live web search is not set up, so work only from the materials provided and say that you did.)";
  }
  const queries = [topic, `${topic} latest data and research`, `${topic} criticism and counterarguments`];
  const settled = await Promise.allSettled(queries.map(search));
  const blocks = settled.filter(r => r.status === "fulfilled" && r.value).map(r => r.value);
  if (!blocks.length) return "(Live web search returned nothing this time. Work from the materials provided and say so.)";
  return `LIVE WEB SEARCH RESULTS (cite these by title and URL when you use them):\n\n${blocks.join("\n\n===\n\n")}\n\nEND OF SEARCH RESULTS`;
}

export class WebPageError extends Error {}

/** Read a public web page as plain text, for adding a link as research material. */
export async function readWebPage(raw) {
  const trimmed = String(raw || "").trim();
  if (!trimmed) throw new WebPageError("Paste a website address first.");
  let url;
  try {
    url = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`);
  } catch {
    throw new WebPageError("That doesn't look like a website address.");
  }
  if (!["http:", "https:"].includes(url.protocol) || !url.hostname.includes(".")) {
    throw new WebPageError("That doesn't look like a website address.");
  }
  if (/(^|\.)(docs|drive)\.google\.com$/i.test(url.hostname)) {
    throw new WebPageError("Google Docs links are private. In Google Docs, click File, then Download, then Plain text (.txt), and upload that file instead.");
  }
  if (!process.env.TAVILY_API_KEY) throw new WebPageError("Reading links isn't set up yet (no Tavily key).");

  let data;
  try {
    data = await tavily("extract", { urls: [url.toString()], extract_depth: "basic", format: "markdown" });
  } catch (err) {
    if (err.name === "AbortError") throw new WebPageError("That page took too long to load. Try again, or copy the text instead.");
    throw err;
  }
  const text = (data.results?.[0]?.raw_content || "").replace(/\r\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  if (!text) throw new WebPageError("Couldn't read that page. It may need a login, block automated readers, or not exist. Try copying the text instead.");
  return { url: url.toString(), name: url.hostname.replace(/^www\./, "") + url.pathname.replace(/\/$/, ""), text: text.slice(0, 200000) };
}
