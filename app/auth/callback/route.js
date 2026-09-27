// The magic link in the sign-in email lands here. Swaps the one-time code for a
// session cookie, then sends the user into the app.
import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getServerSupabase } from "../../../lib/supabase";

export async function GET(req) {
  const { searchParams, origin } = new URL(req.url);
  const code = searchParams.get("code");

  if (code) {
    const supabase = getServerSupabase(await cookies());
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) return NextResponse.redirect(`${origin}/`);
  }
  return NextResponse.redirect(`${origin}/login?error=link`);
}
