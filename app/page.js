"use client";

import { useState } from "react";

// ─── Data ─────────────────────────────────────────────────────────────────────

const AGENTS = [
  { index: 0, name: "Brand Strategist", icon: "🧭", desc: "Positioning, tone of voice, content pillars", model: "Opus",  conditional: false },
  { index: 1, name: "Content Auditor",  icon: "🔍", desc: "What's working, what's not, what's missing",  model: "Haiku", conditional: true  },
  { index: 2, name: "Content Ideator",  icon: "💡", desc: "Post ideas, angles, and hooks",               model: "Haiku", conditional: false },
  { index: 3, name: "Post Writer",      icon: "✍️",  desc: "Platform-specific posts ready to publish",   model: "Haiku", conditional: false },
  { index: 4, name: "Repurposer",       icon: "🔄", desc: "One piece across every platform",             model: "Haiku", conditional: true  },
  { index: 5, name: "Contrarian",       icon: "⚔️",  desc: "What won't work and why",                    model: "Opus",  conditional: false },
];

const PLATFORMS = ["LinkedIn", "Twitter/X", "Instagram", "TikTok", "Facebook", "Bluesky"];
const TONES = ["Professional", "Conversational", "Bold & provocative", "Inspirational", "Educational", "Humorous"];

const defaultBrief = {
  name: "", role: "", industry: "", goal: "",
  platforms: [], audience: "", tone: "Conversational",
  hasExistingContent: false, existingContent: "",
  challenge: "", differentiator: "",
};

// ─── Prompt builder ────────────────────────────────────────────────────────────

function buildPrompts(brief) {
  const platformList = brief.platforms.length ? brief.platforms.join(", ") : "all major platforms";
  const existingBlock = brief.hasExistingContent && brief.existingContent
    ? `\n\nEXISTING CONTENT:\n${brief.existingContent}` : "";

  const ctx = `BRAND BRIEF:
Name/Handle: ${brief.name || "Not specified"}
Role/Title: ${brief.role || "Not specified"}
Industry/Niche: ${brief.industry || "Not specified"}
Goal: ${brief.goal || "Not specified"}
Target Audience: ${brief.audience || "Not specified"}
Platforms: ${platformList}
Tone of Voice: ${brief.tone}
Biggest Challenge: ${brief.challenge || "Not specified"}
What Makes Them Different: ${brief.differentiator || "Not specified"}${existingBlock}`;

  return [
    // 0: Brand Strategist
    `You are an expert social media brand strategist.\n\n${ctx}\n\nDeliver:\n1. Positioning statement — who they are, who they serve, what makes them distinct (2–3 sentences)\n2. Tone of voice — how they should sound, language to use and avoid\n3. 3–5 content pillars — the core themes they should own\n4. Platform strategy — which to prioritise, why, and how to adapt per platform\n5. What to stop doing — common mistakes for someone in their position\n\nBe specific to their role and goals. No generic advice.`,

    // 1: Content Auditor
    `You are a sharp social media content analyst.\n\n${ctx}\n\nAudit their existing content:\n1. What's working and why\n2. What's not working — weak patterns, missed opportunities\n3. Gaps — missing topics, formats, or angles\n4. Consistency — is there a clear voice, or is it scattered?\n5. Top 3 highest-impact changes to make immediately\n\nBe direct. Don't soften criticism.`,

    // 2: Content Ideator
    `You are a creative social media strategist specialising in thought leadership.\n\n${ctx}\n\nGenerate 10 specific, ready-to-use post ideas. For each:\n- A compelling hook (opening line or concept)\n- Which platforms it suits\n- Why it will resonate with their audience\n- Difficulty: Easy / Medium / Challenging\n\nMix formats: opinion, personal story, data-backed take, contrarian view, how-to, list. Prioritise non-obvious ideas specific to their niche.`,

    // 3: Post Writer
    `You are an expert social media copywriter.\n\n${ctx}\n\nWrite 3 complete, publish-ready posts:\n\nPOST 1: LinkedIn long-form (300–500 words) — thought leadership or personal story\nPOST 2: Twitter/X thread (6–8 tweets) — punchy and shareable\nPOST 3: Instagram caption — visual storytelling with a strong CTA\n\nEach should be distinct in angle but consistent in brand voice. Write in first person as if you are them.`,

    // 4: Repurposer
    `You are a content repurposing expert.\n\n${ctx}\n\nRepurpose the existing content into:\n1. LinkedIn post (150–300 words, professional)\n2. Twitter/X thread (5–7 tweets)\n3. Instagram caption (personal, visual, with hashtags)\n4. TikTok script (60–90 seconds, hook + points + CTA)\n5. Facebook post (community-oriented)\n6. Bluesky post (similar to Twitter, slightly different tone)\n\nKeep the core message consistent but adapt format and tone for each platform.`,

    // 5: Contrarian
    `You are a brutally honest social media critic.\n\n${ctx}\n\nTear this strategy apart before it gets published:\n1. What is painfully generic — how many others say the exact same thing?\n2. Which ideas won't land and why\n3. Where are they being inauthentic or trying too hard\n4. What assumptions are likely wrong\n5. What their audience will actually ignore\n6. The single biggest mistake they're about to make\n7. What a truly distinctive version of this brand would look like instead\n\nRank from most fatal to least fatal. Be the honest voice nobody else will be.`,
  ];
}

