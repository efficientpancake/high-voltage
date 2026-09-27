// Sign-in gate. Every page and API call requires a logged-in user, except the
// login page and the magic-link callback. This also keeps strangers who find the
// URL from spending Anthropic credits through /api/generate.
import { NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";

const PUBLIC_PATHS = ["/login", "/auth/callback"];

export async function middleware(req) {
  const { pathname } = req.nextUrl;
  const isPublic = PUBLIC_PATHS.some(p => pathname.startsWith(p));
  const isApi = pathname.startsWith("/api/");

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) {
    // Fail closed: never leave the app open because config is missing.
    if (isPublic) return NextResponse.next();
    if (isApi) return new NextResponse("Supabase is not configured.", { status: 500 });
    return NextResponse.redirect(new URL("/login", req.url));
  }

  let res = NextResponse.next({ request: req });
  const supabase = createServerClient(url, key, {
    cookies: {
      getAll: () => req.cookies.getAll(),
      setAll: (cookiesToSet) => {
        cookiesToSet.forEach(({ name, value }) => req.cookies.set(name, value));
        res = NextResponse.next({ request: req });
        cookiesToSet.forEach(({ name, value, options }) => res.cookies.set(name, value, options));
      },
    },
  });

  // Refreshes the session cookie if needed. Must run on every request.
  const { data: { user } } = await supabase.auth.getUser();

  if (!user && !isPublic) {
    if (isApi) return new NextResponse("Please sign in.", { status: 401 });
    return NextResponse.redirect(new URL("/login", req.url));
  }
  if (user && pathname === "/login") {
    return NextResponse.redirect(new URL("/", req.url));
  }
  return res;
}

export const config = {
  // Skip Next.js internals and static files.
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:png|jpg|jpeg|svg|gif|webp|ico)$).*)"],
};
