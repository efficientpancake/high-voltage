"use client";

// A still heading ("Meet your team.") at the top of the box, then types the agents' names one at a time over the Voltage Arc box on the
// homepage, then erases and moves to the next. With reduced motion it just
// shows the first name. Screen readers get the whole list once.
import { useEffect, useState } from "react";

const NAMES = ["The Researcher.", "The Contrarian.", "The Cold Reader.", "The Post Writer."];
const TYPE_MS = 70, ERASE_MS = 35, HOLD_MS = 1800, GAP_MS = 350;

export default function TeamTicker() {
  const [i, setI] = useState(0);
  const [shown, setShown] = useState(0);
  const [erasing, setErasing] = useState(false);
  const [still, setStill] = useState(false);

  useEffect(() => {
    setStill(window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  }, []);

  useEffect(() => {
    if (still) return;
    const word = NAMES[i];
    let t;
    if (!erasing && shown < word.length) t = setTimeout(() => setShown(shown + 1), TYPE_MS);
    else if (!erasing) t = setTimeout(() => setErasing(true), HOLD_MS);
    else if (shown > 0) t = setTimeout(() => setShown(shown - 1), ERASE_MS);
    else t = setTimeout(() => { setErasing(false); setI((i + 1) % NAMES.length); }, GAP_MS);
    return () => clearTimeout(t);
  }, [i, shown, erasing, still]);

  const text = still ? NAMES[0] : NAMES[i].slice(0, shown);
  return (
    <>
      <p className="team-ticker-intro">Meet your team.</p>
      <div className="team-ticker">
        <span className="landing-sr">{NAMES.join(" ")}</span>
        <span aria-hidden="true">{text}<span className="team-ticker-caret" /></span>
      </div>
    </>
  );
}
