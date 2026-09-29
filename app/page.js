"use client";

import { useState, useRef, useEffect } from "react";
import Workspace from "./Workspace";
import { docxToText, pdfToText } from "../lib/extractText";

// ─── Agent definitions ────────────────────────────────────────────────────────

const AGENTS = [
  { index: 0, name: "Brand Strategist", icon: "🧭", desc: "Positioning, tone of voice, content pillars",      model: "Opus 5.5",  conditional: false },
  { index: 1, name: "Content Auditor",  icon: "🔍", desc: "What's working, what's not, what's missing",       model: "Sonnet 5",  conditional: true  },
  { index: 2, name: "Content Ideator",  icon: "💡", desc: "Post ideas, angles, and hooks",                    model: "Sonnet 5",  conditional: false },
  { index: 3, name: "Post Writer",      icon: "✍️",  desc: "Platform-specific posts ready to publish",        model: "Opus 5.5",   conditional: false },
  { index: 4, name: "Repurposer",       icon: "🔄", desc: "One piece across every platform",                  model: "Sonnet 5",  conditional: true  },
  { index: 5, name: "Contrarian",       icon: "⚔️",  desc: "What won't work and why",                         model: "Opus 5.5",   conditional: false },
];

const ANALYTICS_TAB = 99; // special tab index for LinkedIn analytics

const PLATFORMS = ["LinkedIn", "Twitter/X", "Instagram", "TikTok", "Facebook", "Bluesky"];
const TONES     = ["Professional", "Conversational", "Bold & provocative", "Inspirational", "Educational", "Humorous"];

const defaultBrief = {
  name: "", role: "", industry: "", goal: "",
  platforms: [], audience: "", tone: "Conversational",
  hasExistingContent: false, existingContent: "",
  challenge: "", differentiator: "",
};

// ─── CSV parser ───────────────────────────────────────────────────────────────

function parseCSVLine(line) {
  const result = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    if (line[i] === '"') { inQuotes = !inQuotes; }
    else if (line[i] === "," && !inQuotes) { result.push(current); current = ""; }
    else { current += line[i]; }
  }
  result.push(current);
  return result.map(v => v.trim().replace(/^"|"$/g, ""));
}

function parseCSV(text) {
  const lines = text.split(/\r?\n/).filter(l => l.trim());
  if (lines.length < 2) return { headers: [], rows: [] };
  const headers = parseCSVLine(lines[0]);
  const rows = lines.slice(1).map(line => {
    const vals = parseCSVLine(line);
    const row = {};
    headers.forEach((h, i) => { row[h] = vals[i] || ""; });
    return row;
  }).filter(r => Object.values(r).some(v => v));
  return { headers, rows };
}

// Find a column by trying multiple possible names
function findCol(headers, candidates) {
  return headers.find(h => candidates.some(c => h.toLowerCase().includes(c.toLowerCase())));
}

// "12,345" → 12345. Spreadsheet cells often arrive formatted with commas.
function toNum(v) {
  const n = parseInt(String(v ?? "").replace(/[^\d-]/g, ""), 10);
  return Number.isNaN(n) ? 0 : n;
}

// Turn one table (headers + row objects) into posts. `requirePostCols` skips
// tables with neither post text nor post links, e.g. a sheet of daily totals.
function parseRows(headers, rows, filename, { requirePostCols = false } = {}) {
  const hasMetrics = headers.some(h => /impression|click|reaction|engagement/i.test(h));
  const hasPostText = headers.some(h => /commentary|sharecommentary|post|text|content/i.test(h));

  const textCol       = findCol(headers, ["ShareCommentary", "commentary", "text", "content", "description"]);
  const urlCol        = findCol(headers, ["url", "link"]);
  const dateCol       = findCol(headers, ["Date", "date", "created", "published"]);
  const impressionCol = findCol(headers, ["Impressions", "impression", "views", "reach"]);
  const clickCol      = findCol(headers, ["Clicks", "click"]);
  const reactionCol   = findCol(headers, ["Reactions", "reaction", "likes", "like"]);
  const commentCol    = findCol(headers, ["Comments", "comment"]);
  const repostCol     = findCol(headers, ["Reposts", "repost", "shares", "reshares"]);
  const engagementCol = findCol(headers, ["Engagements", "engagement"]);

  if (requirePostCols && !textCol && !urlCol) return null;

  // Without a named text column, fall back to the first long value that isn't a link.
  const guessText = row => Object.values(row).find(v => v.length > 30 && !/^https?:\/\//i.test(v)) || "";

  const posts = rows.map(row => ({
    date:        dateCol       ? row[dateCol]  : "",
    text:        textCol       ? row[textCol]  : guessText(row),
    url:         urlCol        ? row[urlCol]   : "",
    impressions: impressionCol ? toNum(row[impressionCol]) : null,
    clicks:      clickCol      ? toNum(row[clickCol])      : null,
    reactions:   reactionCol   ? toNum(row[reactionCol])   : null,
    comments:    commentCol    ? toNum(row[commentCol])    : null,
    reposts:     repostCol     ? toNum(row[repostCol])     : null,
    engagements: engagementCol ? toNum(row[engagementCol]) : null,
  })).filter(p => p.text || p.url || p.impressions);

  return { filename, headers, posts, hasMetrics, hasPostText: posts.some(p => p.text), isPostData: Boolean(textCol || urlCol || hasMetrics) };
}

function parseSocialData(csvText, filename) {
  const { headers, rows } = parseCSV(csvText);
  if (!headers.length) return null;
  return parseRows(headers, rows, filename);
}

// ─── Excel (.xlsx / .xls) ─────────────────────────────────────────────────────

// Split a sheet (array of rows) into tables. The header row is the first row with
// 2+ filled cells (LinkedIn puts a note above it). Tables sitting side by side,
// separated by an empty column, become separate tables.
function tablesFromGrid(grid) {
  const cell = v => String(v ?? "").trim();
  const headerIdx = grid.findIndex(r => r.filter(v => cell(v)).length >= 2);
  if (headerIdx < 0) return [];
  const headerRow = grid[headerIdx].map(cell);
  const body = grid.slice(headerIdx + 1);

  const runs = [];
  let start = -1;
  for (let i = 0; i <= headerRow.length; i++) {
    if (i < headerRow.length && headerRow[i]) { if (start < 0) start = i; }
    else if (start >= 0) { runs.push([start, i]); start = -1; }
  }

  const tables = runs.map(([from, to]) => {
    const headers = headerRow.slice(from, to);
    const rows = body
      .map(r => Object.fromEntries(headers.map((h, j) => [h, cell(r[from + j])])))
      .filter(r => Object.values(r).some(Boolean));
    return { headers, rows };
  });

  // LinkedIn's "Top posts" sheet has two side-by-side lists (by engagements and by
  // impressions), each keyed by post URL. Merge them into one row per post.
  const urlOf = t => findCol(t.headers, ["url", "link"]);
  if (tables.length > 1 && tables.every(urlOf)) {
    const merged = new Map();
    for (const t of tables) {
      const u = urlOf(t);
      for (const r of t.rows) if (r[u]) merged.set(r[u], { ...(merged.get(r[u]) || {}), ...r });
    }
    return [{ headers: [...new Set(tables.flatMap(t => t.headers))], rows: [...merged.values()] }];
  }
  return tables;
}

async function spreadsheetToText(file) {
  const XLSX = await import("xlsx");
  const wb = XLSX.read(await file.arrayBuffer(), { cellDates: true });
  return wb.SheetNames.map(n => `--- Sheet: ${n} ---\n${XLSX.utils.sheet_to_csv(wb.Sheets[n])}`).join("\n\n");
}

const wordCount = text => (text.match(/\S+/g) || []).length;

async function parseSpreadsheet(file) {
  const XLSX = await import("xlsx"); // loaded only when someone uploads a spreadsheet
  const wb = XLSX.read(await file.arrayBuffer(), { cellDates: true });
  const found = [];
  for (const name of wb.SheetNames) {
    const grid = XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, raw: false, defval: "" });
    for (const { headers, rows } of tablesFromGrid(grid)) {
      const data = parseRows(headers, rows, file.name, { requirePostCols: true });
      if (data?.posts.length) found.push(data);
    }
  }
  if (!found.length) return null;
  return {
    filename: file.name,
    headers: [...new Set(found.flatMap(d => d.headers))],
    posts: found.flatMap(d => d.posts),
    hasMetrics: found.some(d => d.hasMetrics),
    hasPostText: found.some(d => d.hasPostText),
  };
}

