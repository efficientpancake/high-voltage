// Supabase clients. The URL and anon (publishable) key are safe to expose to the
// browser: Row Level Security in supabase/schema.sql is what protects the data.
import { createBrowserClient, createServerClient } from "@supabase/ssr";

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

export const supabaseConfigured = Boolean(URL && KEY);

// Browser client (client components). One shared instance per tab.
let browserClient;
export function getBrowserSupabase() {
  if (!browserClient) browserClient = createBrowserClient(URL, KEY);
  return browserClient;
}

// Server client for route handlers and middleware. `cookieStore` needs
// getAll() and set(name, value, options).
export function getServerSupabase(cookieStore) {
  return createServerClient(URL, KEY, {
    cookies: {
      getAll: () => cookieStore.getAll(),
      setAll: (cookiesToSet) => {
        cookiesToSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options));
      },
    },
  });
}
