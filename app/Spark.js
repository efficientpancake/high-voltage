"use client";

// Spark: research and sharpen an idea. The user brings a topic or rough thesis
// plus sources; seven agents find evidence (including live web search), angles
// and trends, make the strongest case for and against it, and end with an
// outline. Adapted from the Thought-Leader Ideator, minus its blockchain-only
// framing. "Turn into posts" hands the outline to a linked Amp project.
import { useState, useRef, useEffect } from "react";
import { renderMarkdown } from "../lib/markdown";
import ShaderBackground from "./ShaderBackground";
import { docxToText, pdfToText } from "../lib/extractText";

const AGENTS = [
  { index: 0, name: "Researcher",      icon: "🔍", desc: "Evidence, data and quotes, from your sources and the live web", model: "Opus (newest)" },
  { index: 1, name: "Angle Generator", icon: "🎯", desc: "Fresh framings and non-obvious takes",                         model: "Sonnet (newest)" },
  { index: 2, name: "Trend Spotter",   icon: "📡", desc: "What's emerging, overhyped and ignored",                       model: "Sonnet (newest)" },
  { index: 3, name: "Steel Man",       icon: "🛡️", desc: "The strongest case for your idea",                             model: "Opus (newest)" },
  { index: 4, name: "Contrarian",      icon: "⚔️", desc: "The strongest case against it",                                model: "Opus (newest)" },
  { index: 5, name: "Outline Builder", icon: "📐", desc: "An outline built to survive the Contrarian",                   model: "Sonnet (newest)" },
  { index: 6, name: "Cold Reader",     icon: "👀", desc: "Would a stranger get the headline and the hook?",              model: "Sonnet (newest)" },
];
const agentName = i => AGENTS.find(a => a.index === i)?.name;

// Agents run in stages so later ones build on earlier ones. The Researcher goes
// first (and fills the prompt cache), the Contrarian attacks the Steel Man's
// case, the Outline Builder uses everything, and the Cold Reader judges the
// outline as a stranger.
const STAGES = [[0], [1, 2, 3], [4], [5], [6]];
const READS_FROM = { 0: [], 1: [0], 2: [0], 3: [0], 4: [0, 3], 5: [0, 1, 2, 3, 4], 6: [5] };
const RESEARCHER = 0;
const OUTLINE = 5;
const COLD_READER = 6; // stays a stranger: never sees the topic, sources or team notes

const cachedBlock = text => ({ type: "text", text, cache_control: { type: "ephemeral", ttl: "1h" } });
const wordCount = text => (text.match(/\S+/g) || []).length;

function sharedBlock({ topic, audience }, docs) {
  const sources = docs.length
    ? "\n\nSOURCES THE USER PROVIDED (research material; cite them by name when you use them):\n" +
      docs.map(d => `\n=== ${d.name} ===\n${d.text}`).join("\n")
    : "\n\n(The user provided no sources. Work from the live web results where you have them and from well-established knowledge, and say which is which.)";
  return `TOPIC OR THESIS:\n${topic || "(not given: infer it from the sources)"}\n\nWHO IT'S FOR:\n${audience || "(not specified: assume smart readers new to the topic)"}${sources}`;
}

