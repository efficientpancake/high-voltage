// Reads a web page through Tavily so Spark can add it as research material.
// Signed-in users only (middleware), and the page is fetched by Tavily, never
// by this server.
import { NextResponse } from "next/server";
import { readWebPage, WebPageError } from "../../../lib/tavily";

export const runtime = "nodejs";
export const maxDuration = 30;

export async function POST(req) {
  const { url } = await req.json().catch(() => ({}));
  try {
    return NextResponse.json(await readWebPage(url));
  } catch (err) {
    if (err instanceof WebPageError) return NextResponse.json({ error: err.message }, { status: 400 });
    console.error("[read-link]", err.message);
    return NextResponse.json({ error: "Couldn't read that page right now. Try again in a minute." }, { status: 500 });
  }
}
