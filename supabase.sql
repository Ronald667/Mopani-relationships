-- Mopani Singles-v2 Supabase Database, Realtime & Storage Setup
-- Run this in your Supabase SQL Editor if tables or storage bucket are not created yet.

create extension if not exists pgcrypto;

-- 1. Profiles table
create table if not exists public.profiles (
  id uuid primary key default gen_random_uuid(),
  full_name text not null,
  age integer not null check (age >= 18),
  gender text not null,
  municipality text not null,
  village text not null,
  language text not null,
  intention text not null,
  bio text not null,
  whatsapp text not null default '',
  email text not null default '',
  email_notifications boolean not null default true,
  photo_url text not null default '',
  is_approved boolean not null default true,
  is_banned boolean not null default false,
  created_at timestamptz not null default now()
);

alter table public.profiles add column if not exists email text not null default '';
alter table public.profiles add column if not exists email_notifications boolean not null default true;

-- 2. Private 1-on-1 messages table
create table if not exists public.messages (
  id uuid primary key default gen_random_uuid(),
  sender_id uuid not null,
  receiver_id uuid not null,
  content text not null,
  email_notified_at timestamptz,
  created_at timestamptz not null default now()
);

alter table public.messages add column if not exists email_notified_at timestamptz;

create index if not exists messages_pair_idx
  on public.messages (sender_id, receiver_id, created_at);

-- 3. Community safety reports table
create table if not exists public.reports (
  id uuid primary key default gen_random_uuid(),
  reported_id text not null,
  reason text not null,
  created_at timestamptz not null default now()
);

-- 4. Enable Row Level Security with public app policies
alter table public.profiles enable row level security;
alter table public.messages enable row level security;
alter table public.reports enable row level security;

drop policy if exists "Public profiles read" on public.profiles;
create policy "Public profiles read" on public.profiles for select using (true);

drop policy if exists "Public profiles insert" on public.profiles;
create policy "Public profiles insert" on public.profiles for insert with check (true);

drop policy if exists "Public profiles update" on public.profiles;
create policy "Public profiles update" on public.profiles for update using (true);

drop policy if exists "Public profiles delete" on public.profiles;
create policy "Public profiles delete" on public.profiles for delete using (true);

drop policy if exists "Public messages read" on public.messages;
create policy "Public messages read" on public.messages for select using (true);

drop policy if exists "Public messages insert" on public.messages;
create policy "Public messages insert" on public.messages for insert with check (true);

drop policy if exists "Public reports read" on public.reports;
create policy "Public reports read" on public.reports for select using (true);

drop policy if exists "Public reports insert" on public.reports;
create policy "Public reports insert" on public.reports for insert with check (true);

-- 5. Enable Supabase Realtime for live profile discovery & private messaging
do $$
begin
  alter publication supabase_realtime add table public.profiles;
exception when duplicate_object then null;
end $$;

do $$
begin
  alter publication supabase_realtime add table public.messages;
exception when duplicate_object then null;
end $$;

-- 6. Supabase Storage buckets for profile photos ('profiles') & shared chat files ('mopani-files')
insert into storage.buckets (id, name, public)
values ('profiles', 'profiles', true)
on conflict (id) do update set public = true;

drop policy if exists "Public read profiles bucket" on storage.objects;
create policy "Public read profiles bucket"
  on storage.objects for select
  using (bucket_id = 'profiles');

drop policy if exists "Public upload profiles bucket" on storage.objects;
create policy "Public upload profiles bucket"
  on storage.objects for insert
  with check (bucket_id = 'profiles');

drop policy if exists "Public update profiles bucket" on storage.objects;
create policy "Public update profiles bucket"
  on storage.objects for update
  using (bucket_id = 'profiles');

drop policy if exists "Public delete profiles bucket" on storage.objects;
create policy "Public delete profiles bucket"
  on storage.objects for delete
  using (bucket_id = 'profiles');

insert into storage.buckets (id, name, public)
values ('mopani-files', 'mopani-files', true)
on conflict (id) do update set public = true;

drop policy if exists "Public read mopani-files" on storage.objects;
create policy "Public read mopani-files"
  on storage.objects for select
  using (bucket_id = 'mopani-files');

drop policy if exists "Public upload mopani-files" on storage.objects;
create policy "Public upload mopani-files"
  on storage.objects for insert
  with check (bucket_id = 'mopani-files');

drop policy if exists "Public update mopani-files" on storage.objects;
create policy "Public update mopani-files"
  on storage.objects for update
  using (bucket_id = 'mopani-files');

drop policy if exists "Public delete mopani-files" on storage.objects;
create policy "Public delete mopani-files"
  on storage.objects for delete
  using (bucket_id = 'mopani-files');

-- 7. Automatic Email Notification Trigger for New Chat Messages
-- Option A (Recommended): In Supabase Dashboard -> Database -> Webhooks -> Create a new hook:
--   Name: notify_new_chat_message
--   Table: public.messages | Events: INSERT
--   Type: Supabase Edge Functions -> notify-new-message
--   Optional Header: x-webhook-secret: <your NOTIFY_WEBHOOK_SECRET>
--
-- Option B (SQL via pg_net): Enable pg_net extension first, then run:
-- create extension if not exists pg_net;
-- create or replace function public.trigger_notify_new_message()
-- returns trigger
-- language plpgsql
-- security definer
-- as $$
-- begin
--   perform net.http_post(
--     url := 'https://fmsnansclqsrupufalhz.supabase.co/functions/v1/notify-new-message',
--     headers := jsonb_build_object(
--       'Content-Type', 'application/json'
--     ),
--     body := jsonb_build_object(
--       'type', 'INSERT',
--       'table', 'messages',
--       'schema', 'public',
--       'record', row_to_json(new)
--     )
--   );
--   return new;
-- end;
-- $$;
--
-- drop trigger if exists on_new_message_notify on public.messages;
-- create trigger on_new_message_notify
--   after insert on public.messages
--   for each row execute function public.trigger_notify_new_message();

