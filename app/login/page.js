"use client";

import { useState, useEffect } from "react";
import { getBrowserSupabase, supabaseConfigured } from "../../lib/supabase";

export default function Login() {
  const [email, setEmail]   = useState("");
  const [status, setStatus] = useState("idle"); // idle | sending | sent | error
  const [message, setMessage] = useState("");

  useEffect(() => {
    if (new URLSearchParams(window.location.search).get("error") === "link") {
      setStatus("error");
      setMessage("That sign-in link expired or was already used. Send yourself a new one.");
    }
  }, []);

  async function sendLink(e) {
    e.preventDefault();
    if (!email.trim()) return;
    setStatus("sending");
    const { error } = await getBrowserSupabase().auth.signInWithOtp({
      email: email.trim(),
      options: { emailRedirectTo: `${window.location.origin}/auth/callback` },
    });
    if (error) {
      setStatus("error");
      setMessage(error.message);
    } else {
      setStatus("sent");
    }
  }

  return (
    <div className="wizard-wrap">
      <div className="wizard-logo">
        <span className="wizard-logo-mark" />
        High Voltage
      </div>
      <div className="login-card">
        <div className="wizard-heading">Sign in</div>

        {!supabaseConfigured ? (
          <div className="wizard-sub">
            Cloud saving isn&apos;t set up yet. Add the Supabase URL and anon key to the environment variables.
          </div>
        ) : status === "sent" ? (
          <div className="wizard-sub">
            Check <strong>{email}</strong> for a sign-in link. Open it in this same browser.
          </div>
        ) : (
          <form onSubmit={sendLink}>
            <div className="wizard-sub">We&apos;ll email you a link. No password needed.</div>
            <div className="field">
              <div className="field-label">Email</div>
              <input
                type="email"
                autoComplete="email"
                placeholder="you@example.com"
                value={email}
                onChange={e => setEmail(e.target.value)}
                required
              />
            </div>
            {status === "error" && <div className="login-error">{message}</div>}
            <button className="next-btn" type="submit" disabled={status === "sending"}>
              {status === "sending" ? "Sending..." : "Email me a sign-in link"}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
