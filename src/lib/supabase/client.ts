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

const rawConfiguredUrl = getEnv(['VITE_SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_URL']).trim()

export let supabaseUrl = resolveValidSupabaseUrl(rawConfiguredUrl)

let publicKey = getEnv([
  'VITE_SUPABASE_PUBLISHABLE_KEY',
  'NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY',
  'VITE_SUPABASE_ANON_KEY',
  'NEXT_PUBLIC_SUPABASE_ANON_KEY',
]).trim()

let serverReportedUrl = ''

export type SupabaseKeyKind =
  | 'missing'
  | 'publishable'
  | 'anon_jwt'
  | 'secret_key_error'
  | 'unknown'

export function classifySupabaseKey(key: string): SupabaseKeyKind {
  const trimmed = (key || '').trim()
  if (!trimmed) return 'missing'
  if (trimmed.startsWith('sb_secret_')) return 'secret_key_error'
  if (trimmed.startsWith('sb_publishable_')) return 'publishable'
  if (trimmed.startsWith('eyJ')) {
    try {
      const parts = trimmed.split('.')
      if (parts.length === 3) {
        const base64 = parts[1].replace(/-/g, '+').replace(/_/g, '/')
        const payload = JSON.parse(atob(base64)) as { role?: string }
        if (payload.role === 'service_role') return 'secret_key_error'
        if (payload.role === 'anon') return 'anon_jwt'
      }
    } catch {
      // malformed JWT falls through to unknown
    }
    return 'unknown'
  }
  return 'unknown'
}

export function getSupabasePublicKey(): string {
  return publicKey
}

export function getSupabaseConfigSnapshot(): {
  url: string
  rawConfiguredUrl: string
  urlMalformed: boolean
  hasKey: boolean
  keyKind: SupabaseKeyKind
} {
  const effectiveRaw = serverReportedUrl || rawConfiguredUrl
  let urlMalformed = false
  if (effectiveRaw) {
    if (effectiveRaw.startsWith('sb_') || effectiveRaw.startsWith('eyJ')) {
      urlMalformed = true
    } else {
      try {
        const parsed = new URL(
          /^https?:\/\//i.test(effectiveRaw) ? effectiveRaw : `https://${effectiveRaw}`
        )
        urlMalformed = parsed.protocol !== 'https:' && parsed.protocol !== 'http:'
      } catch {
        urlMalformed = true
      }
    }
  }
  return {
    url: supabaseUrl,
    rawConfiguredUrl: effectiveRaw,
    urlMalformed,
    hasKey: Boolean(publicKey),
    keyKind: classifySupabaseKey(publicKey),
  }
}

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

export let isSupabaseKeyConfigured = Boolean(
  publicKey && classifySupabaseKey(publicKey) !== 'secret_key_error'
)

let serverProxyAvailable = false
let hydrationPromise: Promise<void> | null = null

export function isServerSupabaseProxyAvailable(): boolean {
  return serverProxyAvailable
}

function buildClient(url: string, key: string): SupabaseClient | null {
  if (!url || !key) return null
  if (classifySupabaseKey(key) === 'secret_key_error') return null
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

export function hasDirectClientSupabase(): boolean {
  return Boolean(activeClient)
}

export async function hydrateSupabaseFromServerConfig(): Promise<void> {
  if (hydrationPromise) return hydrationPromise

  hydrationPromise = (async () => {
    try {
      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), 2000)
      const res = await fetch('/api/supabase/config', { signal: controller.signal })
      clearTimeout(timeout)
      if (!res.ok) return
      const cfg = (await res.json()) as {
        url?: string
        publishableKey?: string
        storageBucket?: string
        serverProxyAvailable?: boolean
      }
      if (typeof cfg.serverProxyAvailable === 'boolean') {
        serverProxyAvailable = cfg.serverProxyAvailable
      }
      if (cfg.url) {
        serverReportedUrl = cfg.url.trim()
        supabaseUrl = resolveValidSupabaseUrl(cfg.url)
      }
      if (cfg.storageBucket) SUPABASE_STORAGE_BUCKET = resolveValidStorageBucket(cfg.storageBucket)
      if (
        !activeClient &&
        cfg.publishableKey &&
        classifySupabaseKey(cfg.publishableKey) !== 'secret_key_error'
      ) {
        publicKey = cfg.publishableKey.trim()
        isSupabaseKeyConfigured = Boolean(publicKey)
        activeClient = buildClient(supabaseUrl, publicKey)
      }
    } catch {
      // Offline or no server config available; local/server fallback remains active
    }
  })()

  try {
    await hydrationPromise
  } finally {
    if (!activeClient && !serverProxyAvailable) {
      hydrationPromise = null
    }
  }
}

const UNCONFIGURED_ERROR = {
  message: 'Supabase publishable key is not configured for direct browser access.',
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
  await hydrateSupabaseFromServerConfig()
  if (!activeClient) {
    if (serverProxyAvailable) {
      try {
        const res = await fetch('/api/profiles')
        if (res.ok) {
          return { success: true, data: [] }
        }
      } catch {
        // fall through
      }
    }
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
