// Saves an access request from the landing page. Public (no sign-in), so it only
// ever inserts: Row Level Security lets visitors add a row but never read one.
// Requests show up in Supabase → Table Editor → access_requests.
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

export async function POST(req) {
  const { email, website } = await req.json().catch(() => ({}));
  if (website) return NextResponse.json({ ok: true }); // hidden field filled: a bot
  const clean = String(email || "").trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(clean) || clean.length > 254) {
    return NextResponse.json({ error: "That doesn't look like an email address." }, { status: 400 });
  }
  const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
    auth: { persistSession: false },
  });
  const { error } = await supabase.from("access_requests").insert({ email: clean });
  if (error) {
    console.error("[request-access]", error.message);
    return NextResponse.json({ error: "Couldn't save that right now. Try again in a minute, or book a call instead." }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