const TASKS = [
  // 0: Researcher
  `You are a rigorous research analyst. Using the sources above and the live web search results below, pull out:
- Key data points, statistics and figures
- Strong quotes worth using
- The most relevant expert opinions or research findings
- Important counterexamples or nuances the author needs to know
- Gaps in the evidence

Cite every claim by source name (a file name or a URL). Never invent a number, quote or source; if the evidence is thin, say so. Don't editorialize: surface the strongest material.`,

  // 1: Angle Generator
  `You are a creative strategist and editor. Generate 6 to 8 distinct angles the author could write from. For each:
- A punchy working title
- The core argument in 2 or 3 sentences
- Who it would resonate with most
- What makes it non-obvious

Prioritize angles that are fresh, counterintuitive or underexplored. Skip the obvious takes.`,

  // 2: Trend Spotter
  `You are a trend analyst. Map the landscape around this topic:
- What is genuinely emerging and gaining momentum?
- What is overhyped and likely to disappoint?
- What is ignored or underestimated?
- Where are the most interesting tensions or contradictions?
- What does the next 12 to 24 months look like?

Be specific: name companies, people, rules and research. Only name what the sources or the Researcher's findings support, and flag anything you're less sure of.`,

  // 3: Steel Man
  `Build the strongest possible case FOR the author's thesis. Make the most rigorous, well-evidenced, intellectually honest argument for it:
- The core logic
- The strongest evidence in its favor
- Historical analogies or precedents
- The credible voices who would agree
- Why the most common objections are weaker than they look

Write it as a serious argument, without hedging. Use only evidence from the sources or the Researcher's findings.`,

  // 4: Contrarian
  `You are a rigorous intellectual critic. Dismantle the author's thesis, including the Steel Man's case for it. Find:
- The logical gaps and leaps
- Weak or cherry-picked evidence
- The strongest counterarguments from credible sources
- Inconvenient data or examples
- Hidden assumptions that collapse under scrutiny
- Where correlation is being mistaken for causation
- What the author is probably wrong about entirely

Don't pull punches: the goal is a bulletproof final piece. Rank the flaws from most fatal to least fatal.`,

  // 5: Outline Builder
  `You are an argument architect. Build a detailed outline for a long-form thought leadership piece, written for the audience above. Use the whole team's work: the Researcher's evidence, the best angle, the trends, the Steel Man's case, and answers to the Contrarian's strongest objections. Include:
- A headline and subheadline a stranger would understand
- The opening hook
- 4 to 6 main sections, each with sub-points and the specific evidence to use (cite the source)
- Where and how the piece answers the strongest objections
- A strong conclusion

Take a clear, defensible point of view; this is not a neutral explainer. Mark any claim that still needs a source as [needs source]. Stop at the outline: don't write the article.`,

  // 6: Cold Reader
  `You are a cold reader: someone scrolling who has never heard of this author or topic. You know nothing except the outline below. Don't guess at context you weren't given.

You're busy and skeptical, and you give a headline two seconds. Curiosity is not clarity: if a line only works as a puzzle, it is not clear.

Judge the headline, the subheadline and the opening hook. For each, give:
- What I think it's about: one plain sentence
- Would I keep reading? Yes or No, and why
- What confused me: any word, name or reference a stranger wouldn't get (or "Nothing")
- Check A: Can I say exactly what the idea is, without guessing between options? If I wrote a question mark, "could be", "maybe" or a list of possibilities above, the answer is No. Yes or No
- Check B: Does it name a problem or question that I, the reader, already care about? Yes or No
- Clarity: 1 to 5. If Check A or Check B is No, the score is 3 or lower, no exceptions

Finish with the single change that would most improve clarity for a stranger.`,
];

function agentMessages(shared, agentIndex, teamOutputs) {
  const team = READS_FROM[agentIndex]
    .filter(i => teamOutputs[i])
    .map(i => `## ${agentName(i)}\n${teamOutputs[i]}`)
    .join("\n\n");
  if (agentIndex === COLD_READER) {
    const text = `${TASKS[agentIndex]}\n\nTHE OUTLINE:\n\n${teamOutputs[OUTLINE] || "(No outline yet. Run the Outline Builder first.)"}`;
    return [{ role: "user", content: [{ type: "text", text }] }];
  }
  const task = TASKS[agentIndex] + (team ? `\n\nYOUR TEAM'S WORK SO FAR:\n\n${team}` : "");
  return [{ role: "user", content: [cachedBlock(shared), { type: "text", text: task }] }];
}

