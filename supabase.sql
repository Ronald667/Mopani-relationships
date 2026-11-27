-- Mopani Singles-v2 Supabase Database, Realtime & Storage Setup
-- Run this in your Supabase SQL Editor to create or migrate tables, policies, and storage buckets.

create extension if not exists pgcrypto;

-- 1. Profiles table
create table if not exists public.profiles (
  id uuid primary key default gen_random_uuid(),
  full_name text not null default '',
  age integer not null default 18 check (age >= 18),
  gender text not null default 'Female',
  municipality text not null default '',
  village text not null default '',
  language text not null default 'Sepedi',
  intention text not null default 'Dating',
  bio text not null default '',
  whatsapp text not null default '',
  email text not null default '',
  email_verified boolean not null default false,
  auth_user_id uuid,
  email_notifications boolean not null default true,
  photo_url text not null default '',
  is_verified boolean not null default false,
  verification_status text not null default 'unverified',
  verification_selfie_url text not null default '',
  verification_requested_at timestamptz,
  verification_reviewed_at timestamptz,
  verification_note text not null default '',
  is_approved boolean not null default true,
  is_banned boolean not null default false,
  boosted_until timestamptz,
  boost_points integer not null default 100,
  last_boosted_at timestamptz,
  last_points_claim_at timestamptz,
  created_at timestamptz not null default now()
);

-- Migrate existing starter-template profiles tables (remove auth.users FK and add missing columns)
alter table public.profiles drop constraint if exists profiles_id_fkey;
alter table public.profiles alter column id set default gen_random_uuid();

alter table public.profiles add column if not exists full_name text not null default '';
alter table public.profiles add column if not exists age integer not null default 18;
alter table public.profiles add column if not exists gender text not null default 'Female';
alter table public.profiles add column if not exists municipality text not null default '';
alter table public.profiles add column if not exists village text not null default '';
alter table public.profiles add column if not exists language text not null default 'Sepedi';
alter table public.profiles add column if not exists intention text not null default 'Dating';
alter table public.profiles add column if not exists bio text not null default '';
alter table public.profiles add column if not exists whatsapp text not null default '';
alter table public.profiles add column if not exists email text not null default '';
alter table public.profiles add column if not exists email_verified boolean not null default false;
alter table public.profiles add column if not exists auth_user_id uuid;
alter table public.profiles add column if not exists email_notifications boolean not null default true;
alter table public.profiles add column if not exists photo_url text not null default '';
alter table public.profiles add column if not exists is_verified boolean not null default false;
alter table public.profiles add column if not exists verification_status text not null default 'unverified';
alter table public.profiles add column if not exists verification_selfie_url text not null default '';
alter table public.profiles add column if not exists verification_requested_at timestamptz;
alter table public.profiles add column if not exists verification_reviewed_at timestamptz;
alter table public.profiles add column if not exists verification_note text not null default '';
alter table public.profiles add column if not exists is_approved boolean not null default true;
alter table public.profiles add column if not exists is_banned boolean not null default false;
alter table public.profiles add column if not exists boosted_until timestamptz;
alter table public.profiles add column if not exists boost_points integer not null default 100;
alter table public.profiles add column if not exists last_boosted_at timestamptz;
alter table public.profiles add column if not exists last_points_claim_at timestamptz;
alter table public.profiles add column if not exists created_at timestamptz not null default now();

create index if not exists profiles_boosted_until_idx
  on public.profiles (boosted_until desc);

-- Enforce one profile per user safely when existing data permits
do $$
begin
  create unique index if not exists profiles_unique_auth_user_id_idx
    on public.profiles (auth_user_id)
    where auth_user_id is not null;
exception when unique_violation then null;
end $$;

do $$
begin
  create unique index if not exists profiles_unique_email_idx
    on public.profiles (lower(email))
    where email <> '';
exception when unique_violation then null;
end $$;