// ─── Prompt builder ────────────────────────────────────────────────────────────

function buildPrompts(brief, socialFiles, docs = []) {
  const platformList = brief.platforms.length ? brief.platforms.join(", ") : "all major platforms";
  const existingBlock = brief.hasExistingContent && brief.existingContent
    ? `\n\nEXISTING CONTENT:\n${brief.existingContent}` : "";

  // Add social media data to context if available
  let linkedInBlock = "";
  if (socialFiles.length > 0) {
    const allPosts = socialFiles.flatMap(f => f.posts).slice(0, 50);
    const hasMetrics = socialFiles.some(f => f.hasMetrics);
    const label = p => p.text ? `"${p.text.slice(0, 120)}..."` : `Post ${p.url || "(no link)"}`;
    const metric = (name, v) => v != null ? ` | ${name}: ${v}` : "";
    if (hasMetrics) {
      const topPosts = [...allPosts]
        .filter(p => p.impressions)
        .sort((a, b) => (b.impressions || 0) - (a.impressions || 0))
        .slice(0, 10);
      linkedInBlock = `\n\nSOCIAL MEDIA ANALYTICS DATA:\n` +
        (allPosts.some(p => p.text) ? "" : "(This export has performance metrics and post links only. It does not include the text of the posts, so don't claim to have read them.)\n") +
        topPosts.map(p => `- ${label(p)}${p.date ? ` | Date: ${p.date}` : ""}${metric("Impressions", p.impressions)}${metric("Engagements", p.engagements)}${metric("Reactions", p.reactions)}${metric("Comments", p.comments)}${metric("Clicks", p.clicks)}`).join("\n");
    } else {
      linkedInBlock = `\n\nSOCIAL MEDIA POSTS (${allPosts.length} posts):\n` +
        allPosts.slice(0, 20).map(p => `[${p.date}] ${p.text?.slice(0, 200)}`).join("\n\n");
    }
  }

  const ctx = `BRAND BRIEF:
Name/Handle: ${brief.name || "Not specified"}
Role/Title: ${brief.role || "Not specified"}
Industry/Niche: ${brief.industry || "Not specified"}
Goal: ${brief.goal || "Not specified"}
Target Audience: ${brief.audience || "Not specified"}
Platforms: ${platformList}
Tone of Voice: ${brief.tone}
Biggest Challenge: ${brief.challenge || "Not specified"}
What Makes Them Different: ${brief.differentiator || "Not specified"}${existingBlock}${linkedInBlock}${docsBlock(docs)}`;

  // `shared` is identical for every agent and chat, so it's cached once per model.
  // Each task refers back to it instead of repeating it.
  const tasks = [
    `You are an expert social media brand strategist.\n\nDeliver:\n1. Positioning statement (2–3 sentences)\n2. Tone of voice — how they should sound, language to use and avoid\n3. 3–5 content pillars — the core themes they should own\n4. Platform strategy — which to prioritise and why\n5. What to stop doing immediately\n\nBe specific. No generic advice.`,

    `You are a sharp social media content analyst.\n\nAudit their content${linkedInBlock ? " using the social data provided" : ""}:\n1. What's working and why\n2. What's not working — weak patterns, missed opportunities\n3. Gaps — missing topics, formats, angles\n4. Voice consistency — clear positioning or scattered?\n5. Top 3 highest-impact changes to make now\n\nBe direct. Don't soften criticism.`,

    `You are a creative social media strategist specialising in thought leadership.\n\nGenerate 10 specific post ideas. For each:\n- A compelling hook\n- Best platforms\n- Why it resonates with their audience\n- Difficulty: Easy / Medium / Challenging\n\nMix formats. Prioritise non-obvious angles specific to their niche.`,

    `You are an expert social media copywriter.\n\nWrite one complete, publish-ready post for EACH of the following platforms: ${platformList}.\n\nFor each post, label it clearly with the platform name, then write the post in the correct format and length for that platform. First person. If their existing posts are included, write in that voice. Each distinct in angle. Do not write posts for any platform not listed.`,

    `You are a content repurposing expert.\n\nRepurpose the existing content into:\n1. LinkedIn (150–300 words)\n2. Twitter/X thread (5–7 tweets)\n3. Instagram caption with hashtags\n4. TikTok script (60–90 sec)\n5. Facebook post\n6. Bluesky post\n\nAdapt tone and format for each platform.`,

    `You are a brutally honest social media critic.\n\nTear apart this brand\'s strategy and everything your team produced:\n1. What is painfully generic\n2. Which ideas won't land and why\n3. Where they're being inauthentic\n4. What assumptions are wrong\n5. What their audience will actually ignore\n6. The single biggest mistake they're about to make\n7. What a truly distinctive version would look like\n\nRank from most fatal to least fatal.`,
  ];

  return { shared: ctx, tasks };
}

