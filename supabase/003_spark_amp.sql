-- Voltage Labs: label each project as Spark (research an idea) or Amp (brand and
-- posts), and let a Spark project and an Amp project point at each other.
-- Paste into Supabase → SQL Editor → New query → Run. Safe to run more than once.
alter table public.projects
  add column if not exists kind text not null default 'amp';

alter table public.projects
  add column if not exists linked_project_id uuid references public.projects(id) on delete set null;
