import { createClient, type SupabaseClient } from '@supabase/supabase-js'

const DEFAULT_SUPABASE_URL = 'https://fmsnansclqsrupufalhz.supabase.co'

const getEnv = (keys: string[]): string => {
  for (const key of keys) {
    try {
      if (typeof process !== 'undefined' && process.env && process.env[key]) {
        return process.env[key] as string
      }
    } catch {}

    try {
      // @ts-ignore
      if (typeof import.meta !== 'undefined' && import.meta.env && import.meta.env[key]) {
        // @ts-ignore
        return import.meta.env[key] as string
      }
    } catch {}
  }
  return ''
}

function resolveValidSupabaseUrl(raw?: string): string {
  const val = (raw || '').trim()
  if (!val || val.startsWith('sb_') || val.startsWith('eyJ')) return DEFAULT_SUPABASE_URL
  const normalized = /^https?:\/\//i.test(val)
    ? val
    : /^[a-z0-9.-]+\.[a-z]{2,}(\/.*)?$/i.test(val)
    ? `https://${val}`
    : ''
  if (!normalized) return DEFAULT_SUPABASE_URL
  try {
    const parsed = new URL(normalized)
    if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
      return parsed.origin
    }
  } catch {
    // fallback to default
  }
  return DEFAULT_SUPABASE_URL
}

export let supabaseUrl = resolveValidSupabaseUrl(
  getEnv(['VITE_SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_URL'])
)

let publicKey = getEnv([
  'VITE_SUPABASE_PUBLISHABLE_KEY',
  'NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY',
  'VITE_SUPABASE_ANON_KEY',
  'NEXT_PUBLIC_SUPABASE_ANON_KEY',
]).trim()

function resolveValidStorageBucket(raw?: string): string {
  const val = (raw || '').trim()
  if (
    !val ||
    val.startsWith('sb_') ||
    val.startsWith('eyJ') ||
    val.startsWith('http://') ||
    val.startsWith('https://')
  ) {
    return 'mopani-files'
  }
  return /^[a-z0-9][a-z0-9._-]{1,61}[a-z0-9]$/i.test(val) ? val : 'mopani-files'
}

export const SUPABASE_PROFILES_BUCKET = 'profiles'

export let SUPABASE_STORAGE_BUCKET = resolveValidStorageBucket(
  getEnv(['VITE_SUPABASE_STORAGE_BUCKET', 'NEXT_PUBLIC_SUPABASE_STORAGE_BUCKET'])
)

export let isSupabaseKeyConfigured = Boolean(publicKey)

function buildClient(url: string, key: string): SupabaseClient | null {
  if (!url || !key) return null
  try {
    return createClient(resolveValidSupabaseUrl(url), key, {
      realtime: {
        params: {
          eventsPerSecond: 10,
        },
      },
    })
  } catch {
    return null
  }
}

let activeClient: SupabaseClient | null = buildClient(supabaseUrl, publicKey)

export async function hydrateSupabaseFromServerConfig(): Promise<void> {
  if (activeClient) return
  try {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 1500)
    const res = await fetch('/api/supabase/config', { signal: controller.signal })
    clearTimeout(timeout)
    if (!res.ok) return
    const cfg = (await res.json()) as {
      url?: string
      publishableKey?: string
      storageBucket?: string
    }
    if (cfg.url) supabaseUrl = resolveValidSupabaseUrl(cfg.url)
    if (cfg.storageBucket) SUPABASE_STORAGE_BUCKET = resolveValidStorageBucket(cfg.storageBucket)
    if (cfg.publishableKey) {
      publicKey = cfg.publishableKey.trim()
      isSupabaseKeyConfigured = Boolean(publicKey)
      activeClient = buildClient(supabaseUrl, publicKey)
    }
  } catch {
    // Offline or no server config available; local fallback remains active
  }
}

const UNCONFIGURED_ERROR = {
  message: 'Supabase publishable key is not configured yet.',
}

function createUnconfiguredChannel() {
  const noopChannel = {
    on: () => noopChannel,
    subscribe: () => noopChannel,
    unsubscribe: async () => 'ok' as const,
  }
  return noopChannel
}

function createUnconfiguredQuery() {
  const result = { data: null, error: UNCONFIGURED_ERROR }
  const builder: Record<string, unknown> = {
    then: (resolve: (val: typeof result) => unknown) => Promise.resolve(resolve(result)),
  }
  const chainMethods = [
    'select',
    'insert',
    'upsert',
    'update',
    'delete',
    'eq',
    'neq',
    'in',
    'or',
    'order',
    'limit',
    'single',
    'maybeSingle',
  ]
  for (const method of chainMethods) {
    builder[method] = () => builder
  }
  return builder
}

const unconfiguredFallback = {
  from: () => createUnconfiguredQuery(),
  channel: () => createUnconfiguredChannel(),
  removeChannel: async () => 'ok' as const,
  storage: {
    from: () => ({
      upload: async () => ({ data: null, error: UNCONFIGURED_ERROR }),
      getPublicUrl: () => ({ data: { publicUrl: '' } }),
      remove: async () => ({ data: null, error: UNCONFIGURED_ERROR }),
    }),
  },
}

export const supabase: SupabaseClient = new Proxy({} as SupabaseClient, {
  get(_target, prop) {
    const target = (activeClient || unconfiguredFallback) as unknown as Record<PropertyKey, unknown>
    const value = target[prop]
    if (typeof value === 'function') {
      return value.bind(target)
    }
    return value
  },
})

export const testSupabaseConnection = async () => {
  if (!activeClient) {
    return { success: false, error: UNCONFIGURED_ERROR.message }
  }
  try {
    const { data, error } = await activeClient.from('profiles').select('id').limit(1)
    if (error) {
      return { success: false, error: error.message }
    }
    return { success: true, data }
  } catch (err: unknown) {
    return { success: false, error: err instanceof Error ? err.message : 'Connection error' }
  }
}