// Uploaded text files, handed to every agent as background material.
function docsBlock(docs) {
  if (!docs.length) return "";
  return "\n\nPROJECT FILES (background material the user uploaded for this project):\n" +
    docs.map(d => `\n=== ${d.name} ===\n${d.text}`).join("\n");
}

// ─── Agent pipeline ──────────────────────────────────────────────────────────
// Agents run in stages so later ones can read earlier ones' work. The first
// stage also fills the prompt cache (one per model), so later agents read the
// brief and files at a fraction of the price.
const STAGES = [[0, 1], [2, 4], [3], [5]];
const READS_FROM = { 0: [], 1: [], 2: [0, 1], 4: [0, 1], 3: [0, 1, 2], 5: [0, 1, 2, 3, 4] };
const agentName = i => AGENTS.find(a => a.index === i)?.name;

// The shared brief + files block, marked for caching. Kept for an hour so it
// still hits the cache for later stages and follow-up chats.
const cachedBlock = text => ({ type: "text", text, cache_control: { type: "ephemeral", ttl: "1h" } });

function agentMessages({ shared, tasks }, agentIndex, teamOutputs) {
  const team = READS_FROM[agentIndex]
    .filter(i => teamOutputs[i])
    .map(i => `## ${agentName(i)}\n${teamOutputs[i]}`)
    .join("\n\n");
  const task = tasks[agentIndex] + (team
    ? `\n\nYOUR TEAM'S WORK SO FAR. Build on it and stay consistent with it. Don't repeat it:\n\n${team}`
    : "");
  return [{ role: "user", content: [cachedBlock(shared), { type: "text", text: task }] }];
}

// ─── Markdown renderer ─────────────────────────────────────────────────────────

function parseInline(text, key) {
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  return parts.map((part, i) =>
    part.startsWith("**") && part.endsWith("**")
      ? <strong key={i}>{part.slice(2, -2)}</strong>
      : part
  );
}

