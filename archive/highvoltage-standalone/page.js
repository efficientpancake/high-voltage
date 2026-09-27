"use client";

import { useState, useRef } from "react";

const VIBES = [
  { id: "builder", label: "Builder" },
  { id: "degen", label: "Degen" },
  { id: "visionary", label: "Visionary" },
  { id: "clean", label: "Clean / pro" },
];

const FORMATS = [
  { id: "thread", label: "Thread" },
  { id: "posts", label: "3 standalone posts" },
  { id: "announcement", label: "Launch announcement" },
  { id: "replies", label: "Reply / quote-tweet options" },
];

export default function HighVoltage() {
  const [project, setProject] = useState("");
  const [voiceSamples, setVoiceSamples] = useState("");
  const [vibe, setVibe] = useState("builder");
  const [topic, setTopic] = useState("");
  const [outputType, setOutputType] = useState("thread");

  const [output, setOutput] = useState("");
  const [running, setRunning] = useState(false);
  const [tweak, setTweak] = useState("");
  const [copied, setCopied] = useState(false);
  const lastBody = useRef(null);

  async function run(body) {
    setRunning(true);
    setOutput("");
    setCopied(false);
    lastBody.current = body;
    try {
      const res = await fetch("/api/highvoltage", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        setOutput((p) => p + dec.decode(value, { stream: true }));
      }
    } catch (e) {
      setOutput("Error: " + e.message);
    } finally {
      setRunning(false);
    }
  }

  const generate = () =>
    run({ project, voiceSamples, vibe, topic, outputType });

  const regenerate = () => {
    if (!lastBody.current) return generate();
    run({ ...lastBody.current, tweak });
  };

  const copy = async () => {
    await navigator.clipboard.writeText(output);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const canRun = project.trim() && !running;

  return (
    <div style={S.page}>
      <header style={S.header}>
        <h1 style={S.h1}>⚡ High Voltage</h1>
        <p style={S.sub}>Crypto Twitter content that sounds like you, not like AI.</p>
      </header>

      <div style={S.grid}>
        {/* INPUTS */}
        <div style={S.col}>
          <label style={S.label}>What are you building?</label>
          <textarea
            style={{ ...S.input, minHeight: 80 }}
            value={project}
            onChange={(e) => setProject(e.target.value)}
            placeholder="One or two lines on your project. What it is, who it's for."
          />

          <label style={S.label}>What do you want to post about?</label>
          <textarea
            style={{ ...S.input, minHeight: 70 }}
            value={topic}
            onChange={(e) => setTopic(e.target.value)}
            placeholder="The update, news, or idea for this post. Leave blank to let it pick."
          />

          <label style={S.label}>
            Your voice <span style={S.hint}>(paste 2-3 of your own tweets — best results)</span>
          </label>
          <textarea
            style={{ ...S.input, minHeight: 90 }}
            value={voiceSamples}
            onChange={(e) => setVoiceSamples(e.target.value)}
            placeholder="Paste a few tweets you've written so it learns how you sound."
          />

          {!voiceSamples.trim() && (
            <>
              <label style={S.label}>Or pick a vibe</label>
              <div style={S.row}>
                {VIBES.map((v) => (
                  <button
                    key={v.id}
                    onClick={() => setVibe(v.id)}
                    style={{ ...S.chip, ...(vibe === v.id ? S.chipOn : {}) }}
                  >
                    {v.label}
                  </button>
                ))}
              </div>
            </>
          )}

          <label style={S.label}>Format</label>
          <div style={S.row}>
            {FORMATS.map((f) => (
              <button
                key={f.id}
                onClick={() => setOutputType(f.id)}
                style={{ ...S.chip, ...(outputType === f.id ? S.chipOn : {}) }}
              >
                {f.label}
              </button>
            ))}
          </div>

          <button onClick={generate} disabled={!canRun} style={S.cta}>
            {running ? "Writing…" : "Generate"}
          </button>
          {!project.trim() && (
            <p style={S.hint}>Add what you're building to start.</p>
          )}
        </div>

        {/* OUTPUT */}
        <div style={S.col}>
          <div style={S.outHead}>
            <span style={S.label}>Output</span>
            {output && !running && (
              <button onClick={copy} style={S.copy}>
                {copied ? "Copied ✓" : "Copy"}
              </button>
            )}
          </div>
          <div style={S.output}>
            {output || (
              <span style={S.placeholder}>
                Your posts show up here. Fill in the left and hit Generate.
              </span>
            )}
          </div>

          {output && !running && (
            <div style={S.tweakRow}>
              <input
                style={{ ...S.input, marginTop: 0 }}
                value={tweak}
                onChange={(e) => setTweak(e.target.value)}
                placeholder="Tweak it: punchier, more degen, shorter, more technical…"
              />
              <button onClick={regenerate} style={S.secondary}>
                Regenerate
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

const S = {
  page: {
    maxWidth: 1000,
    margin: "0 auto",
    padding: "32px 20px 80px",
    fontFamily: "system-ui, -apple-system, sans-serif",
    color: "#111",
  },
  header: { marginBottom: 24 },
  h1: { fontSize: 28, margin: 0 },
  sub: { color: "#666", marginTop: 4 },
  grid: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 24 },
  col: { display: "flex", flexDirection: "column" },
  label: { fontSize: 13, fontWeight: 600, margin: "14px 0 6px" },
  hint: { fontWeight: 400, color: "#999", fontSize: 12 },
  input: {
    width: "100%",
    padding: 10,
    border: "1px solid #ddd",
    borderRadius: 8,
    fontSize: 14,
    fontFamily: "inherit",
    resize: "vertical",
    boxSizing: "border-box",
  },
  row: { display: "flex", gap: 8, flexWrap: "wrap" },
  chip: {
    padding: "7px 12px",
    border: "1px solid #ddd",
    borderRadius: 999,
    background: "#fff",
    cursor: "pointer",
    fontSize: 13,
  },
  chipOn: { background: "#111", color: "#fff", borderColor: "#111" },
  cta: {
    marginTop: 18,
    padding: "12px 18px",
    border: "none",
    borderRadius: 10,
    background: "#7c3aed",
    color: "#fff",
    fontSize: 15,
    fontWeight: 600,
    cursor: "pointer",
  },
  outHead: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
  },
  copy: {
    padding: "5px 10px",
    border: "1px solid #ddd",
    borderRadius: 8,
    background: "#fff",
    cursor: "pointer",
    fontSize: 12,
  },
  secondary: {
    padding: "10px 14px",
    border: "1px solid #111",
    borderRadius: 8,
    background: "#fff",
    cursor: "pointer",
    fontSize: 14,
    whiteSpace: "nowrap",
  },
  output: {
    minHeight: 320,
    whiteSpace: "pre-wrap",
    border: "1px solid #eee",
    borderRadius: 10,
    padding: 16,
    background: "#fafafa",
    fontSize: 15,
    lineHeight: 1.5,
  },
  placeholder: { color: "#bbb" },
  tweakRow: { display: "flex", gap: 8, marginTop: 12, alignItems: "center" },
};