do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'profiles' and column_name = 'name'
  ) then
    alter table public.profiles alter column name drop not null;
    update public.profiles set full_name = coalesce(nullif(full_name, ''), name, '') where full_name = '';
  end if;

  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'profiles' and column_name = 'avatar_url'
  ) then
    alter table public.profiles alter column avatar_url drop not null;
    update public.profiles set photo_url = coalesce(nullif(photo_url, ''), avatar_url, '') where photo_url = '';
  end if;
end $$;

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

-- 4. Server-only app settings table (used for admin verification credential hash)
create table if not exists public.app_settings (
  key text primary key,
  value text not null default '',
  updated_at timestamptz not null default now()
);

-- 5. Server-only Boost transactions ledger (points deductions & payment gateway references)
create table if not exists public.boost_transactions (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null,
  method text not null,
  amount_cents integer not null default 0,
  currency text not null default 'ZAR',
  points_spent integer not null default 0,
  status text not null default 'completed',
  gateway_reference text not null default '',
  boosted_until timestamptz,
  created_at timestamptz not null default now()
);

create unique index if not exists boost_transactions_unique_ref_idx
  on public.boost_transactions (gateway_reference)
  where gateway_reference <> '';

-- 5b. Local Singles Events table (Mopani district community meet-ups)
create table if not exists public.events (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  municipality text not null,
  venue text not null,
  event_date timestamptz not null,
  description text not null default '',
  category text not null default 'Community Meet-Up',
  host_name text not null default 'Mopani Singles Community',
  is_published boolean not null default true,
  created_at timestamptz not null default now()
);

create index if not exists events_date_idx
  on public.events (event_date asc);

-- 6. Enable Row Level Security with public app policies (app_settings & boost_transactions remain server-only)
alter table public.profiles enable row level security;
alter table public.messages enable row level security;
alter table public.reports enable row level security;
alter table public.app_settings enable row level security;
alter table public.boost_transactions enable row level security;
alter table public.events enable row level security;

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

drop policy if exists "Public events read" on public.events;
create policy "Public events read" on public.events for select using (is_published = true);

-- Seed starter Mopani district community events if table is empty
insert into public.events (title, municipality, venue, event_date, description, category, host_name, is_published)
select * from (
  values
    (
      'Tzaneen Friday Sundowner & Coffee Mixer',
      'Greater Tzaneen',
      'Tzaneen Lifestyle Centre Courtyard, Agatha St',
      now() + interval '4 days',
      'Relaxed early-evening coffee and conversation for Mopani singles looking to meet face-to-face in a safe public venue.',
      'Coffee Mixer',
      'Mopani Singles Community',
      true
    ),
    (
      'Hoedspruit Weekend Brunch & Walk',
      'Maruleng',
      'Kamogelo Tourism Centre Gardens, Hoedspruit',
      now() + interval '9 days',
      'Casual Saturday morning brunch and friendly introductions for Maruleng and Hoedspruit members.',
      'Brunch Meet-Up',
      'Maruleng Hosts',
      true
    ),
    (
      'Phalaborwa Sunset Social & Braai',
      'Ba-Phalaborwa',
      'Hans Merensky Leisure Lawn, Phalaborwa',
      now() + interval '14 days',
      'Community social evening with light music, icebreakers, and easy-going conversation in Ba-Phalaborwa.',
      'Social Evening',
      'Ba-Phalaborwa Singles',
      true
    )
) as seed(title, municipality, venue, event_date, description, category, host_name, is_published)
where not exists (select 1 from public.events);

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

do $$
begin
  alter publication supabase_realtime add table public.events;
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

-- Private bucket for identity verification selfies (accessed only by server/admin via signed URLs)
insert into storage.buckets (id, name, public)
values ('verifications', 'verifications', false)
on conflict (id) do update set public = false;

-- Refresh PostgREST schema cache so API clients see all new columns immediately
notify pgrst, 'reload schema';

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