function renderMarkdown(text) {
  if (!text) return null;
  return text.split(/\r?\n/).map((rawLine, i) => {
    const line = rawLine.trimEnd();
    const h3 = line.match(/^###\s+(.+)/);  if (h3) return <h3 key={i} className="md-h3">{parseInline(h3[1])}</h3>;
    const h2 = line.match(/^##\s+(.+)/);   if (h2) return <h2 key={i} className="md-h2">{parseInline(h2[1])}</h2>;
    const h1 = line.match(/^#\s+(.+)/);    if (h1) return <h1 key={i} className="md-h1">{parseInline(h1[1])}</h1>;
    if (line.trim() === "---" || line.trim() === "***") return <hr key={i} className="md-hr" />;
    if (/^[\s]*[-*+] /.test(line)) return <li key={i} className="md-li">{parseInline(line.replace(/^[\s]*[-*+] /, ""))}</li>;
    if (/^\d+\. /.test(line))      return <li key={i} className="md-li md-oli">{parseInline(line.replace(/^\d+\. /, ""))}</li>;
    if (line.trim() === "")        return <div key={i} className="md-spacer" />;
    return <p key={i} className="md-p">{parseInline(line)}</p>;
  });
}

// ─── Main component ────────────────────────────────────────────────────────────

export default function Page() {
  return (
    <Workspace>
      {(project, onChange, onNewProject) => (
        <Studio key={project.id} project={project} onChange={onChange} onNewProject={onNewProject} />
      )}
    </Workspace>
  );
}

// An agent that was mid-stream when the page closed can't resume; mark it so the
// Retry button shows instead of a spinner that never ends.
function settleOutputs(outputs = {}) {
  return Object.fromEntries(Object.entries(outputs).filter(([, o]) => o?.status !== "queued").map(([k, o]) =>
    [k, o?.status === "streaming" ? { ...o, status: "error", text: (o.text || "") + "\n\n(Interrupted. Hit Retry to run it again.)" } : o]));
}

function Studio({ project, onChange, onNewProject }) {
  const [view, setView]               = useState(project.view || "wizard");
  const [step, setStep]               = useState(0);
  const [brief, setBrief]             = useState({ ...defaultBrief, ...project.brief });
  const [outputs, setOutputs]         = useState(() => settleOutputs(project.outputs));
  const [activeTab, setActiveTab]     = useState(project.active_tab || 0);
  const [running, setRunning]         = useState(false);
  // Project files, saved with the project: parsed social exports + plain text docs.
  const [socialFiles, setSocialFiles] = useState(project.files?.social || []);
  const [docs, setDocs]               = useState(project.files?.docs || []); // [{ name, text, added_at }]
  const [toast, setToast]             = useState({ msg: "", show: false, error: false });

  // Chat state per agent
  const [chatHistories, setChatHistories] = useState(project.chats || {});
  const [chatInputs, setChatInputs]       = useState({}); // { agentIndex: string }
  const [chatStreaming, setChatStreaming]  = useState({}); // { agentIndex: boolean }

  // Report every change to the Workspace, which autosaves it to the cloud.
  // Skip the first render: that's just the project we loaded.
  const firstRender = useRef(true);
  useEffect(() => {
    if (firstRender.current) { firstRender.current = false; return; }
    onChange({ view, brief, outputs, active_tab: activeTab, chats: chatHistories, files: { docs, social: socialFiles } });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, brief, outputs, activeTab, chatHistories, docs, socialFiles]);

  // ─── Brief helpers ──────────────────────────────────────────────────────────

  const update = (field, val) => setBrief(p => ({ ...p, [field]: val }));
  const togglePlatform = (p) => setBrief(prev => ({
    ...prev,
    platforms: prev.platforms.includes(p)
      ? prev.platforms.filter(x => x !== p)
      : [...prev.platforms, p],
  }));

  // ─── Project files upload ───────────────────────────────────────────────────
  // Text files become background docs. CSV/Excel files that look like social
  // exports become post data (Auditor + Analytics); any other CSV/Excel is kept
  // as a text doc so agents can still read it.

  async function handleFileUpload(e) {
    const files = Array.from(e.target.files);
    const newDocs = [], newSocial = [], failed = [], empty = [];
    const asDoc = (name, text) => newDocs.push({ name, text, added_at: new Date().toISOString() });

    for (const file of files) {
      try {
        if (/\.xlsx?$/i.test(file.name)) {
          const data = await parseSpreadsheet(file);
          if (data?.posts.length) newSocial.push(data);
          else asDoc(file.name, await spreadsheetToText(file));
        } else if (/\.(docx|pdf)$/i.test(file.name)) {
          const text = /\.pdf$/i.test(file.name) ? await pdfToText(file) : await docxToText(file);
          if (text) asDoc(file.name, text);
          else empty.push(file.name); // e.g. a scanned PDF: pages are images, no text to read
        } else if (/\.(txt|md|markdown|csv)$/i.test(file.name)) {
          const text = await file.text();
          if (text.includes("\u0000")) { failed.push(file.name); continue; } // binary, not really text
          const data = /\.csv$/i.test(file.name) ? parseSocialData(text, file.name) : null;
          if (data?.posts.length && data.isPostData) newSocial.push(data);
          else asDoc(file.name, text);
        } else {
          failed.push(file.name);
        }
      } catch { failed.push(file.name); }
    }

    // A re-uploaded file replaces the old copy with the same name.
    if (newDocs.length) setDocs(prev => [...prev.filter(d => !newDocs.some(n => n.name === d.name)), ...newDocs]);
    if (newSocial.length) setSocialFiles(prev => [...prev.filter(f => !newSocial.some(n => n.filename === f.filename)), ...newSocial]);

    const parts = [];
    if (newDocs.length) parts.push(`${newDocs.length} file${newDocs.length > 1 ? "s" : ""} added`);
    if (newSocial.length) {
      const n = newSocial.reduce((n, f) => n + f.posts.length, 0);
      parts.push(`${n} posts loaded${newSocial.every(f => !f.hasPostText) ? " (metrics and links only, no post text)" : ""}`);
    }
    if (empty.length) parts.push(`no readable text in ${empty.join(", ")} (scanned PDFs are images, so there are no words to pull out)`);
    if (failed.length) parts.push(`couldn't read ${failed.join(", ")}. Use .txt, .md, .docx, .pdf, .csv or Excel`);
    const nothingAdded = !newDocs.length && !newSocial.length;
    showToast(parts.join(" · ") || "Nothing added", nothingAdded && (failed.length > 0 || empty.length > 0));
    e.target.value = "";
  }

  function removeDoc(name) {
    setDocs(prev => prev.filter(d => d.name !== name));
  }

  function removeDataFile(filename) {
    setSocialFiles(prev => prev.filter(f => f.filename !== filename));
  }

  // ─── Visible agents ─────────────────────────────────────────────────────────

  const visibleAgents = AGENTS.filter(a => !a.conditional || brief.hasExistingContent || socialFiles.length > 0);

  // ─── Streaming agent output ─────────────────────────────────────────────────

  // Streams one agent's output into the UI and returns the finished text ("" on error).
  async function streamAgent(agentIndex, messages) {
    let full = "";
    setOutputs(p => ({ ...p, [agentIndex]: { status: "streaming", text: "" } }));
    // Reset chat when re-running
    setChatHistories(p => ({ ...p, [agentIndex]: [] }));
    try {
      const res = await fetch("/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages, agentIndex }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value, { stream: true });
        full += chunk;
        setOutputs(p => ({
          ...p,
          [agentIndex]: { status: "streaming", text: (p[agentIndex]?.text || "") + chunk },
        }));
      }
      setOutputs(p => ({ ...p, [agentIndex]: { ...p[agentIndex], status: "done" } }));
      return full;
    } catch (err) {
      setOutputs(p => ({ ...p, [agentIndex]: { status: "error", text: "Error: " + err.message } }));
      return "";
    }
  }

  // ─── Chat with agent ─────────────────────────────────────────────────────────

  // The chat's first message gets the same cached brief + files block the agents
  // use, so follow-ups know the full brief and reuse the cache.
  function chatApiMessages(history) {
    const { shared } = buildPrompts(brief, socialFiles, docs);
    return history.map((m, i) => i === 0
      ? { role: "user", content: [cachedBlock(shared), { type: "text", text: m.content }] }
      : m);
  }

  async function sendChat(agentIndex) {
    const userMsg = (chatInputs[agentIndex] || "").trim();
    if (!userMsg) return;

    const agent = AGENTS.find(a => a.index === agentIndex);
    const agentOutput = outputs[agentIndex]?.text || "";
    const prevHistory = chatHistories[agentIndex] || [];

    // Build message history
    // First message sets the agent's context (only if this is the first chat message)
    let history;
    if (prevHistory.length === 0) {
      const systemMessage = `You are the ${agent.name} from High Voltage. You just completed an analysis for the brand brief above.

Your analysis was:
${agentOutput}

The user wants to follow up on your analysis. Stay in character as ${agent.name}. Be direct, specific, and helpful.`;

      history = [
        { role: "user", content: systemMessage },
        { role: "assistant", content: "I'm ready to discuss my analysis. What would you like to explore?" },
        { role: "user", content: userMsg },
      ];
    } else {
      history = [...prevHistory, { role: "user", content: userMsg }];
    }

    // Update UI — add user message, clear input, set streaming
    setChatHistories(p => ({
      ...p,
      [agentIndex]: history,
    }));
    setChatInputs(p => ({ ...p, [agentIndex]: "" }));
    setChatStreaming(p => ({ ...p, [agentIndex]: true }));

    // Add empty assistant message that we'll stream into
    const historyWithPending = [...history, { role: "assistant", content: "" }];
    setChatHistories(p => ({ ...p, [agentIndex]: historyWithPending }));

    try {
      const res = await fetch("/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: chatApiMessages(history), agentIndex, isChat: true }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value, { stream: true });
        setChatHistories(p => {
          const hist = [...(p[agentIndex] || [])];
          const last = hist[hist.length - 1];
          if (last?.role === "assistant") {
            hist[hist.length - 1] = { ...last, content: last.content + chunk };
          }
          return { ...p, [agentIndex]: hist };
        });
      }
    } catch (err) {
      setChatHistories(p => {
        const hist = [...(p[agentIndex] || [])];
        hist[hist.length - 1] = { role: "assistant", content: "Error: " + err.message };
        return { ...p, [agentIndex]: hist };
      });
    } finally {
      setChatStreaming(p => ({ ...p, [agentIndex]: false }));
    }
  }

  // ─── Run all ─────────────────────────────────────────────────────────────────

  async function runAll() {
    setRunning(true);
    const prompts = buildPrompts(brief, socialFiles, docs);
    const visible = visibleAgents.map(a => a.index);
    // Everyone shows as queued until their stage starts.
    setOutputs(Object.fromEntries(visible.map(i => [i, { status: "queued", text: "" }])));
    const results = {};
    for (const stage of STAGES) {
      const ids = stage.filter(i => visible.includes(i));
      await Promise.allSettled(ids.map(async i => {
        results[i] = await streamAgent(i, agentMessages(prompts, i, results));
      }));
    }
    setRunning(false);
  }

  async function rerunAgent(agentIndex) {
    const teamOutputs = Object.fromEntries(
      Object.entries(outputs).filter(([, o]) => o?.status === "done").map(([i, o]) => [i, o.text]));
    await streamAgent(agentIndex, agentMessages(buildPrompts(brief, socialFiles, docs), agentIndex, teamOutputs));
  }

  function startApp() {
    setView("app");
    setActiveTab(visibleAgents[0]?.index ?? 0);
    setOutputs({});
    setChatHistories({});
    setTimeout(runAll, 100);
  }

  // ─── Copy ─────────────────────────────────────────────────────────────────

  function copyAgent(index) {
    const text = outputs[index]?.text;
    if (!text) return;
    navigator.clipboard.writeText(text).then(() => showToast("Copied"));
  }

  async function exportAgentPDF(index) {
    const text = outputs[index]?.text;
    if (!text) return;

    const { jsPDF } = await import("jspdf");
    const doc = new jsPDF();
    const margin = 20;
    const pageWidth = doc.internal.pageSize.getWidth();
    const pageHeight = doc.internal.pageSize.getHeight();
    const maxWidth = pageWidth - 2 * margin;
    let y = margin;

    function checkPage(needed) {
      if (y + (needed || 14) > pageHeight - margin) { doc.addPage(); y = margin; }
    }

    function addText(str, size, bold, r, g, b) {
      doc.setFontSize(size || 10);
      doc.setTextColor(r ?? 40, g ?? 40, b ?? 40);
      doc.setFont(undefined, bold ? "bold" : "normal");
      const lines = doc.splitTextToSize(String(str || ""), maxWidth);
      checkPage(lines.length * (size || 10) * 0.45 + 4);
      doc.text(lines, margin, y);
      y += lines.length * (size || 10) * 0.45 + 4;
    }

    const agent = AGENTS.find(a => a.index === index);
    const dateStr = new Date().toLocaleDateString("en-GB", { year: "numeric", month: "long", day: "numeric" });

    // Header
    addText("High Voltage", 18, true, 20, 20, 20);
    addText(agent.name, 13, false, 80, 80, 80);
    addText(dateStr, 10, false, 150, 150, 150);
    if (brief.name || brief.role) addText([brief.name, brief.role, brief.industry].filter(Boolean).join(" · "), 10, false, 120, 120, 120);
    y += 4;
    doc.setDrawColor(220, 220, 220);
    doc.line(margin, y, pageWidth - margin, y);
    y += 10;

    // Content — strip markdown symbols for PDF
    const clean = text
      .replace(/^#{1,3}\s+/gm, "")
      .replace(/\*\*([^*]+)\*\*/g, "$1")
      .replace(/\*([^*]+)\*/g, "$1")
      .replace(/^[-*+] /gm, "• ")
      .replace(/\u2019/g, "'").replace(/\u2018/g, "'")
      .replace(/\u201c/g, '"').replace(/\u201d/g, '"')
      .replace(/\u2013/g, "-").replace(/\u2014/g, "--");

    addText(clean, 10, false, 40, 40, 40);

    const filename = `${agent.name.toLowerCase().replace(/\s+/g, "-")}-${dateStr.replace(/\s/g, "-")}.pdf`;
    doc.save(filename);
    showToast("PDF saved");
  }

  function showToast(msg, error = false) {
    setToast({ msg, show: true, error });
    setTimeout(() => setToast(t => ({ ...t, show: false })), 2200);
  }

  // ─── Analytics summary ──────────────────────────────────────────────────────

  function renderAnalytics() {
    const allPosts = socialFiles.flatMap(f => f.posts);
    const hasMetrics = socialFiles.some(f => f.hasMetrics);
    const totalPosts = allPosts.length;

    if (!totalPosts) return <div className="empty-state"><div className="empty-icon">📊</div><div className="empty-title">No data loaded</div><div className="empty-sub">Upload a social media CSV export in the brief to see analytics here.</div></div>;

    if (!hasMetrics) {
      // Text-only analysis
      return (
        <div className="analytics-wrap">
          <div className="analytics-heading">Posts — Content Analysis</div>
          <div className="analytics-note">No metrics detected in this export. Showing content overview. For impressions and engagement data, try exporting from your platform&apos;s analytics dashboard.</div>
          <div className="stat-cards">
            <div className="stat-card"><div className="stat-num">{totalPosts}</div><div className="stat-label">Posts loaded</div></div>
            <div className="stat-card"><div className="stat-num">{Math.round(allPosts.reduce((n,p) => n + (p.text?.length || 0), 0) / totalPosts)}</div><div className="stat-label">Avg post length (chars)</div></div>
          </div>
          <div className="analytics-section-title">Recent posts</div>
          <div className="posts-list">
            {allPosts.slice(0, 10).map((p, i) => (
              <div key={i} className="post-row">
                {p.date && <div className="post-date">{p.date}</div>}
                <div className="post-text">{p.text?.slice(0, 200)}{p.text?.length > 200 ? "..." : ""}</div>
              </div>
            ))}
          </div>
        </div>
      );
    }

    // Has metrics
    const withImpressions = allPosts.filter(p => p.impressions);
    const totalImpressions = withImpressions.reduce((n, p) => n + p.impressions, 0);
    const avgImpressions = withImpressions.length ? Math.round(totalImpressions / withImpressions.length) : 0;
    const totalReactions = allPosts.reduce((n, p) => n + (p.reactions || 0), 0);
    const topPosts = [...withImpressions].sort((a, b) => b.impressions - a.impressions).slice(0, 5);
    const maxImpressions = topPosts[0]?.impressions || 1;

    return (
      <div className="analytics-wrap">
        <div className="analytics-heading">Analytics</div>
        <div className="stat-cards">
          <div className="stat-card"><div className="stat-num">{totalPosts}</div><div className="stat-label">Total posts</div></div>
          <div className="stat-card"><div className="stat-num">{totalImpressions.toLocaleString()}</div><div className="stat-label">Total impressions</div></div>
          <div className="stat-card"><div className="stat-num">{avgImpressions.toLocaleString()}</div><div className="stat-label">Avg impressions</div></div>
          <div className="stat-card"><div className="stat-num">{totalReactions.toLocaleString()}</div><div className="stat-label">Total reactions</div></div>
        </div>

        <div className="analytics-section-title">Top 5 posts by impressions</div>
        <div className="posts-list">
          {topPosts.map((p, i) => (
            <div key={i} className="post-row">
              <div className="post-bar-row">
                <div className="post-bar" style={{ width: `${(p.impressions / maxImpressions) * 100}%` }} />
                <div className="post-metrics">
                  <span>{p.impressions?.toLocaleString()} impressions</span>
                  {p.reactions != null && <span>{p.reactions} reactions</span>}
                  {p.comments != null && <span>{p.comments} comments</span>}
                  {p.engagements != null && <span>{p.engagements} engagements</span>}
                </div>
              </div>
              {p.date && <div className="post-date">{p.date}</div>}
              {p.text
                ? <div className="post-text">{p.text.slice(0, 200)}{p.text.length > 200 ? "..." : ""}</div>
                : p.url && <a className="post-text" href={p.url} target="_blank" rel="noreferrer">View post on LinkedIn</a>}
            </div>
          ))}
        </div>
      </div>
    );
  }

  // ════════════════════════════════════════════════════════════════════════
  //  WIZARD VIEW
  // ════════════════════════════════════════════════════════════════════════

  if (view === "wizard") {
    return (
      <div className="wizard-wrap">
        <div className="wizard-logo">
          <span className="wizard-logo-mark" />
          High Voltage
        </div>


        <div className="wizard-progress">
          <div className="wizard-progress-fill" style={{ width: `${((step + 1) / 3) * 100}%` }} />
        </div>

        <div className="wizard-card">

          {step === 0 && (
            <div className="wizard-step" key={0}>
              <div className="wizard-heading">Who are you building for?</div>
              <div className="wizard-sub">Tell us about yourself so every agent tailors advice to your situation.</div>
              <div className="field-row">
                <div className="field">
                  <div className="field-label">Name or handle</div>
                  <input type="text" placeholder="@handle" value={brief.name} onChange={e => update("name", e.target.value)} />
                </div>
                <div className="field">
                  <div className="field-label">Role or title</div>
                  <input type="text" placeholder="Founder, CMO, Candidate..." value={brief.role} onChange={e => update("role", e.target.value)} />
                </div>
              </div>
              <div className="field">
                <div className="field-label">Industry or niche</div>
                <input type="text" placeholder="Blockchain, Climate tech, Local politics..." value={brief.industry} onChange={e => update("industry", e.target.value)} />
              </div>
              <div className="field">
                <div className="field-label">What do you want to achieve?</div>
                <textarea rows={3} placeholder="e.g. Build an audience, get speaking invitations, attract new clients..." value={brief.goal} onChange={e => update("goal", e.target.value)} />
              </div>
              <div className="wizard-nav">
                <span className="step-label">Step 1 of 3</span>
                <button className="next-btn" onClick={() => setStep(1)}>Next →</button>
              </div>
            </div>
          )}

          {step === 1 && (
            <div className="wizard-step" key={1}>
              <div className="wizard-heading">Where do you show up?</div>
              <div className="wizard-sub">Select your platforms and describe who you&apos;re trying to reach.</div>
              <div className="field">
                <div className="field-label">Platforms</div>
                <div className="platform-grid">
                  {PLATFORMS.map(p => (
                    <label key={p} className={`platform-chip ${brief.platforms.includes(p) ? "selected" : ""}`}>
                      <input type="checkbox" checked={brief.platforms.includes(p)} onChange={() => togglePlatform(p)} />
                      {p}
                    </label>
                  ))}
                </div>
              </div>
              <div className="field">
                <div className="field-label">Target audience</div>
                <textarea rows={2} placeholder="Who are you trying to reach?" value={brief.audience} onChange={e => update("audience", e.target.value)} />
              </div>
              <div className="field">
                <div className="field-label">Tone of voice</div>
                <div className="tone-grid">
                  {TONES.map(t => (
                    <button key={t} className={`tone-btn ${brief.tone === t ? "selected" : ""}`} onClick={() => update("tone", t)}>{t}</button>
                  ))}
                </div>
              </div>
              <div className="wizard-nav">
                <button className="back-btn" onClick={() => setStep(0)}>← Back</button>
                <span className="step-label">Step 2 of 3</span>
                <button className="next-btn" onClick={() => setStep(2)}>Next →</button>
              </div>
            </div>
          )}

          {step === 2 && (
            <div className="wizard-step" key={2}>
              <div className="wizard-heading">What are we working with?</div>
              <div className="wizard-sub">Existing content or starting fresh — both are fine. Uploading social data unlocks richer analysis.</div>

              <div className="field">
                <div className="field-label">Your situation</div>
                <div className="situation-row">
                  <button className={`situation-btn ${!brief.hasExistingContent ? "active" : ""}`} onClick={() => update("hasExistingContent", false)}>Starting fresh</button>
                  <button className={`situation-btn ${brief.hasExistingContent ? "active" : ""}`} onClick={() => update("hasExistingContent", true)}>Have existing content</button>
                </div>
                {brief.hasExistingContent && (
                  <textarea rows={4} placeholder="Paste your best existing posts, articles, or content..." value={brief.existingContent} onChange={e => update("existingContent", e.target.value)} />
                )}
              </div>

              {/* Project files: every agent reads these */}
              <div className="field">
                <div className="field-label">Project files <span className="field-optional">optional</span></div>
                <div className="upload-zone" onClick={() => document.getElementById("file-upload").click()}>
                  <div className="upload-icon">📁</div>
                  <div className="upload-text">Add files every agent can read</div>
                  <div className="upload-hint">Documents (.txt, .md, .docx, .pdf) for background like brand notes or past posts. Only the words are read, not images. Social media exports (CSV or Excel) also unlock the Content Auditor and Analytics tab. Saved with this project.</div>
                  <input id="file-upload" type="file" multiple accept=".txt,.md,.markdown,.docx,.pdf,.csv,.xls,.xlsx" style={{ display: "none" }} onChange={handleFileUpload} />
                </div>
                {(docs.length > 0 || socialFiles.length > 0) && (
                  <div className="upload-files">
                    {docs.map(d => (
                      <div key={"doc-" + d.name} className="upload-file-chip">
                        <span>📄 {d.name} ({wordCount(d.text).toLocaleString()} words)</span>
                        <button onClick={() => removeDoc(d.name)} aria-label={`Remove ${d.name}`}>×</button>
                      </div>
                    ))}
                    {socialFiles.map((f, i) => (
                      <div key={"social-" + f.filename + i} className="upload-file-chip">
                        <span>📊 {f.filename} ({f.posts.length} posts)</span>
                        <button onClick={() => removeDataFile(f.filename)} aria-label={`Remove ${f.filename}`}>×</button>
                      </div>
                    ))}
                  </div>
                )}
                {docs.reduce((n, d) => n + wordCount(d.text), 0) > 75000 && (
                  <div className="upload-warning">
                    These files add up to about {(docs.reduce((n, d) => n + wordCount(d.text), 0)).toLocaleString()} words. Every agent reads all of them on every run, so runs will be slower and cost more.
                  </div>
                )}
                <div className="upload-how">
                  LinkedIn: Settings → Data Privacy → Get a copy of your data → Posts. Twitter/X: Settings → Your account → Download an archive of your data.
                </div>
              </div>

              <div className="field">
                <div className="field-label">Biggest challenge</div>
                <textarea rows={2} placeholder="e.g. I post inconsistently, content gets ignored, don't know how to stand out..." value={brief.challenge} onChange={e => update("challenge", e.target.value)} />
              </div>
              <div className="field">
                <div className="field-label">What makes you different?</div>
                <textarea rows={2} placeholder="e.g. 10 years in the industry, built a company from scratch, unique methodology..." value={brief.differentiator} onChange={e => update("differentiator", e.target.value)} />
              </div>

              <div className="wizard-nav">
                <button className="back-btn" onClick={() => setStep(1)}>← Back</button>
                <span className="step-label">Step 3 of 3</span>
                <button className="next-btn" onClick={startApp}>Generate strategy →</button>
              </div>
            </div>
          )}
        </div>
      </div>
    );
  }

  // ════════════════════════════════════════════════════════════════════════
  //  APP VIEW
  // ════════════════════════════════════════════════════════════════════════

  const currentAgent = AGENTS.find(a => a.index === activeTab);
  const currentOutput = outputs[activeTab];
  const currentChatHistory = chatHistories[activeTab] || [];
  // Filter history to only user/assistant messages (skip the system setup messages)
  const visibleChatMessages = currentChatHistory.filter((m, i) => {
    if (i === 0 && m.role === "user" && m.content.includes("You are the")) return false;
    if (i === 1 && m.role === "assistant" && m.content.includes("I'm ready to discuss")) return false;
    return true;
  });

  const showAnalyticsTab = socialFiles.length > 0;

  return (
    <div className="app-wrap">

      {/* ── Header ── */}
      <header className="app-header">
        <div className="header-logo"><span className="header-logo-dot" />High Voltage</div>
        <div className="brief-summary">
          <div className="brief-pill">
            {brief.name && <span className="brief-pill-name">{brief.name}</span>}
            {brief.name && brief.role && <span className="brief-pill-dot">·</span>}
            {brief.role && <span>{brief.role}</span>}
            {brief.industry && <><span className="brief-pill-dot">·</span><span>{brief.industry}</span></>}
            {brief.platforms.length > 0 && <><span className="brief-pill-dot">·</span><span>{brief.platforms.slice(0, 3).join(", ")}</span></>}
          </div>
          <button className="edit-brief-btn" onClick={() => { setView("wizard"); setStep(0); }}>Edit brief</button>
          <button className="edit-brief-btn" onClick={() => { setView("wizard"); setStep(2); }}>Files ({docs.length + socialFiles.length})</button>
        </div>
        <div className="header-actions">
          <button className="run-btn" onClick={runAll} disabled={running}>
            {running ? "Running..." : "↻ Re-run all"}
          </button>
          <button className="run-btn" style={{ background: "transparent", border: "1px solid var(--border)", color: "var(--text-muted)" }} onClick={onNewProject}>+ New project</button>
        </div>
      </header>

      {/* ── Tab bar ── */}
      <nav className="tab-bar">
        {visibleAgents.map(agent => {
          const status = outputs[agent.index]?.status;
          const hasChat = (chatHistories[agent.index] || []).filter((m,i) => !(i<=1)).length > 0;
          return (
            <button key={agent.index} className={`tab ${activeTab === agent.index ? "active" : ""}`} onClick={() => setActiveTab(agent.index)}>
              {agent.icon} {agent.name}
              {status && <span className={`tab-dot ${status}`} />}
              {hasChat && !status && <span className="tab-chat-dot" title="Has chat history" />}
            </button>
          );
        })}
        {showAnalyticsTab && (
          <button className={`tab ${activeTab === ANALYTICS_TAB ? "active" : ""}`} onClick={() => setActiveTab(ANALYTICS_TAB)}>
            📊 Analytics
          </button>
        )}
      </nav>

      {/* ── Content area ── */}
      <div className="content-area" key={activeTab}>

        {/* Analytics tab */}
        {activeTab === ANALYTICS_TAB ? renderAnalytics() : (

          currentOutput?.status === "queued" ? (
            <div className="empty-state">
              <div className="empty-icon">{currentAgent?.icon}</div>
              <div className="empty-title">Waiting for teammates</div>
              <div className="empty-sub">
                Starts once {READS_FROM[activeTab].filter(i => visibleAgents.some(a => a.index === i)).map(agentName).join(", ")} finish, so it can build on their work.
              </div>
            </div>
          ) : !currentOutput ? (
            <div className="empty-state">
              <div className="empty-icon">{currentAgent?.icon}</div>
              <div className="empty-title">Waiting to run</div>
              <div className="empty-sub">Hit &quot;Re-run all&quot; or wait for the current run to reach this agent.</div>
            </div>
          ) : (
            <div className="agent-output">

              {/* Output header */}
              <div className="output-meta">
                <div className="output-agent-info">
                  <span className="output-icon">{currentAgent?.icon}</span>
                  <span className="output-name">{currentAgent?.name}</span>
                  <span className="output-model">{currentAgent?.model}</span>
                </div>
                <div className="output-actions">
                  {currentOutput.status === "streaming" && (
                    <div className="status-badge streaming"><div className="spinner" /> Thinking</div>
                  )}
                  {currentOutput.status === "done" && (
                    <>
                      <div className="status-badge done">✓ Done</div>
                      <button className="rerun-btn" onClick={() => rerunAgent(activeTab)}>↻ Re-run</button>
                      <button className="copy-btn" onClick={() => copyAgent(activeTab)}>Copy</button>
                      <button className="copy-btn" onClick={() => exportAgentPDF(activeTab)}>PDF</button>
                    </>
                  )}
                  {currentOutput.status === "error" && (
                    <>
                      <div className="status-badge error">✗ Error</div>
                      <button className="rerun-btn" onClick={() => rerunAgent(activeTab)}>↻ Retry</button>
                    </>
                  )}
                </div>
              </div>

              {/* Output text */}
              <div className={`output-box ${activeTab === 5 ? "contrarian" : ""} ${currentOutput.status === "streaming" ? "streaming-cursor" : ""}`}>
                {currentOutput.status === "streaming" && !currentOutput.text
                  ? <div className="thinking-note"><div className="spinner" /> Thinking through this one, one moment</div>
                  : renderMarkdown(currentOutput.text) || " "}
              </div>

              {/* ── Chat section — only when done ── */}
              {currentOutput.status === "done" && (
                <div className="chat-section">
                  <div className="chat-section-label">
                    <span className="chat-label-icon">💬</span>
                    Ask {currentAgent?.name} a follow-up
                  </div>

                  {/* Chat messages */}
                  {visibleChatMessages.length > 0 && (
                    <div className="chat-messages">
                      {visibleChatMessages.map((msg, i) => (
                        <div key={i} className={`chat-msg ${msg.role}`}>
                          <div className="chat-msg-label">{msg.role === "user" ? "You" : currentAgent?.name}</div>
                          <div className="chat-msg-bubble">
                            {msg.role === "assistant" && !msg.content && chatStreaming[activeTab]
                              ? <span className="thinking-note"><span className="spinner" /> Thinking through this one, one moment</span>
                              : msg.content}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Chat input */}
                  <div className="chat-input-row">
                    <textarea
                      className="chat-input"
                      rows={2}
                      placeholder={`Ask ${currentAgent?.name} anything about their analysis...`}
                      value={chatInputs[activeTab] || ""}
                      onChange={e => setChatInputs(p => ({ ...p, [activeTab]: e.target.value }))}
                      onKeyDown={e => {
                        if (e.key === "Enter" && !e.shiftKey) {
                          e.preventDefault();
                          if (!chatStreaming[activeTab]) sendChat(activeTab);
                        }
                      }}
                      disabled={chatStreaming[activeTab]}
                    />
                    <button
                      className="chat-send-btn"
                      onClick={() => sendChat(activeTab)}
                      disabled={chatStreaming[activeTab] || !chatInputs[activeTab]?.trim()}
                    >
                      {chatStreaming[activeTab] ? "..." : "Send →"}
                    </button>
                  </div>
                </div>
              )}

            </div>
          )
        )}
      </div>

      <div className={`toast ${toast.show ? "show" : ""}`} style={toast.error ? { background: "var(--red)" } : {}}>
        {toast.msg}
      </div>
    </div>
  );
}