// A run interrupted by closing the page can't resume.
function settleOutputs(outputs = {}) {
  return Object.fromEntries(Object.entries(outputs)
    .filter(([, o]) => o?.status !== "queued")
    .map(([k, o]) => [k, o?.status === "streaming" ? { ...o, status: "error", text: (o.text || "") + "\n\n(Interrupted. Hit Retry to run it again.)" } : o]));
}

export default function Spark({ project, onChange, goHome, createLinked, openProject, linked }) {
  const [view, setView]           = useState(project.view === "results" ? "results" : "setup");
  const [inputs, setInputs]       = useState({ topic: "", audience: "", ...project.brief });
  const [docs, setDocs]           = useState(project.files?.docs || []);
  const [outputs, setOutputs]     = useState(() => settleOutputs(project.outputs));
  const [activeTab, setActiveTab] = useState(project.active_tab || 0);
  const [running, setRunning]     = useState(false);
  const [toast, setToast]         = useState({ msg: "", show: false, error: false });
  const [linkUrl, setLinkUrl]     = useState("");
  const [readingLink, setReadingLink] = useState(false);
  const [paste, setPaste]         = useState({ open: false, name: "", text: "" });
  // Follow-up chat per agent: { agentIndex: [{ role, content }] }, only what's shown.
  const [chats, setChats]         = useState(project.chats || {});
  const [chatInputs, setChatInputs] = useState({});
  const [chatBusy, setChatBusy]   = useState({});

  // Autosave every change; skip the first render (that's the project we loaded).
  const firstRender = useRef(true);
  useEffect(() => {
    if (firstRender.current) { firstRender.current = false; return; }
    onChange({ view, brief: inputs, outputs, active_tab: activeTab, chats, files: { docs, social: [] } });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, inputs, outputs, activeTab, docs, chats]);

  function showToast(msg, error = false) {
    setToast({ msg, show: true, error });
    setTimeout(() => setToast(t => ({ ...t, show: false })), 2600);
  }

  // ─── Sources ───────────────────────────────────────────────────────────────

  const addDocs = newDocs => setDocs(prev => [...prev.filter(d => !newDocs.some(n => n.name === d.name)), ...newDocs]);

  async function handleUpload(e) {
    const added = [], failed = [], empty = [];
    for (const file of Array.from(e.target.files)) {
      try {
        let text = "";
        if (/\.pdf$/i.test(file.name)) text = await pdfToText(file);
        else if (/\.docx$/i.test(file.name)) text = await docxToText(file);
        else if (/\.(txt|md|markdown|csv)$/i.test(file.name)) {
          text = await file.text();
          if (text.includes("\u0000")) { failed.push(file.name); continue; }
        } else { failed.push(file.name); continue; }
        if (text.trim()) added.push({ name: file.name, text, added_at: new Date().toISOString() });
        else empty.push(file.name);
      } catch { failed.push(file.name); }
    }
    if (added.length) addDocs(added);
    const parts = [];
    if (added.length) parts.push(`${added.length} source${added.length > 1 ? "s" : ""} added`);
    if (empty.length) parts.push(`no readable text in ${empty.join(", ")}`);
    if (failed.length) parts.push(`couldn't read ${failed.join(", ")}. Use .txt, .md, .docx, .pdf or .csv`);
    showToast(parts.join(" · ") || "Nothing added", !added.length);
    e.target.value = "";
  }

  async function addLink() {
    if (!linkUrl.trim()) return;
    setReadingLink(true);
    try {
      const res = await fetch("/api/read-link", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: linkUrl }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || `Couldn't read that page (${res.status}).`);
      addDocs([{ name: data.name, text: `Source: ${data.url}\n\n${data.text}`, added_at: new Date().toISOString() }]);
      setLinkUrl("");
      showToast("Link added");
    } catch (err) {
      showToast(err.message, true);
    } finally {
      setReadingLink(false);
    }
  }

  function addPasted() {
    if (!paste.text.trim()) return;
    const name = paste.name.trim() || `Pasted text ${docs.filter(d => d.name.startsWith("Pasted text")).length + 1}`;
    addDocs([{ name, text: paste.text, added_at: new Date().toISOString() }]);
    setPaste({ open: false, name: "", text: "" });
  }

  // ─── Running agents ────────────────────────────────────────────────────────

  async function streamAgent(agentIndex, messages) {
    let full = "";
    setChats(p => ({ ...p, [agentIndex]: [] })); // new work, new conversation
    setOutputs(p => ({ ...p, [agentIndex]: { status: "streaming", text: "" } }));
    try {
      const res = await fetch("/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages,
          agentIndex,
          app: "spark",
          ...(agentIndex === RESEARCHER ? { webSearch: inputs.topic || docs.map(d => d.name).join(", ") } : {}),
        }),
      });
      if (!res.ok) throw new Error((await res.text().catch(() => "")) || `HTTP ${res.status}`);
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value, { stream: true });
        full += chunk;
        setOutputs(p => ({ ...p, [agentIndex]: { status: "streaming", text: (p[agentIndex]?.text || "") + chunk } }));
      }
      setOutputs(p => ({ ...p, [agentIndex]: { ...p[agentIndex], status: "done" } }));
      return full;
    } catch (err) {
      setOutputs(p => ({ ...p, [agentIndex]: { status: "error", text: "Error: " + err.message } }));
      return "";
    }
  }

  async function runAll() {
    if (!inputs.topic.trim() && !docs.length) {
      showToast("Add a topic or at least one source first.", true);
      return;
    }
    setView("results");
    setActiveTab(0);
    setRunning(true);
    const shared = sharedBlock(inputs, docs);
    setOutputs(Object.fromEntries(AGENTS.map(a => [a.index, { status: "queued", text: "" }])));
    const results = {};
    for (const stage of STAGES) {
      await Promise.allSettled(stage.map(async i => {
        results[i] = await streamAgent(i, agentMessages(shared, i, results));
      }));
    }
    setRunning(false);
  }

  async function rerunAgent(i) {
    const done = Object.fromEntries(Object.entries(outputs).filter(([, o]) => o?.status === "done").map(([k, o]) => [k, o.text]));
    await streamAgent(i, agentMessages(sharedBlock(inputs, docs), i, done));
  }

  // ─── Follow-up chat ────────────────────────────────────────────────────────

  // The first message carries the same cached topic and sources the agent ran
  // with, plus what it wrote, so the conversation picks up where it left off.
  // The Cold Reader only ever sees the outline, so it stays a stranger.
  function chatApiMessages(agentIndex, history) {
    const agent = agentName(agentIndex);
    const own = outputs[agentIndex]?.text || "";
    const pushback = "If the user pushes back, weigh it honestly: concede where they're right, hold your ground where the evidence supports you, and say plainly which you're doing. Don't cave just to agree. Never invent a number, quote or source.";
    const setup = agentIndex === COLD_READER
      ? [{ type: "text", text: `You are the Cold Reader: a stranger who knows nothing except this outline.\n\nTHE OUTLINE:\n\n${outputs[OUTLINE]?.text || ""}\n\nYOUR FEEDBACK WAS:\n\n${own}\n\nThe user wants to follow up. Stay a stranger: judge only what's on the page. ${pushback}` }]
      : [cachedBlock(sharedBlock(inputs, docs)), { type: "text", text: `You are the ${agent} on the Spark team. Your work on the topic above was:\n\n${own}\n\nThe user wants to follow up: to unpack your reasoning, ask for more, or push back. Stay in role as the ${agent}. Be direct and specific, and cite sources by name as before. ${pushback}` }];
    return [
      { role: "user", content: setup },
      { role: "assistant", content: "Understood. What would you like to dig into?" },
      ...history,
    ];
  }

  async function sendChat(agentIndex) {
    const text = (chatInputs[agentIndex] || "").trim();
    if (!text || chatBusy[agentIndex]) return;
    const history = [...(chats[agentIndex] || []), { role: "user", content: text }];
    setChats(p => ({ ...p, [agentIndex]: [...history, { role: "assistant", content: "" }] }));
    setChatInputs(p => ({ ...p, [agentIndex]: "" }));
    setChatBusy(p => ({ ...p, [agentIndex]: true }));
    const appendToReply = add => setChats(p => {
      const hist = [...(p[agentIndex] || [])];
      const last = hist[hist.length - 1];
      if (last?.role === "assistant") hist[hist.length - 1] = { ...last, content: add(last.content) };
      return { ...p, [agentIndex]: hist };
    });
    try {
      const res = await fetch("/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: chatApiMessages(agentIndex, history), agentIndex, isChat: true, app: "spark" }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value, { stream: true });
        appendToReply(c => c + chunk);
      }
    } catch (err) {
      appendToReply(() => "Error: " + err.message);
    } finally {
      setChatBusy(p => ({ ...p, [agentIndex]: false }));
    }
  }

  // ─── The bridge to Amp ────────────────────────────────────────────────────

  async function turnIntoPosts() {
    const now = new Date().toISOString();
    const carried = [
      { name: "Spark outline", text: outputs[OUTLINE].text, added_at: now },
      ...(outputs[RESEARCHER]?.status === "done" ? [{ name: "Spark research", text: outputs[RESEARCHER].text, added_at: now }] : []),
    ];
    await createLinked({
      kind: "amp",
      view: "wizard",
      brief: {
        label: `Posts: ${(inputs.topic || "Spark idea").slice(0, 50)}`,
        goal: `Turn this researched idea into posts: ${inputs.topic || "see the Spark outline"}`,
        audience: inputs.audience || "",
      },
      files: { docs: carried, social: [] },
    });
  }

  function copyAgent(i) {
    navigator.clipboard.writeText(outputs[i]?.text || "").then(() => showToast("Copied"));
  }

  // ─── Render ────────────────────────────────────────────────────────────────

  const outlineDone = outputs[OUTLINE]?.status === "done";
  const totalWords = docs.reduce((n, d) => n + wordCount(d.text), 0);
  const current = outputs[activeTab];
  const currentAgent = AGENTS.find(a => a.index === activeTab);

  const header = (
    <header className="app-header">
      <div className="header-logo"><span className="header-logo-dot" />Spark</div>
      <div className="brief-summary">
        <div className="brief-pill"><span className="brief-pill-name">{inputs.topic || "No topic yet"}</span></div>
        {view === "results" && <button className="edit-brief-btn" onClick={() => setView("setup")}>Topic and sources ({docs.length})</button>}
        {linked
          ? <button className="edit-brief-btn" onClick={() => openProject(linked.id)}>Open linked Amp project</button>
          : outlineDone && <button className="edit-brief-btn" onClick={turnIntoPosts}>Turn into posts</button>}
      </div>
      <div className="header-actions">
        {view === "results" && (
          <button className="run-btn" onClick={runAll} disabled={running}>{running ? "Running..." : "↻ Re-run all"}</button>
        )}
        <button className="run-btn" style={{ background: "transparent", border: "1px solid var(--border)", color: "var(--text-muted)" }} onClick={goHome}>+ New project</button>
      </div>
    </header>
  );

  return (
    <div className="app-wrap">
      {header}

      {view === "setup" ? (
        <div className="spark-setup on-shader">
          <ShaderBackground />
          <div className="wizard-card">
            <div className="wizard-heading">What idea are we sharpening?</div>
            <div className="wizard-sub">A topic, a question or a rough thesis. The more opinionated, the better the Steel Man and the Contrarian can test it.</div>

            <div className="field">
              <label className="field-label" htmlFor="spark-topic">Topic or thesis</label>
              <textarea id="spark-topic" rows={3} placeholder="e.g. Small campaigns lose because nobody holds the candidate to call time"
                value={inputs.topic} onChange={e => setInputs(p => ({ ...p, topic: e.target.value }))} />
            </div>

            <div className="field">
              <label className="field-label" htmlFor="spark-audience">Who it&apos;s for <span className="field-optional">optional</span></label>
              <textarea id="spark-audience" rows={2} placeholder="e.g. First-time founders, county party chairs, CFOs at mid-size firms..."
                value={inputs.audience} onChange={e => setInputs(p => ({ ...p, audience: e.target.value }))} />
            </div>

            <div className="field">
              <div className="field-label">Sources <span className="field-optional">optional</span></div>
              <div className="upload-zone" onClick={() => document.getElementById("spark-upload").click()}>
                <div className="upload-icon">📁</div>
                <div className="upload-text">Add files</div>
                <div className="upload-hint">.txt, .md, .docx, .pdf or .csv. Only the words are read, not images. The Researcher also searches the web.</div>
                <input id="spark-upload" type="file" multiple accept=".txt,.md,.markdown,.docx,.pdf,.csv" style={{ display: "none" }} onChange={handleUpload} />
              </div>

              <div className="spark-link-row">
                <input type="text" placeholder="Paste a web link" value={linkUrl}
                  onChange={e => setLinkUrl(e.target.value)}
                  onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); addLink(); } }} />
                <button className="back-btn" onClick={addLink} disabled={readingLink || !linkUrl.trim()}>{readingLink ? "Reading..." : "Add link"}</button>
                <button className="back-btn" onClick={() => setPaste(p => ({ ...p, open: !p.open }))}>Paste text</button>
              </div>

              {paste.open && (
                <div className="spark-paste">
                  <input type="text" placeholder="Name (optional)" value={paste.name} onChange={e => setPaste(p => ({ ...p, name: e.target.value }))} />
                  <textarea rows={5} placeholder="Paste notes, an article, a transcript..." value={paste.text} onChange={e => setPaste(p => ({ ...p, text: e.target.value }))} />
                  <button className="back-btn" onClick={addPasted} disabled={!paste.text.trim()}>Add as a source</button>
                </div>
              )}

              {docs.length > 0 && (
                <div className="upload-files">
                  {docs.map(d => (
                    <div key={d.name} className="upload-file-chip">
                      <span>📄 {d.name} ({wordCount(d.text).toLocaleString()} words)</span>
                      <button onClick={() => setDocs(prev => prev.filter(x => x.name !== d.name))} aria-label={`Remove ${d.name}`}>×</button>
                    </div>
                  ))}
                </div>
              )}
              {totalWords > 75000 && (
                <div className="upload-warning">
                  These sources add up to about {totalWords.toLocaleString()} words. Every agent reads all of them, so runs will be slower and cost more.
                </div>
              )}
            </div>

            <div className="wizard-nav">
              {Object.values(outputs).some(o => o?.status === "done")
                ? <button className="back-btn" onClick={() => setView("results")}>Back to results</button>
                : <span />}
              <button className="next-btn" onClick={runAll} disabled={running}>
                {Object.keys(outputs).length ? "Re-run Spark →" : "Run Spark →"}
              </button>
            </div>
          </div>
        </div>
      ) : (
        <>
          <nav className="tab-bar">
            {AGENTS.map(a => (
              <button key={a.index} className={`tab ${activeTab === a.index ? "active" : ""}`} onClick={() => setActiveTab(a.index)}>
                {a.icon} {a.name}
                {outputs[a.index]?.status && <span className={`tab-dot ${outputs[a.index].status}`} />}
                {!outputs[a.index]?.status && (chats[a.index] || []).length > 0 && <span className="tab-chat-dot" title="Has chat history" />}
              </button>
            ))}
          </nav>

          <div className="content-area" key={activeTab}>
            {current?.status === "queued" ? (
              <div className="empty-state">
                <div className="empty-icon">{currentAgent.icon}</div>
                <div className="empty-title">Waiting for teammates</div>
                <div className="empty-sub">Starts once {READS_FROM[activeTab].map(agentName).join(", ")} finish, so it can build on their work.</div>
              </div>
            ) : !current ? (
              <div className="empty-state">
                <div className="empty-icon">{currentAgent.icon}</div>
                <div className="empty-title">Waiting to run</div>
                <div className="empty-sub">Hit &quot;Re-run all&quot;, or run just this agent using the team&apos;s current work.</div>
                {!running && <button className="rerun-btn" onClick={() => rerunAgent(activeTab)}>Run {currentAgent.name}</button>}
              </div>
            ) : (
              <div className="agent-output">
                <div className="output-meta">
                  <div className="output-agent-info">
                    <span className="output-icon">{currentAgent.icon}</span>
                    <span className="output-name">{currentAgent.name}</span>
                    <span className="output-model">{currentAgent.model}</span>
                  </div>
                  <div className="output-actions">
                    {current.status === "streaming" && <div className="status-badge streaming"><div className="spinner" /> Thinking</div>}
                    {current.status === "done" && (
                      <>
                        <div className="status-badge done">✓ Done</div>
                        <button className="rerun-btn" onClick={() => rerunAgent(activeTab)}>↻ Re-run</button>
                        <button className="copy-btn" onClick={() => copyAgent(activeTab)}>Copy</button>
                      </>
                    )}
                    {current.status === "error" && (
                      <>
                        <div className="status-badge error">✗ Error</div>
                        <button className="rerun-btn" onClick={() => rerunAgent(activeTab)}>↻ Retry</button>
                      </>
                    )}
                  </div>
                </div>
                <div className={`output-box ${activeTab === 4 ? "contrarian" : ""} ${current.status === "streaming" ? "streaming-cursor" : ""}`}>
                  {current.status === "streaming" && !current.text
                    ? <div className="thinking-note"><div className="spinner" /> Thinking through this one, one moment</div>
                    : renderMarkdown(current.text) || " "}
                </div>
                {current.status === "done" && (
                  <div className="chat-section">
                    <div className="chat-section-label">
                      <span className="chat-label-icon">💬</span>
                      Ask {currentAgent.name} a follow-up, or push back
                    </div>
                    {(chats[activeTab] || []).length > 0 && (
                      <div className="chat-messages">
                        {chats[activeTab].map((msg, i) => (
                          <div key={i} className={`chat-msg ${msg.role}`}>
                            <div className="chat-msg-label">{msg.role === "user" ? "You" : currentAgent.name}</div>
                            <div className="chat-msg-bubble">
                              {msg.role === "assistant" && !msg.content && chatBusy[activeTab]
                                ? <span className="thinking-note"><span className="spinner" /> Thinking through this one, one moment</span>
                                : msg.role === "assistant" ? renderMarkdown(msg.content) : msg.content}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                    <div className="chat-input-row">
                      <textarea
                        className="chat-input"
                        rows={2}
                        placeholder={`Ask ${currentAgent.name} to explain, go deeper, or defend a point...`}
                        value={chatInputs[activeTab] || ""}
                        onChange={e => setChatInputs(p => ({ ...p, [activeTab]: e.target.value }))}
                        onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendChat(activeTab); } }}
                        disabled={chatBusy[activeTab]}
                      />
                      <button className="chat-send-btn" onClick={() => sendChat(activeTab)} disabled={chatBusy[activeTab] || !chatInputs[activeTab]?.trim()}>
                        {chatBusy[activeTab] ? "..." : "Send →"}
                      </button>
                    </div>
                  </div>
                )}
                {activeTab === OUTLINE && outlineDone && !linked && (
                  <div className="spark-bridge">
                    <div>Happy with the outline? Amp can turn it into your brand&apos;s posts.</div>
                    <button className="next-btn" onClick={turnIntoPosts}>Turn into posts →</button>
                  </div>
                )}
              </div>
            )}
          </div>
        </>
      )}

      <div className={`toast ${toast.show ? "show" : ""}`} style={toast.error ? { background: "var(--red)" } : {}}>
        {toast.msg}
      </div>
    </div>
  );
}