// ─── Main component ────────────────────────────────────────────────────────────

export default function Home() {
  const [view, setView]           = useState("wizard"); // "wizard" | "app"
  const [step, setStep]           = useState(0);        // 0, 1, 2
  const [brief, setBrief]         = useState(defaultBrief);
  const [outputs, setOutputs]     = useState({});       // { agentIndex: { status, text } }
  const [activeTab, setActiveTab] = useState(0);
  const [running, setRunning]     = useState(false);
  const [toast, setToast]         = useState({ msg: "", show: false, error: false });

  // ─── Brief helpers ───────────────────────────────────────────────────────────

  const update = (field, val) => setBrief(p => ({ ...p, [field]: val }));

  const togglePlatform = (p) =>
    setBrief(prev => ({
      ...prev,
      platforms: prev.platforms.includes(p)
        ? prev.platforms.filter(x => x !== p)
        : [...prev.platforms, p],
    }));

  // ─── Which agents are visible (based on hasExistingContent) ─────────────────

  const visibleAgents = AGENTS.filter(a => !a.conditional || brief.hasExistingContent);

  // ─── Streaming ───────────────────────────────────────────────────────────────

  async function streamAgent(agentIndex, prompt) {
    setOutputs(p => ({ ...p, [agentIndex]: { status: "streaming", text: "" } }));
    try {
      const res = await fetch("/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt, agentIndex }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value, { stream: true });
        setOutputs(p => ({
          ...p,
          [agentIndex]: { status: "streaming", text: (p[agentIndex]?.text || "") + chunk },
        }));
      }
      setOutputs(p => ({ ...p, [agentIndex]: { ...p[agentIndex], status: "done" } }));
    } catch (err) {
      setOutputs(p => ({ ...p, [agentIndex]: { status: "error", text: "Error: " + err.message } }));
    }
  }

  // ─── Run all ─────────────────────────────────────────────────────────────────

  async function runAll() {
    setRunning(true);
    const prompts = buildPrompts(brief);
    await Promise.allSettled(
      visibleAgents.map(a => streamAgent(a.index, prompts[a.index]))
    );
    setRunning(false);
  }

  // ─── Go from wizard to app ───────────────────────────────────────────────────

  function startApp() {
    setView("app");
    setActiveTab(visibleAgents[0]?.index ?? 0);
    setOutputs({});
    // Small delay so the layout renders before streaming starts
    setTimeout(runAll, 100);
  }

  // ─── Re-run a single agent ────────────────────────────────────────────────────

  async function rerunAgent(agentIndex) {
    const prompts = buildPrompts(brief);
    await streamAgent(agentIndex, prompts[agentIndex]);
  }

  // ─── Copy ────────────────────────────────────────────────────────────────────

  function copyAgent(index) {
    const text = outputs[index]?.text;
    if (!text) return;
    navigator.clipboard.writeText(text).then(() => showToast("Copied to clipboard"));
  }

  function showToast(msg, error = false) {
    setToast({ msg, show: true, error });
    setTimeout(() => setToast(t => ({ ...t, show: false })), 2200);
  }

  // ─── Brief summary string ─────────────────────────────────────────────────────

  const briefSummary = [
    brief.name,
    brief.role,
    brief.platforms.length ? brief.platforms.slice(0, 3).join(", ") : null,
    brief.tone,
  ].filter(Boolean);

  // ════════════════════════════════════════════════════════════════════════
  //  WIZARD VIEW
  // ════════════════════════════════════════════════════════════════════════

  if (view === "wizard") {
    return (
      <div className="wizard-wrap">
        <div className="wizard-logo">
          ⚡ <span>Voltage Media</span>
        </div>

        {/* Progress bar */}
        <div className="wizard-progress">
          {[0, 1, 2].map(i => (
            <div
              key={i}
              className={`progress-step ${i < step ? "done" : i === step ? "active" : ""}`}
            />
          ))}
        </div>

        <div className="wizard-card">

          {/* ── Step 0: Who are you? ── */}
          {step === 0 && (
            <div className="wizard-step" key={0}>
              <div className="wizard-heading">Who are you building for?</div>
              <div className="wizard-sub">Tell us about yourself so every agent can tailor advice to your situation.</div>

              <div className="field-row">
                <div className="field">
                  <div className="field-label">Name or handle</div>
                  <input type="text" placeholder="@sarah" value={brief.name} onChange={e => update("name", e.target.value)} />
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
                <textarea rows={3} placeholder="e.g. Build a following as a blockchain founder, attract institutional investors, win a state house seat, get speaking invitations..." value={brief.goal} onChange={e => update("goal", e.target.value)} />
              </div>

              <div className="wizard-nav">
                <span className="step-label">Step 1 of 3</span>
                <button className="next-btn" onClick={() => setStep(1)}>Next →</button>
              </div>
            </div>
          )}

          {/* ── Step 1: Platforms & audience ── */}
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
                <textarea rows={2} placeholder="Who are you trying to reach? e.g. Institutional investors, DeFi developers, voters in Hawaii District 5..." value={brief.audience} onChange={e => update("audience", e.target.value)} />
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

          {/* ── Step 2: Content situation ── */}
          {step === 2 && (
            <div className="wizard-step" key={2}>
              <div className="wizard-heading">What are we working with?</div>
              <div className="wizard-sub">Starting fresh or building on existing content? Both are fine.</div>

              <div className="field">
                <div className="field-label">Your situation</div>
                <div className="situation-row">
                  <button className={`situation-btn ${!brief.hasExistingContent ? "active" : ""}`} onClick={() => update("hasExistingContent", false)}>Starting fresh</button>
                  <button className={`situation-btn ${brief.hasExistingContent ? "active" : ""}`} onClick={() => update("hasExistingContent", true)}>Have existing content</button>
                </div>
                {brief.hasExistingContent && (
                  <textarea rows={4} placeholder="Paste your best existing posts, articles, or content here..." value={brief.existingContent} onChange={e => update("existingContent", e.target.value)} />
                )}
              </div>

              <div className="field">
                <div className="field-label">Biggest challenge</div>
                <textarea rows={2} placeholder="e.g. I post inconsistently, my content gets ignored, I don't know how to stand out..." value={brief.challenge} onChange={e => update("challenge", e.target.value)} />
              </div>

              <div className="field">
                <div className="field-label">What makes you different?</div>
                <textarea rows={2} placeholder="e.g. I've been in crypto since 2013, I have 20 years of institutional finance experience..." value={brief.differentiator} onChange={e => update("differentiator", e.target.value)} />
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

  return (
    <div className="app-wrap">

      {/* ── Header ── */}
      <header className="app-header">
        <div className="header-logo">⚡ Voltage Media</div>

        {/* Brief summary pill */}
        <div className="brief-summary">
          <div className="brief-pill">
            {brief.name && <span className="brief-pill-name">{brief.name}</span>}
            {brief.name && brief.role && <span className="brief-pill-dot">·</span>}
            {brief.role && <span>{brief.role}</span>}
            {brief.industry && <><span className="brief-pill-dot">·</span><span>{brief.industry}</span></>}
            {brief.platforms.length > 0 && <><span className="brief-pill-dot">·</span><span>{brief.platforms.slice(0, 3).join(", ")}</span></>}
          </div>
          <button className="edit-brief-btn" onClick={() => { setView("wizard"); setStep(0); }}>
            Edit brief
          </button>
        </div>

        <div className="header-actions">
          <button className="run-btn" onClick={runAll} disabled={running}>
            {running ? "Running..." : "↻ Re-run all"}
          </button>
        </div>
      </header>

      {/* ── Tab bar ── */}
      <nav className="tab-bar">
        {visibleAgents.map(agent => {
          const status = outputs[agent.index]?.status;
          return (
            <button
              key={agent.index}
              className={`tab ${activeTab === agent.index ? "active" : ""}`}
              onClick={() => setActiveTab(agent.index)}
            >
              {agent.icon} {agent.name}
              {status && (
                <span className={`tab-dot ${status}`} />
              )}
            </button>
          );
        })}
      </nav>

      {/* ── Content area ── */}
      <div className="content-area" key={activeTab}>
        {!currentOutput ? (
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
                  <div className="status-badge streaming">
                    <div className="spinner" /> Thinking
                  </div>
                )}
                {currentOutput.status === "done" && (
                  <>
                    <div className="status-badge done">✓ Done</div>
                    <button className="rerun-btn" onClick={() => rerunAgent(activeTab)}>↻ Re-run</button>
                    <button className="copy-btn" onClick={() => copyAgent(activeTab)}>Copy</button>
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
              {currentOutput.text || " "}
            </div>
          </div>
        )}
      </div>

      {/* Toast */}
      <div className={`toast ${toast.show ? "show" : ""}`} style={toast.error ? { background: "var(--red)" } : {}}>
        {toast.msg}
      </div>
    </div>
  );
}
