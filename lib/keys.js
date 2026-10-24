// Which Anthropic API key to bill a signed-in person's usage to. Server-only.
//
// To give someone their own key (so their usage shows separately in the
// Anthropic Console), add a matching pair in Vercel and redeploy:
//   EMAIL_USERn         = the email they sign in with
//   ANTHROPIC_KEY_USERn = the key you made for them in the Anthropic Console
// The number is just a slot: USER1, USER2, USER3... Anyone not listed uses
// the shared ANTHROPIC_API_KEY.

export function keyForEmail(email) {
  const e = String(email ?? "").trim().toLowerCase();
  if (e) {
    for (let i = 1; i <= 50; i++) {
      const listed = process.env[`EMAIL_USER${i}`]?.trim().toLowerCase();
      const key = process.env[`ANTHROPIC_KEY_USER${i}`]?.trim();
      if (listed && key && listed === e) return key;
    }
  }
  return process.env.ANTHROPIC_API_KEY;
}
