import {
  getSupabaseConfigSnapshot,
  getSupabasePublicKey,
  hydrateSupabaseFromServerConfig,
  isServerSupabaseProxyAvailable,
  type SupabaseKeyKind,
} from './client'

export type DiagnosticCheckStatus = 'pass' | 'warning' | 'error'

export interface DiagnosticCheckItem {
  id: 'url' | 'anonKey' | 'database' | 'storage'
  label: string
  status: DiagnosticCheckStatus
  detail: string
}

export interface SupabaseDiagnosticReport {
  overallStatus: 'healthy' | 'warning' | 'error'
  checkedAt: string
  latencyMs: number
  projectUrl: string
  keyKind: SupabaseKeyKind
  headline: string
  summary: string
  actionHint?: string
  schemaMigrationNeeded: boolean
  configIssue: boolean
  serverProxyActive: boolean
  checks: DiagnosticCheckItem[]
}

export const PROFILE_MIGRATION_SQL = `alter table public.profiles drop constraint if exists profiles_id_fkey;
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
  end if;
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'profiles' and column_name = 'avatar_url'
  ) then
    alter table public.profiles alter column avatar_url drop not null;
  end if;
end $$;

create table if not exists public.app_settings (
  key text primary key,
  value text not null default '',
  updated_at timestamptz not null default now()
);

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

alter table public.profiles enable row level security;
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

drop policy if exists "Public events read" on public.events;
create policy "Public events read" on public.events for select using (is_published = true);

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

insert into storage.buckets (id, name, public)
values ('verifications', 'verifications', false)
on conflict (id) do update set public = false;

notify pgrst, 'reload schema';`

interface HealthResponse {
  ok?: boolean
  supabaseUrl?: string
  serverProxyAvailable?: boolean
  adminDbConnected?: boolean
  publicDbConnected?: boolean
  dbError?: string | null
}

