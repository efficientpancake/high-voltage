"use client";

// Public landing page. Signed-out visitors to "/" see this (middleware.js).
// Two ways in: request access (email saved for review) or book a call.
// There are no open sign-ups: only people added by hand can sign in.
import { useState } from "react";
import ShaderBackground from "../ShaderBackground";
import TeamTicker from "./TeamTicker";

const BOOK_CALL = "https://calendly.com/sarah-shaefer-xexw/20-minute-meeting";

function RequestAccess({ id }) {
  const [email, setEmail]   = useState("");
  const [website, setWebsite] = useState(""); // hidden field; bots fill it, people don't
  const [status, setStatus] = useState("idle"); // idle | sending | sent | error
  const [message, setMessage] = useState("");

  async function submit(e) {
    e.preventDefault();
    if (!email.trim()) return;
    setStatus("sending");
    try {
      const res = await fetch("/api/request-access", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, website }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Something went wrong. Try again in a minute.");
      setStatus("sent");
    } catch (err) {
      setStatus("error");
      setMessage(err.message);
    }
  }

  if (status === "sent") {
    return (
      <div className="landing-form-done" role="status">
        Thanks. We&apos;ll email <strong>{email}</strong> to set up a short call and get you in.
      </div>
    );
  }

  return (
    <form className="landing-form" onSubmit={submit}>
      <label className="landing-sr" htmlFor={`${id}-email`}>Email</label>
      <input id={`${id}-email`} type="email" autoComplete="email" placeholder="you@example.com"
        value={email} onChange={e => setEmail(e.target.value)} required />
      <input className="landing-hp" tabIndex={-1} autoComplete="off" aria-hidden="true"
        value={website} onChange={e => setWebsite(e.target.value)} />
      <button className="next-btn" type="submit" disabled={status === "sending"}>
        {status === "sending" ? "Sending..." : "Request access"}
      </button>
      <a className="landing-btn-ghost" href={BOOK_CALL} target="_blank" rel="noopener noreferrer">Book a call</a>
      {status === "error" && <div className="login-error landing-form-error">{message}</div>}
    </form>
  );
}

export default function Welcome() {
  return (
    <div className="landing on-shader">
      <ShaderBackground />

      <header className="landing-top">
        <div className="wizard-logo"><span className="wizard-logo-mark" />Voltage Labs</div>
        <a className="landing-signin" href="/login">Sign in</a>
      </header>

      <main>
        {/* Split hero: words on a solid panel, the animation in its own box,
            so it never sits behind the text */}
        <section className="landing-hero">
          <div className="landing-hero-text">
            <h1>Sharpen the idea before you post it.</h1>
            <p className="landing-lede">A research team and content team for founders and business owners who don&apos;t have either.</p>
            <RequestAccess id="hero" />
          </div>
          <div className="landing-visual">
            <ShaderBackground name="voltageArc" contained />
            <TeamTicker />
          </div>
        </section>

        <section className="landing-section" aria-labelledby="ways-in">
          <h2 id="ways-in">Two ways in</h2>
          <div className="landing-cards">
            <div className="landing-card">
              <h3>Spark: research and sharpen an idea</h3>
              <p>Start with a topic or a rough take. Spark searches the web, makes the strongest case for your idea and the strongest case against it, then hands you an outline that survives both.</p>
            </div>
            <div className="landing-card">
              <h3>Amp: build your voice and your posts</h3>
              <p>Tell it who you are and who you&apos;re talking to. Amp works out your positioning and tone of voice, then writes posts for each platform in that voice.</p>
            </div>
          </div>
        </section>

        <section className="landing-section" aria-labelledby="how">
          <h2 id="how">How it works</h2>
          <ol className="landing-steps">
            <li><strong>Bring a topic, or just yourself.</strong> Add notes, articles, links or past posts if you have them.</li>
            <li><strong>A team of agents gets to work.</strong> Each one has a single job, and each one reads the others&apos; work before starting its own.</li>
            <li><strong>Push back.</strong> Every agent has a chat. Ask where a number came from, disagree, or ask it to go deeper.</li>
          </ol>
        </section>

        <section className="landing-section" aria-labelledby="different">
          <h2 id="different">What makes it different</h2>
          <div className="landing-grid">
            <div className="landing-card"><h3>It argues with you.</h3><p>A Contrarian agent attacks your idea before your audience can.</p></div>
            <div className="landing-card"><h3>It reads like a stranger.</h3><p>A Cold Reader agent checks whether someone who&apos;s never heard of you would understand the hook.</p></div>
            <div className="landing-card"><h3>It won&apos;t make things up.</h3><p>Every claim cites its source, and anything unsourced is flagged.</p></div>
            <div className="landing-card"><h3>It sounds like you.</h3><p>It&apos;s built to cut the phrases that make posts read like AI wrote them.</p></div>
          </div>
        </section>

        <section className="landing-close">
          <h2>Your next post starts with a better idea.</h2>
          <RequestAccess id="close" />
        </section>
      </main>

      <footer className="landing-foot">
        <span>© {new Date().getFullYear()} Sarah Shaefer</span>
        <a href="/login">Sign in</a>
      </footer>
    </div>
  );
}
