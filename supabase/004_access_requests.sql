-- Access requests from the public landing page.
-- Visitors can add a request but can never read, change or delete any.
create table if not exists public.access_requests (
  id         uuid primary key default gen_random_uuid(),
  email      text not null check (char_length(email) between 3 and 254),
  created_at timestamptz not null default now()
);

alter table public.access_requests enable row level security;

drop policy if exists "anyone can request access" on public.access_requests;
create policy "anyone can request access" on public.access_requests
  for insert to anon, authenticated with check (true);