export async function runSupabaseDiagnostics(): Promise<SupabaseDiagnosticReport> {
  const startedAt = typeof performance !== 'undefined' ? performance.now() : Date.now()

  await hydrateSupabaseFromServerConfig()

  let health: HealthResponse = {}
  try {
    const healthRes = await fetch('/api/health', { signal: AbortSignal.timeout(4000) })
    if (healthRes.ok) {
      health = (await healthRes.json().catch(() => ({}))) as HealthResponse
    }
  } catch {
    // ignore offline health error
  }

  const snapshot = getSupabaseConfigSnapshot()
  const publicKey = getSupabasePublicKey()
  const serverProxyReady = Boolean(
    (health.serverProxyAvailable ?? isServerSupabaseProxyAvailable()) && health.adminDbConnected
  )

  let urlCheck: DiagnosticCheckItem = {
    id: 'url',
    label: 'Supabase Project URL',
    status: 'pass',
    detail: `Valid endpoint (${health.supabaseUrl || snapshot.url})`,
  }

  if (snapshot.urlMalformed && !serverProxyReady) {
    urlCheck = {
      id: 'url',
      label: 'Supabase Project URL',
      status: 'error',
      detail:
        'VITE_SUPABASE_URL is malformed. Set it to your https://<project-ref>.supabase.co URL.',
    }
  }

  let keyCheck: DiagnosticCheckItem = {
    id: 'anonKey',
    label: 'Anon / Publishable Key',
    status: 'pass',
    detail:
      snapshot.keyKind === 'publishable'
        ? 'Publishable client key configured'
        : 'Legacy anon client key configured',
  }

  if (!snapshot.hasKey || snapshot.keyKind === 'missing') {
    keyCheck = serverProxyReady
      ? {
          id: 'anonKey',
          label: 'Anon / Publishable Key',
          status: 'warning',
          detail:
            'No browser anon/publishable key is set; profiles and photos are routed through the active server connection.',
        }
      : {
          id: 'anonKey',
          label: 'Anon / Publishable Key',
          status: 'error',
          detail:
            'No Supabase anon or publishable key found. Add VITE_SUPABASE_ANON_KEY in Secrets.',
        }
  } else if (snapshot.keyKind === 'secret_key_error') {
    keyCheck = serverProxyReady
      ? {
          id: 'anonKey',
          label: 'Anon / Publishable Key',
          status: 'warning',
          detail:
            'Browser key slot contains a secret key (blocked safely in the browser). Profile saving, photos, and chat are active through the server connection.',
        }
      : {
          id: 'anonKey',
          label: 'Anon / Publishable Key',
          status: 'error',
          detail:
            'A private service_role/secret key is exposed in the client key slot. Replace it with your anon/publishable key.',
        }
  } else if (snapshot.keyKind === 'unknown') {
    keyCheck = {
      id: 'anonKey',
      label: 'Anon / Publishable Key',
      status: 'warning',
      detail: 'Key format is unrecognized; testing connection...',
    }
  }

  let dbCheck: DiagnosticCheckItem = {
    id: 'database',
    label: 'Profiles Table & Columns',
    status: 'error',
    detail: 'Waiting for valid Supabase URL and anon key before probing database.',
  }

  let storageCheck: DiagnosticCheckItem = {
    id: 'storage',
    label: "Profile Photo Bucket ('profiles')",
    status: 'warning',
    detail: 'Waiting for valid Supabase URL and anon key before probing storage.',
  }

  let schemaMigrationNeeded = false
  let configIssue = urlCheck.status === 'error' || keyCheck.status === 'error'
  let serverProxyActive = false

  if (!configIssue && publicKey && snapshot.keyKind !== 'secret_key_error') {
    try {
      const dbRes = await fetch(
        `${snapshot.url}/rest/v1/profiles?select=id,full_name,age,gender,municipality,village,language,intention,bio,whatsapp,photo_url,is_approved,is_banned,created_at&limit=1`,
        {
          headers: {
            apikey: publicKey,
            Authorization: `Bearer ${publicKey}`,
          },
          signal: AbortSignal.timeout(5000),
        }
      )

      if (dbRes.status === 401 || dbRes.status === 403) {
        if (serverProxyReady) {
          keyCheck = {
            id: 'anonKey',
            label: 'Anon / Publishable Key',
            status: 'warning',
            detail: `Browser key rejected (HTTP ${dbRes.status}); using active server connection instead.`,
          }
        } else {
          configIssue = true
          keyCheck = {
            id: 'anonKey',
            label: 'Anon / Publishable Key',
            status: 'error',
            detail: `Supabase rejected the anon/publishable key (HTTP ${dbRes.status}). Copy the correct key from Project Settings -> API Keys.`,
          }
          dbCheck = {
            id: 'database',
            label: 'Profiles Table & Columns',
            status: 'error',
            detail: 'Database check blocked because the anon key was rejected.',
          }
        }
      } else if (dbRes.ok) {
        dbCheck = {
          id: 'database',
          label: 'Profiles Table & Columns',
          status: 'pass',
          detail: 'Connected and all required profile columns are present.',
        }
      } else {
        const errJson = (await dbRes.json().catch(() => ({}))) as {
          code?: string
          message?: string
        }
        const msg = errJson.message || `HTTP ${dbRes.status}`
        if (
          errJson.code === 'PGRST204' ||
          errJson.code === '42P01' ||
          /column|schema cache|does not exist/i.test(msg)
        ) {
          schemaMigrationNeeded = true
          dbCheck = {
            id: 'database',
            label: 'Profiles Table & Columns',
            status: 'error',
            detail: `Profiles table schema mismatch (${msg}). Run the fix SQL in Supabase SQL Editor.`,
          }
        } else {
          dbCheck = {
            id: 'database',
            label: 'Profiles Table & Columns',
            status: 'error',
            detail: `Unable to query profiles table: ${msg}`,
          }
        }
      }
    } catch {
      if (!serverProxyReady) {
        configIssue = true
        dbCheck = {
          id: 'database',
          label: 'Profiles Table & Columns',
          status: 'error',
          detail:
            'Could not reach Supabase URL. Check that VITE_SUPABASE_URL matches your active Supabase project.',
        }
      }
    }

    if (!configIssue && dbCheck.status === 'pass') {
      try {
        const storageRes = await fetch(`${snapshot.url}/storage/v1/object/list/profiles`, {
          method: 'POST',
          headers: {
            apikey: publicKey,
            Authorization: `Bearer ${publicKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ prefix: '', limit: 1 }),
          signal: AbortSignal.timeout(5000),
        })

        if (storageRes.ok) {
          storageCheck = {
            id: 'storage',
            label: "Profile Photo Bucket ('profiles')",
            status: 'pass',
            detail: 'Public profiles storage bucket is reachable.',
          }
        } else {
          storageCheck = {
            id: 'storage',
            label: "Profile Photo Bucket ('profiles')",
            status: 'warning',
            detail: `Storage check returned HTTP ${storageRes.status}. Ensure the 'profiles' bucket and policies from supabase.sql are applied.`,
          }
        }
      } catch {
        storageCheck = {
          id: 'storage',
          label: "Profile Photo Bucket ('profiles')",
          status: 'warning',
          detail: 'Could not reach Supabase Storage bucket right now.',
        }
      }
    }
  }

  if (serverProxyReady && dbCheck.status !== 'pass' && !schemaMigrationNeeded) {
    try {
      const [profilesRes, bucketRes] = await Promise.all([
        fetch('/api/profiles', { signal: AbortSignal.timeout(4000) }),
        fetch('/api/storage/ensure-bucket', {
          method: 'POST',
          signal: AbortSignal.timeout(4000),
        }),
      ])

      if (profilesRes.ok) {
        serverProxyActive = true
        configIssue = false
        dbCheck = {
          id: 'database',
          label: 'Profiles Table & Columns',
          status: 'pass',
          detail: 'Connected via server proxy — profiles table and required columns are ready.',
        }
      } else {
        const errBody = (await profilesRes.json().catch(() => ({}))) as { error?: string }
        const msg = errBody.error || health.dbError || `HTTP ${profilesRes.status}`
        if (/column|schema cache|does not exist|PGRST204|42P01/i.test(msg)) {
          schemaMigrationNeeded = true
          dbCheck = {
            id: 'database',
            label: 'Profiles Table & Columns',
            status: 'error',
            detail: `Profiles table schema mismatch (${msg}). Run the fix SQL in Supabase SQL Editor.`,
          }
        } else {
          dbCheck = {
            id: 'database',
            label: 'Profiles Table & Columns',
            status: 'error',
            detail: `Server database probe failed: ${msg}`,
          }
        }
      }

      if (bucketRes.ok) {
        storageCheck = {
          id: 'storage',
          label: "Profile Photo Bucket ('profiles')",
          status: 'pass',
          detail: "Public 'profiles' photo bucket is active via server storage.",
        }
      } else {
        storageCheck = {
          id: 'storage',
          label: "Profile Photo Bucket ('profiles')",
          status: 'warning',
          detail: "Could not verify 'profiles' bucket on server.",
        }
      }
    } catch {
      // keep earlier error
    }
  }

  const checks = [urlCheck, keyCheck, dbCheck, storageCheck]
  const hasError = checks.some((c) => c.status === 'error')
  const hasWarning = checks.some((c) => c.status === 'warning')
  const overallStatus: SupabaseDiagnosticReport['overallStatus'] = hasError
    ? 'error'
    : hasWarning
    ? 'warning'
    : 'healthy'

  let headline = 'Supabase Connected & Ready'
  let summary = 'Your Supabase URL, anon key, profiles table, and photo bucket are ready.'
  let actionHint: string | undefined

  if (urlCheck.status === 'error') {
    headline = 'Supabase Project URL Misconfigured'
    summary = urlCheck.detail
    actionHint =
      'Set VITE_SUPABASE_URL to https://<your-project-ref>.supabase.co in Secrets.'
  } else if (keyCheck.status === 'error') {
    headline = 'Supabase Anon Key Misconfigured'
    summary = keyCheck.detail
    actionHint =
      'Copy the Publishable or Legacy anon public key from Supabase Dashboard -> Project Settings -> API Keys.'
  } else if (schemaMigrationNeeded) {
    headline = 'Supabase Profiles Table Needs Migration'
    summary =
      'Your Supabase connection is live, but the profiles table is missing required columns.'
    actionHint = 'Copy and run the migration SQL in your Supabase SQL Editor, then click Re-check.'
  } else if (dbCheck.status === 'error') {
    headline = 'Supabase Connection Issue'
    summary = dbCheck.detail
    actionHint = 'Verify your project is active in Supabase Dashboard and click Re-check.'
  } else if (serverProxyActive && hasWarning) {
    headline = 'Server Supabase Connected (Profile Saving Active)'
    summary =
      'Profile saving, photo uploads, discovery, chat, and safety reports are active through the secure server connection.'
    actionHint = 'No extra browser key setup is required to save profiles or upload photos.'
  } else if (hasWarning) {
    headline = 'Supabase Connected with Warnings'
    summary = storageCheck.detail
  }

  const endedAt = typeof performance !== 'undefined' ? performance.now() : Date.now()

  return {
    overallStatus,
    checkedAt: new Date().toLocaleTimeString(),
    latencyMs: Math.max(1, Math.round(endedAt - startedAt)),
    projectUrl: health.supabaseUrl || snapshot.url,
    keyKind: snapshot.keyKind,
    headline,
    summary,
    actionHint,
    schemaMigrationNeeded,
    configIssue,
    serverProxyActive,
    checks,
  }
}
