import dotenv from 'dotenv'
dotenv.config({ path: '.env.local' })
dotenv.config()
import express, { type Request, type Response } from 'express'
import path from 'path'
import crypto from 'crypto'
import { fileURLToPath } from 'url'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const DEFAULT_SUPABASE_URL = 'https://fmsnansclqsrupufalhz.supabase.co'

function resolveValidSupabaseUrl(candidates: Array<string | undefined>): string {
  for (const raw of candidates) {
    const val = (raw || '').trim()
    if (!val || val.startsWith('sb_') || val.startsWith('eyJ')) continue
    const normalized = /^https?:\/\//i.test(val)
      ? val
      : /^[a-z0-9.-]+\.[a-z]{2,}(\/.*)?$/i.test(val)
      ? `https://${val}`
      : ''
    if (!normalized) continue
    try {
      const parsed = new URL(normalized)
      if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
        return parsed.origin
      }
    } catch {
      // ignore invalid URL candidates
    }
  }
  return DEFAULT_SUPABASE_URL
}

const PORT = process.env.NODE_ENV === 'production' ? Number(process.env.PORT) || 3000 : 3000

const SUPABASE_URL = resolveValidSupabaseUrl([
  process.env.SUPABASE_URL,
  process.env.VITE_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_URL,
])

const SUPABASE_SECRET_KEY = (process.env.SUPABASE_SECRET_KEY || '').trim()

const SUPABASE_PUBLISHABLE_KEY = (
  process.env.VITE_SUPABASE_PUBLISHABLE_KEY ||
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
  process.env.VITE_SUPABASE_ANON_KEY ||
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
  ''
).trim()

function resolveValidStorageBucket(candidates: Array<string | undefined>): string {
  for (const raw of candidates) {
    const val = (raw || '').trim()
    if (
      !val ||
      val.startsWith('sb_') ||
      val.startsWith('eyJ') ||
      val.startsWith('http://') ||
      val.startsWith('https://')
    ) {
      continue
    }
    if (/^[a-z0-9][a-z0-9._-]{1,61}[a-z0-9]$/i.test(val)) {
      return val
    }
  }
  return 'mopani-files'
}

const STORAGE_BUCKET = resolveValidStorageBucket([
  process.env.VITE_SUPABASE_STORAGE_BUCKET,
  process.env.NEXT_PUBLIC_SUPABASE_STORAGE_BUCKET,
])

const NOTIFY_WEBHOOK_SECRET = (process.env.NOTIFY_WEBHOOK_SECRET || '').trim()
const PAYSTACK_SECRET_KEY = (process.env.PAYSTACK_SECRET_KEY || '').trim()
const STRIPE_SECRET_KEY = (process.env.STRIPE_SECRET_KEY || '').trim()
const GOOGLE_MAPS_API_KEY = (
  process.env.VITE_GOOGLE_MAPS_API_KEY ||
  process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY ||
  process.env.GOOGLE_MAPS_API_KEY ||
  ''
).trim()
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

const BOOST_DURATION_HOURS = 24
const BOOST_POINTS_COST = 50
const BOOST_DAILY_BONUS_POINTS = 25
const BOOST_STARTING_POINTS = 100
const BOOST_PRICE_ZAR_CENTS = 2900

// In-memory geocode cache (bounded to 100 entries, 24h TTL; well within 30-day Terms caching limit)
const geocodeCache = new Map<
  string,
  { lat: number; lng: number; formattedAddress: string; cachedAt: number }
>()
const GEOCODE_CACHE_TTL_MS = 24 * 60 * 60 * 1000

let adminSupabase: SupabaseClient | null = null
if (SUPABASE_URL && SUPABASE_SECRET_KEY) {
  try {
    adminSupabase = createClient(SUPABASE_URL, SUPABASE_SECRET_KEY, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
    })
  } catch (err) {
    console.warn('Could not initialize admin Supabase client:', err instanceof Error ? err.message : err)
    adminSupabase = null
  }
}

async function ensureStorageBucket(): Promise<{ ok: boolean; error?: string }> {
  if (!adminSupabase) {
    return { ok: false, error: 'SUPABASE_SECRET_KEY is not configured on the server' }
  }
  const publicBuckets = Array.from(new Set(['profiles', STORAGE_BUCKET]))
  try {
    const { data: buckets, error: listErr } = await adminSupabase.storage.listBuckets()
    if (listErr) {
      return { ok: false, error: listErr.message }
    }
    for (const bucketName of publicBuckets) {
      const exists = buckets?.some((b) => b.name === bucketName)
      if (!exists) {
        const { error: createErr } = await adminSupabase.storage.createBucket(bucketName, {
          public: true,
        })
        if (createErr && !/already exists/i.test(createErr.message || '')) {
          return { ok: false, error: createErr.message }
        }
      }
    }
    const verificationsExists = buckets?.some((b) => b.name === 'verifications')
    if (!verificationsExists) {
      await adminSupabase.storage.createBucket('verifications', {
        public: false,
      })
    }
    return { ok: true }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Unable to verify storage bucket'
    return { ok: false, error: msg }
  }
}

function isSafeClientSupabaseKey(key: string): boolean {
  const trimmed = (key || '').trim()
  if (!trimmed) return false
  if (trimmed.startsWith('sb_secret_')) return false
  if (trimmed.startsWith('sb_publishable_')) return true
  if (trimmed.startsWith('eyJ')) {
    try {
      const parts = trimmed.split('.')
      if (parts.length === 3) {
        const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8')) as {
          role?: string
        }
        return payload.role !== 'service_role'
      }
    } catch {
      return false
    }
  }
  return false
}

const SAFE_CLIENT_SUPABASE_KEY = isSafeClientSupabaseKey(SUPABASE_PUBLISHABLE_KEY)
  ? SUPABASE_PUBLISHABLE_KEY
  : ''

const FULL_PUBLIC_PROFILE_COLUMNS =
  'id, full_name, age, gender, municipality, village, language, intention, bio, whatsapp, photo_url, email_verified, is_verified, verification_status, boosted_until, is_approved, is_banned, created_at'

const PUBLIC_PROFILE_COLUMNS =
  'id, full_name, age, gender, municipality, village, language, intention, bio, whatsapp, photo_url, email_verified, is_verified, verification_status, is_approved, is_banned, created_at'

const MID_PUBLIC_PROFILE_COLUMNS =
  'id, full_name, age, gender, municipality, village, language, intention, bio, whatsapp, photo_url, email_verified, is_approved, is_banned, created_at'

const LEGACY_PUBLIC_PROFILE_COLUMNS =
  'id, full_name, age, gender, municipality, village, language, intention, bio, whatsapp, photo_url, is_approved, is_banned, created_at'

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

const ADMIN_EMAIL = (process.env.ADMIN_EMAIL || 'phasharonny@gmail.com').trim().toLowerCase()
const ADMIN_PASSCODE = (process.env.ADMIN_PASSCODE || '').trim()
const ADMIN_SESSION_SECRET =
  (process.env.ADMIN_SESSION_SECRET || '').trim() || crypto.randomBytes(32).toString('hex')
let claimedAdminHashMemory: string | null = null

function hashAdminPasscode(passcode: string): string {
  const salt = crypto.randomBytes(16).toString('hex')
  const derived = crypto.scryptSync(passcode, salt, 64).toString('hex')
  return `${salt}:${derived}`
}

function verifyScryptHash(passcode: string, stored: string): boolean {
  const parts = stored.split(':')
  if (parts.length !== 2) return false
  const [salt, hexHash] = parts
  if (!salt || !hexHash) return false
  try {
    const expected = Buffer.from(hexHash, 'hex')
    const actual = crypto.scryptSync(passcode, salt, expected.length)
    return expected.length === actual.length && crypto.timingSafeEqual(expected, actual)
  } catch {
    return false
  }
}

function verifyPlainSecret(a: string, b: string): boolean {
  const bufA = Buffer.from(a, 'utf8')
  const bufB = Buffer.from(b, 'utf8')
  if (bufA.length !== bufB.length) return false
  return crypto.timingSafeEqual(bufA, bufB)
}

async function getStoredAdminHash(): Promise<string | null> {
  if (claimedAdminHashMemory) return claimedAdminHashMemory
  if (!adminSupabase) return null
  try {
    const { data, error } = await adminSupabase
      .from('app_settings')
      .select('value')
      .eq('key', 'admin_passcode_hash')
      .maybeSingle()
    if (!error && data?.value) {
      claimedAdminHashMemory = data.value
      return data.value
    }
  } catch {
    // app_settings table may not be created yet
  }
  return null
}

async function saveStoredAdminHash(hash: string): Promise<void> {
  claimedAdminHashMemory = hash
  if (!adminSupabase) return
  const { error } = await adminSupabase
    .from('app_settings')
    .upsert([{ key: 'admin_passcode_hash', value: hash, updated_at: new Date().toISOString() }], {
      onConflict: 'key',
    })
  if (error) {
    console.warn('[admin] Unable to persist admin_passcode_hash to app_settings:', error.message)
  }
}

function issueAdminBearerToken(email: string): string {
  const payload = Buffer.from(
    JSON.stringify({
      sub: email.toLowerCase(),
      role: 'admin',
      exp: Date.now() + 12 * 60 * 60 * 1000,
    }),
    'utf8'
  ).toString('base64url')
  const sig = crypto.createHmac('sha256', ADMIN_SESSION_SECRET).update(payload).digest('base64url')
  return `${payload}.${sig}`
}

function verifyAdminBearerToken(token: string): string | null {
  const parts = (token || '').split('.')
  if (parts.length !== 2) return null
  const [payload, sig] = parts
  if (!payload || !sig) return null
  const expectedSig = crypto
    .createHmac('sha256', ADMIN_SESSION_SECRET)
    .update(payload)
    .digest('base64url')
  if (!verifyPlainSecret(sig, expectedSig)) return null
  try {
    const parsed = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as {
      sub?: string
      role?: string
      exp?: number
    }
    if (
      parsed.role !== 'admin' ||
      typeof parsed.exp !== 'number' ||
      parsed.exp < Date.now() ||
      (parsed.sub || '').toLowerCase() !== ADMIN_EMAIL
    ) {
      return null
    }
    return parsed.sub!.toLowerCase()
  } catch {
    return null
  }
}

function extractBearerToken(req: Request): string {
  const header = req.get('authorization') || ''
  if (!header.toLowerCase().startsWith('bearer ')) return ''
  return header.slice(7).trim()
}

interface BoostFallbackEntry {
  boostedUntil: string | null
  boostPoints: number
  lastBoostedAt: string | null
  lastPointsClaimAt: string | null
}

interface BoostTransactionEntry {
  id: string
  method: string
  amount_cents: number
  currency: string
  points_spent: number
  status: string
  gateway_reference: string
  boosted_until: string | null
  created_at: string
}

const boostFallbackStore = new Map<string, BoostFallbackEntry>()
const boostTxFallbackStore = new Map<string, BoostTransactionEntry[]>()
const redeemedCheckoutRefs = new Set<string>()

function isMissingBoostSchemaErr(msg: string): boolean {
  return /boosted_until|boost_points|last_boosted_at|last_points_claim_at|boost_transactions|pgrst204|42p01|column|does not exist|schema cache/i.test(
    msg || ''
  )
}

function getBoostTimeMs(val: unknown): number {
  if (typeof val !== 'string' || !val) return 0
  const ms = Date.parse(val)
  return Number.isFinite(ms) ? ms : 0
}

function applyBoostOverlayToPublicRow<T extends Record<string, unknown>>(row: T): T {
  const id = typeof row.id === 'string' ? row.id : ''
  const fallback = id ? boostFallbackStore.get(id) : undefined
  const rowBoostMs = getBoostTimeMs(row.boosted_until)
  const fallbackBoostMs = fallback ? getBoostTimeMs(fallback.boostedUntil) : 0
  if (fallback && fallbackBoostMs >= rowBoostMs && fallback.boostedUntil) {
    return {
      ...row,
      boosted_until: fallback.boostedUntil,
    }
  }
  return row
}

function sortProfilesBoostFirst<T extends Record<string, unknown>>(rows: T[]): T[] {
  const now = Date.now()
  return [...rows].sort((a, b) => {
    const aMs = getBoostTimeMs(a.boosted_until)
    const bMs = getBoostTimeMs(b.boosted_until)
    const aActive = aMs > now
    const bActive = bMs > now
    if (aActive && !bActive) return -1
    if (!aActive && bActive) return 1
    if (aActive && bActive && bMs !== aMs) return bMs - aMs
    return 0
  })
}

function resolveSafeAppOrigin(req: Request): string {
  const envUrl = (process.env.APP_URL || '').trim()
  const candidates = [req.get('origin') || '', `${req.protocol}://${req.get('host') || ''}`, envUrl]
  for (const candidate of candidates) {
    if (!candidate) continue
    try {
      const parsed = new URL(candidate)
      if ((parsed.protocol === 'https:' || parsed.protocol === 'http:') && parsed.host) {
        return parsed.origin
      }
    } catch {
      // ignore invalid origin
    }
  }
  return `http://127.0.0.1:${PORT}`
}

function signSandboxCheckoutToken(payload: {
  reference: string
  profileId: string
  method: string
  amountCents: number
  exp: number
}): string {
  const encoded = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url')
  const sig = crypto
    .createHmac('sha256', ADMIN_SESSION_SECRET)
    .update(`boost_checkout:${encoded}`)
    .digest('base64url')
  return `${encoded}.${sig}`
}

function verifySandboxCheckoutToken(
  token: string,
  expectedProfileId: string,
  expectedReference: string
): { method: string; amountCents: number } | null {
  const parts = (token || '').split('.')
  if (parts.length !== 2) return null
  const [encoded, sig] = parts
  if (!encoded || !sig) return null
  const expectedSig = crypto
    .createHmac('sha256', ADMIN_SESSION_SECRET)
    .update(`boost_checkout:${encoded}`)
    .digest('base64url')
  if (!verifyPlainSecret(sig, expectedSig)) return null
  try {
    const parsed = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')) as {
      reference?: string
      profileId?: string
      method?: string
      amountCents?: number
      exp?: number
    }
    if (
      parsed.profileId !== expectedProfileId ||
      parsed.reference !== expectedReference ||
      typeof parsed.exp !== 'number' ||
      parsed.exp < Date.now() ||
      typeof parsed.amountCents !== 'number' ||
      parsed.amountCents < BOOST_PRICE_ZAR_CENTS
    ) {
      return null
    }
    return {
      method: typeof parsed.method === 'string' ? parsed.method : 'sandbox_card',
      amountCents: parsed.amountCents,
    }
  } catch {
    return null
  }
}

function requireAdminAuth(req: Request, res: Response): string | null {
  const token = extractBearerToken(req)
  const adminEmail = verifyAdminBearerToken(token)
  if (!adminEmail) {
    res.status(401).json({ ok: false, error: 'Admin authentication required. Please sign in.' })
    return null
  }
  return adminEmail
}

function sanitizeRedirectUrl(rawRedirect: unknown, req: Request): string | undefined {
  if (typeof rawRedirect !== 'string' || !rawRedirect.trim()) return undefined
  try {
    const parsed = new URL(rawRedirect.trim())
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return undefined
    const host = (req.get('x-forwarded-host') || req.get('host') || '').toLowerCase()
    if (host && parsed.host.toLowerCase() !== host) return undefined
    return `${parsed.origin}${parsed.pathname}`
  } catch {
    return undefined
  }
}

function normalizePhoneDigits(value: string): string {
  const digits = (value || '').replace(/\D/g, '')
  if (digits.startsWith('0')) {
    return '27' + digits.substring(1)
  }
  return digits
}

function isAllowedPhotoUrl(value: string): boolean {
  if (!value) return true
  if (value.startsWith('data:image/')) {
    return value.length <= 2 * 1024 * 1024
  }
  try {
    const parsed = new URL(value)
    return parsed.protocol === 'https:' || parsed.protocol === 'http:'
  } catch {
    return false
  }
}

async function startServer() {
  const app = express()
  app.use(
    express.json({
      limit: '5mb',
      verify: (req, _res, buf) => {
        ;(req as Request & { rawBody?: Buffer }).rawBody = buf
      },
    })
  )

  if (adminSupabase) {
    ensureStorageBucket().catch(() => {})
  }

  app.get('/api/health', async (_req: Request, res: Response) => {
    let adminDbConnected = false
    let publicDbConnected = false
    let dbError: string | null = null

    if (adminSupabase) {
      try {
        const { error } = await adminSupabase
          .from('profiles')
          .select('id')
          .limit(1)
          .abortSignal(AbortSignal.timeout(3000))
        adminDbConnected = !error
        if (error) dbError = error.message
      } catch (err: unknown) {
        adminDbConnected = false
        dbError = err instanceof Error ? err.message : 'Admin database check failed'
      }
    }

    if (SAFE_CLIENT_SUPABASE_KEY) {
      try {
        const resp = await fetch(`${SUPABASE_URL}/rest/v1/profiles?select=id&limit=1`, {
          headers: {
            apikey: SAFE_CLIENT_SUPABASE_KEY,
            Authorization: `Bearer ${SAFE_CLIENT_SUPABASE_KEY}`,
          },
          signal: AbortSignal.timeout(3000),
        })
        publicDbConnected = resp.ok
      } catch {
        publicDbConnected = false
      }
    }

    res.json({
      ok: true,
      supabaseUrl: SUPABASE_URL,
      storageBucket: STORAGE_BUCKET,
      serverSecretConfigured: Boolean(SUPABASE_SECRET_KEY),
      publishableKeyConfigured: Boolean(SAFE_CLIENT_SUPABASE_KEY),
      serverProxyAvailable: Boolean(adminSupabase),
      dbConnected: adminDbConnected || publicDbConnected,
      adminDbConnected,
      publicDbConnected,
      dbError,
    })
  })

  // Exposes strictly public/publishable client configuration from server runtime env
  app.get('/api/supabase/config', (_req: Request, res: Response) => {
    res.json({
      url: SUPABASE_URL,
      publishableKey: SAFE_CLIENT_SUPABASE_KEY,
      storageBucket: STORAGE_BUCKET,
      serverProxyAvailable: Boolean(adminSupabase),
    })
  })

  app.post('/api/storage/ensure-bucket', async (_req: Request, res: Response) => {
    const result = await ensureStorageBucket()
    if (!result.ok) {
      res.status(503).json({ ok: false, error: result.error })
      return
    }
    res.json({ ok: true, bucket: STORAGE_BUCKET })
  })

  app.post('/api/auth/send-email-otp', async (req: Request, res: Response) => {
    if (!adminSupabase) {
      res.status(503).json({ ok: false, error: 'Server Supabase client is not configured' })
      return
    }
    const body = (req.body && typeof req.body === 'object' ? req.body : {}) as {
      email?: unknown
      redirectTo?: unknown
    }
    const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : ''
    if (!EMAIL_RE.test(email) || email.length > 150) {
      res.status(400).json({ ok: false, error: 'Please enter a valid email address' })
      return
    }

    const emailRedirectTo = sanitizeRedirectUrl(body.redirectTo, req)
    try {
      const { error } = await adminSupabase.auth.signInWithOtp({
        email,
        options: {
          shouldCreateUser: true,
          ...(emailRedirectTo ? { emailRedirectTo } : {}),
        },
      })
      if (error) {
        const status = error.status === 429 || /rate limit/i.test(error.message) ? 429 : 400
        res.status(status).json({ ok: false, error: error.message })
        return
      }
      res.json({ ok: true, email })
    } catch (err: unknown) {
      res.status(500).json({
        ok: false,
        error: err instanceof Error ? err.message : 'Unable to send verification email',
      })
    }
  })

  app.post('/api/auth/verify-email-otp', async (req: Request, res: Response) => {
    if (!adminSupabase) {
      res.status(503).json({ ok: false, error: 'Server Supabase client is not configured' })
      return
    }
    const body = (req.body && typeof req.body === 'object' ? req.body : {}) as {
      email?: unknown
      token?: unknown
    }
    const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : ''
    const token = typeof body.token === 'string' ? body.token.trim().replace(/\s+/g, '') : ''

    if (!EMAIL_RE.test(email) || !/^[0-9a-zA-Z]{4,12}$/.test(token)) {
      res.status(400).json({ ok: false, error: 'Valid email and verification code are required' })
      return
    }

    try {
      let { data, error } = await adminSupabase.auth.verifyOtp({
        email,
        token,
        type: 'email',
      })

      if (error && /expired|invalid/i.test(error.message || '')) {
        const signupTry = await adminSupabase.auth.verifyOtp({
          email,
          token,
          type: 'signup',
        })
        if (!signupTry.error && signupTry.data?.user) {
          data = signupTry.data
          error = null
        }
      }

      if (error || !data?.user || !data?.session?.access_token) {
        res.status(401).json({
          ok: false,
          error: error?.message || 'Invalid or expired verification code. Please request a new code.',
        })
        return
      }

      res.json({
        ok: true,
        accessToken: data.session.access_token,
        user: {
          id: data.user.id,
          email: (data.user.email || email).toLowerCase(),
        },
      })
    } catch (err: unknown) {
      res.status(500).json({
        ok: false,
        error: err instanceof Error ? err.message : 'Unable to verify code',
      })
    }
  })

  app.post('/api/auth/verify-email-link', async (req: Request, res: Response) => {
    if (!adminSupabase) {
      res.status(503).json({ ok: false, error: 'Server Supabase client is not configured' })
      return
    }
    const body = (req.body && typeof req.body === 'object' ? req.body : {}) as {
      accessToken?: unknown
      tokenHash?: unknown
      type?: unknown
    }
    const accessToken = typeof body.accessToken === 'string' ? body.accessToken.trim() : ''
    const tokenHash = typeof body.tokenHash === 'string' ? body.tokenHash.trim() : ''
    const rawType = typeof body.type === 'string' ? body.type.trim() : 'email'

    try {
      if (accessToken) {
        const { data, error } = await adminSupabase.auth.getUser(accessToken)
        if (error || !data?.user?.email) {
          res.status(401).json({
            ok: false,
            error: error?.message || 'Verification link has expired or is invalid',
          })
          return
        }
        const confirmed = Boolean(data.user.email_confirmed_at || data.user.confirmed_at)
        if (!confirmed) {
          res.status(403).json({ ok: false, error: 'Email is not confirmed yet' })
          return
        }
        res.json({
          ok: true,
          accessToken,
          user: {
            id: data.user.id,
            email: data.user.email.toLowerCase(),
          },
        })
        return
      }

      if (tokenHash) {
        const allowedTypes = ['email', 'magiclink', 'signup'] as const
        const otpType = (allowedTypes as readonly string[]).includes(rawType)
          ? (rawType as (typeof allowedTypes)[number])
          : 'email'
        const { data, error } = await adminSupabase.auth.verifyOtp({
          token_hash: tokenHash,
          type: otpType,
        })
        if (error || !data?.user?.email || !data?.session?.access_token) {
          res.status(401).json({
            ok: false,
            error: error?.message || 'Verification link has expired or is invalid',
          })
          return
        }
        res.json({
          ok: true,
          accessToken: data.session.access_token,
          user: {
            id: data.user.id,
            email: data.user.email.toLowerCase(),
          },
        })
        return
      }

      res.status(400).json({ ok: false, error: 'Verification token is required' })
    } catch (err: unknown) {
      res.status(500).json({
        ok: false,
        error: err instanceof Error ? err.message : 'Unable to verify email link',
      })
    }
  })

  app.get('/api/profiles', async (_req: Request, res: Response) => {
    if (!adminSupabase) {
      res.status(503).json({ ok: false, error: 'Server Supabase client is not configured' })
      return
    }
    try {
      let { data, error } = await adminSupabase
        .from('profiles')
        .select(FULL_PUBLIC_PROFILE_COLUMNS)
        .eq('is_approved', true)
        .eq('is_banned', false)
        .order('created_at', { ascending: false })
        .limit(200)

      if (error && /boosted_until|schema cache|pgrst204|column/i.test(error.message || '')) {
        const retryPublic = await adminSupabase
          .from('profiles')
          .select(PUBLIC_PROFILE_COLUMNS)
          .eq('is_approved', true)
          .eq('is_banned', false)
          .order('created_at', { ascending: false })
          .limit(200)
        data = retryPublic.data as typeof data
        error = retryPublic.error
      }

      if (error && /is_verified|verification_status|schema cache|pgrst204|column/i.test(error.message || '')) {
        const retryMid = await adminSupabase
          .from('profiles')
          .select(MID_PUBLIC_PROFILE_COLUMNS)
          .eq('is_approved', true)
          .eq('is_banned', false)
          .order('created_at', { ascending: false })
          .limit(200)
        data = retryMid.data as typeof data
        error = retryMid.error
      }

      if (error && /email_verified|schema cache|pgrst204|column/i.test(error.message || '')) {
        const retry = await adminSupabase
          .from('profiles')
          .select(LEGACY_PUBLIC_PROFILE_COLUMNS)
          .eq('is_approved', true)
          .eq('is_banned', false)
          .order('created_at', { ascending: false })
          .limit(200)
        data = retry.data as typeof data
        error = retry.error
      }

      if (error) {
        res.status(400).json({ ok: false, error: error.message })
        return
      }
      const overlaid = (data || []).map((row) =>
        applyBoostOverlayToPublicRow(row as unknown as Record<string, unknown>)
      )
      res.json({ ok: true, profiles: sortProfilesBoostFirst(overlaid) })
    } catch (err: unknown) {
      res.status(500).json({
        ok: false,
        error: err instanceof Error ? err.message : 'Unable to fetch profiles',
      })
    }
  })

  app.get('/api/profiles/:id', async (req: Request, res: Response) => {
    if (!adminSupabase) {
      res.status(503).json({ ok: false, error: 'Server Supabase client is not configured' })
      return
    }
    const id = typeof req.params.id === 'string' ? req.params.id.trim() : ''
    if (!UUID_RE.test(id)) {
      res.status(400).json({ ok: false, error: 'Invalid profile id' })
      return
    }
    try {
      let { data, error } = await adminSupabase
        .from('profiles')
        .select(FULL_PUBLIC_PROFILE_COLUMNS)
        .eq('id', id)
        .maybeSingle()

      if (error && /boosted_until|schema cache|pgrst204|column/i.test(error.message || '')) {
        const retryPublic = await adminSupabase
          .from('profiles')
          .select(PUBLIC_PROFILE_COLUMNS)
          .eq('id', id)
          .maybeSingle()
        data = retryPublic.data as typeof data
        error = retryPublic.error
      }

      if (error && /is_verified|verification_status|schema cache|pgrst204|column/i.test(error.message || '')) {
        const retryMid = await adminSupabase
          .from('profiles')
          .select(MID_PUBLIC_PROFILE_COLUMNS)
          .eq('id', id)
          .maybeSingle()
        data = retryMid.data as typeof data
        error = retryMid.error
      }

      if (error && /email_verified|schema cache|pgrst204|column/i.test(error.message || '')) {
        const retry = await adminSupabase
          .from('profiles')
          .select(LEGACY_PUBLIC_PROFILE_COLUMNS)
          .eq('id', id)
          .maybeSingle()
        data = retry.data as typeof data
        error = retry.error
      }

      if (error) {
        res.status(400).json({ ok: false, error: error.message })
        return
      }
      const profile = data
        ? applyBoostOverlayToPublicRow(data as unknown as Record<string, unknown>)
        : null
      res.json({ ok: true, profile })
    } catch (err: unknown) {
      res.status(500).json({
        ok: false,
        error: err instanceof Error ? err.message : 'Unable to fetch profile',
      })
    }
  })

  app.post('/api/profiles/sync-status', async (req: Request, res: Response) => {
    if (!adminSupabase) {
      res.status(503).json({ ok: false, error: 'Server Supabase client is not configured' })
      return
    }
    const body = (req.body && typeof req.body === 'object' ? req.body : {}) as { ids?: unknown }
    const ids = Array.isArray(body.ids)
      ? body.ids
          .filter((id): id is string => typeof id === 'string' && UUID_RE.test(id.trim()))
          .map((id) => id.trim())
          .slice(0, 20)
      : []
    if (ids.length === 0) {
      res.json({ ok: true, profiles: [] })
      return
    }
    try {
      const { data, error } = await adminSupabase.from('profiles').select('*').in('id', ids)
      if (error) {
        res.status(400).json({ ok: false, error: error.message })
        return
      }
      const sanitized = (data || []).map((row) => {
        const { verification_selfie_url: _selfie, ...safeRow } = row as Record<string, unknown>
        const id = typeof safeRow.id === 'string' ? safeRow.id : ''
        const fallback = id ? boostFallbackStore.get(id) : undefined
        if (fallback) {
          const rowBoostMs = getBoostTimeMs(safeRow.boosted_until)
          const fallbackBoostMs = getBoostTimeMs(fallback.boostedUntil)
          return {
            ...safeRow,
            boosted_until: fallbackBoostMs >= rowBoostMs ? fallback.boostedUntil : safeRow.boosted_until,
            boost_points:
              typeof safeRow.boost_points === 'number' ? safeRow.boost_points : fallback.boostPoints,
          }
        }
        return safeRow
      })
      res.json({ ok: true, profiles: sanitized })
    } catch (err: unknown) {
      res.status(500).json({
        ok: false,
        error: err instanceof Error ? err.message : 'Unable to sync profiles',
      })
    }
  })

  app.post('/api/profiles/restore', async (req: Request, res: Response) => {
    if (!adminSupabase) {
      res.status(503).json({ ok: false, error: 'Server Supabase client is not configured' })
      return
    }

    const bearerToken = extractBearerToken(req)
    if (!bearerToken) {
      res.status(401).json({ ok: false, error: 'Verified email authentication is required' })
      return
    }

    try {
      const { data: authData, error: authErr } = await adminSupabase.auth.getUser(bearerToken)
      const confirmed = Boolean(
        authData?.user?.email_confirmed_at || authData?.user?.confirmed_at
      )
      if (authErr || !authData?.user?.email || !confirmed) {
        res.status(401).json({
          ok: false,
          error: 'Your email verification session is invalid or expired. Please request a new code.',
        })
        return
      }

      const authUserId = authData.user.id
      const cleanEmail = authData.user.email.trim().toLowerCase()
      const selfColumns = `${FULL_PUBLIC_PROFILE_COLUMNS}, boost_points, last_boosted_at, email, email_notifications, auth_user_id, verification_requested_at, verification_reviewed_at, verification_note`

      const queryByField = async (mode: 'auth_user_id' | 'email') => {
        const attempts = [
          selfColumns,
          `${PUBLIC_PROFILE_COLUMNS}, email, email_notifications, auth_user_id, verification_requested_at, verification_reviewed_at, verification_note`,
          `${MID_PUBLIC_PROFILE_COLUMNS}, email, email_notifications, auth_user_id`,
          `${LEGACY_PUBLIC_PROFILE_COLUMNS}, email`,
        ]
        for (const cols of attempts) {
          const base = adminSupabase!.from('profiles').select(cols)
          const q =
            mode === 'auth_user_id'
              ? base.eq('auth_user_id', authUserId)
              : base.ilike('email', cleanEmail)
          const { data, error } = await q.limit(1).maybeSingle()
          if (!error) {
            return { data: data as Record<string, unknown> | null, error: null }
          }
          if (!/column|schema cache|pgrst204/i.test(error.message || '')) {
            return { data: null, error }
          }
        }
        return { data: null, error: null }
      }

      let found = await queryByField('auth_user_id')
      if (!found.error && !found.data) {
        found = await queryByField('email')
      }

      if (found.error) {
        res.status(400).json({ ok: false, error: found.error.message })
        return
      }

      if (!found.data) {
        res.json({ ok: true, profile: null, email: cleanEmail, authUserId })
        return
      }

      if (found.data.is_banned) {
        res.status(403).json({
          ok: false,
          error: 'This profile has been banned and cannot be restored.',
        })
        return
      }

      const rowId = typeof found.data.id === 'string' ? found.data.id : ''
      if (rowId && (!found.data.auth_user_id || found.data.email_verified !== true)) {
        try {
          await adminSupabase
            .from('profiles')
            .update({ auth_user_id: authUserId, email_verified: true })
            .eq('id', rowId)
          found.data.auth_user_id = authUserId
          found.data.email_verified = true
        } catch {
          // ignore if optional columns aren't migrated
        }
      }

      const { verification_selfie_url: _rawSelfie, ...safeRec } = found.data
      res.json({
        ok: true,
        profile: applyBoostOverlayToPublicRow(safeRec),
      })
    } catch (err: unknown) {
      res.status(500).json({
        ok: false,
        error: err instanceof Error ? err.message : 'Unable to restore profile',
      })
    }
  })

  app.post('/api/profiles/photo', async (req: Request, res: Response) => {
    if (!adminSupabase) {
      res.status(503).json({ ok: false, error: 'Server Supabase client is not configured' })
      return
    }
    const body = (req.body && typeof req.body === 'object' ? req.body : {}) as {
      profileId?: unknown
      dataUrl?: unknown
    }
    const rawId = typeof body.profileId === 'string' ? body.profileId.trim() : ''
    const safeId = rawId.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 64) || 'profile'
    const dataUrl = typeof body.dataUrl === 'string' ? body.dataUrl.trim() : ''

    const match = dataUrl.match(/^data:(image\/(?:jpeg|jpg|png|webp));base64,([A-Za-z0-9+/=]+)$/)
    if (!match) {
      res.status(400).json({ ok: false, error: 'Valid JPEG, PNG, or WebP image data is required' })
      return
    }

    const mimeType = match[1] === 'image/jpg' ? 'image/jpeg' : match[1]
    const ext = mimeType === 'image/png' ? 'png' : mimeType === 'image/webp' ? 'webp' : 'jpg'
    const buffer = Buffer.from(match[2], 'base64')
    if (buffer.length === 0 || buffer.length > 2 * 1024 * 1024) {
      res.status(400).json({ ok: false, error: 'Profile photo must be 2 MB or smaller' })
      return
    }

    try {
      await ensureStorageBucket()
      const fileName = `${safeId}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`
      const storagePath = `${safeId}/${fileName}`
      const { data, error } = await adminSupabase.storage
        .from('profiles')
        .upload(storagePath, buffer, {
          cacheControl: '3600',
          upsert: true,
          contentType: mimeType,
        })

      if (error || !data) {
        res.status(400).json({ ok: false, error: error?.message || 'Storage upload failed' })
        return
      }

      const { data: urlData } = adminSupabase.storage.from('profiles').getPublicUrl(data.path)
      res.json({
        ok: true,
        url: urlData.publicUrl,
        path: data.path,
        fileName,
        fileType: mimeType,
        fileSize: buffer.length,
      })
    } catch (err: unknown) {
      res.status(500).json({
        ok: false,
        error: err instanceof Error ? err.message : 'Unable to upload profile photo',
      })
    }
  })

  app.post('/api/profiles/save', async (req: Request, res: Response) => {
    if (!adminSupabase) {
      res.status(503).json({ ok: false, error: 'Server Supabase client is not configured' })
      return
    }

    const body = (req.body && typeof req.body === 'object' ? req.body : {}) as Record<
      string,
      unknown
    >

    const id = typeof body.id === 'string' ? body.id.trim() : ''
    const fullName = typeof body.full_name === 'string' ? body.full_name.trim().slice(0, 100) : ''
    const age = Number(body.age)
    const gender = typeof body.gender === 'string' ? body.gender.trim() : ''
    const municipality =
      typeof body.municipality === 'string' ? body.municipality.trim().slice(0, 80) : ''
    const village = typeof body.village === 'string' ? body.village.trim().slice(0, 80) : ''
    const language =
      typeof body.language === 'string' ? body.language.trim().slice(0, 40) : 'Sepedi'
    const intention =
      typeof body.intention === 'string' ? body.intention.trim().slice(0, 40) : 'Dating'
    const bio = typeof body.bio === 'string' ? body.bio.trim().slice(0, 200) : ''
    const whatsapp = typeof body.whatsapp === 'string' ? body.whatsapp.trim().slice(0, 30) : ''
    const email = typeof body.email === 'string' ? body.email.trim().toLowerCase().slice(0, 150) : ''
    const emailNotifications = body.email_notifications !== false
    const photoUrl = typeof body.photo_url === 'string' ? body.photo_url.trim() : ''

    if (!UUID_RE.test(id)) {
      res.status(400).json({ ok: false, error: 'Valid profile id UUID is required' })
      return
    }
    if (!fullName || !municipality || !village || !bio || !whatsapp) {
      res.status(400).json({ ok: false, error: 'All required profile fields must be completed' })
      return
    }
    if (!Number.isInteger(age) || age < 18 || age > 120) {
      res.status(400).json({ ok: false, error: 'Age must be 18 or older' })
      return
    }
    if (gender !== 'Male' && gender !== 'Female') {
      res.status(400).json({ ok: false, error: 'Invalid gender selection' })
      return
    }
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      res.status(400).json({ ok: false, error: 'Invalid email address format' })
      return
    }
    if (!isAllowedPhotoUrl(photoUrl)) {
      res.status(400).json({ ok: false, error: 'Invalid profile photo URL' })
      return
    }

    try {
      const bearerToken = extractBearerToken(req)
      let verifiedUser: { id: string; email: string } | null = null

      if (bearerToken) {
        const { data: authData, error: authErr } = await adminSupabase.auth.getUser(bearerToken)
        const confirmed = Boolean(authData?.user?.email_confirmed_at || authData?.user?.confirmed_at)
        if (!authErr && authData?.user?.email && confirmed) {
          verifiedUser = {
            id: authData.user.id,
            email: authData.user.email.toLowerCase(),
          }
        }
      }

      let existing: {
        id: string
        email?: string
        email_verified?: boolean
        auth_user_id?: string | null
        is_verified?: boolean
        verification_status?: string
        verification_selfie_url?: string
        verification_requested_at?: string | null
        verification_reviewed_at?: string | null
        verification_note?: string
        boosted_until?: string | null
        boost_points?: number
        last_boosted_at?: string | null
        last_points_claim_at?: string | null
        is_approved: boolean
        is_banned: boolean
        created_at: string
      } | null = null

      const existingRes = await adminSupabase
        .from('profiles')
        .select(
          'id, email, email_verified, auth_user_id, is_verified, verification_status, verification_selfie_url, verification_requested_at, verification_reviewed_at, verification_note, boosted_until, boost_points, last_boosted_at, last_points_claim_at, is_approved, is_banned, created_at'
        )
        .eq('id', id)
        .maybeSingle()

      if (existingRes.error && isMissingBoostSchemaErr(existingRes.error.message || '')) {
        const withoutBoostRes = await adminSupabase
          .from('profiles')
          .select(
            'id, email, email_verified, auth_user_id, is_verified, verification_status, verification_selfie_url, verification_requested_at, verification_reviewed_at, verification_note, is_approved, is_banned, created_at'
          )
          .eq('id', id)
          .maybeSingle()
        if (
          withoutBoostRes.error &&
          /is_verified|verification_status|email_verified|auth_user_id|pgrst204|column/i.test(
            withoutBoostRes.error.message || ''
          )
        ) {
          const legacyExisting = await adminSupabase
            .from('profiles')
            .select('id, email, is_approved, is_banned, created_at')
            .eq('id', id)
            .maybeSingle()
          existing = legacyExisting.data
        } else {
          existing = withoutBoostRes.data
        }
      } else if (
        existingRes.error &&
        /is_verified|verification_status|email_verified|auth_user_id|pgrst204|column/i.test(
          existingRes.error.message || ''
        )
      ) {
        const midExisting = await adminSupabase
          .from('profiles')
          .select('id, email, email_verified, auth_user_id, is_approved, is_banned, created_at')
          .eq('id', id)
          .maybeSingle()
        if (
          midExisting.error &&
          /email_verified|auth_user_id|pgrst204|column/i.test(midExisting.error.message || '')
        ) {
          const legacyExisting = await adminSupabase
            .from('profiles')
            .select('id, email, is_approved, is_banned, created_at')
            .eq('id', id)
            .maybeSingle()
          existing = legacyExisting.data
        } else {
          existing = midExisting.data
        }
      } else {
        existing = existingRes.data
      }

      if (existing?.is_banned) {
        res.status(403).json({ ok: false, error: 'This profile has been banned' })
        return
      }

      const tokenMatchesEmail = Boolean(verifiedUser && email && verifiedUser.email === email)

      if (!existing) {
        if (!email) {
          res.status(400).json({ ok: false, error: 'A valid email address is required to register' })
          return
        }
        if (!tokenMatchesEmail) {
          res.status(403).json({
            ok: false,
            error: 'Please verify your email address with Supabase Auth before publishing your profile.',
          })
          return
        }
      }

      // Enforce one profile per user across auth_user_id, email, and WhatsApp number
      const normalizedWa = normalizePhoneDigits(whatsapp)
      let duplicateProfile: { id: string } | null = null

      if (verifiedUser?.id) {
        const byAuth = await adminSupabase
          .from('profiles')
          .select('id')
          .eq('auth_user_id', verifiedUser.id)
          .neq('id', id)
          .limit(1)
          .maybeSingle()
        if (!byAuth.error && byAuth.data) {
          duplicateProfile = byAuth.data
        }
      }

      if (!duplicateProfile && email) {
        const byEmail = await adminSupabase
          .from('profiles')
          .select('id')
          .ilike('email', email)
          .neq('id', id)
          .limit(1)
          .maybeSingle()
        if (!byEmail.error && byEmail.data) {
          duplicateProfile = byEmail.data
        }
      }

      if (!duplicateProfile && normalizedWa.length >= 7) {
        const waCandidates = Array.from(new Set([whatsapp, normalizedWa]))
        const byWa = await adminSupabase
          .from('profiles')
          .select('id')
          .in('whatsapp', waCandidates)
          .neq('id', id)
          .limit(1)
          .maybeSingle()
        if (!byWa.error && byWa.data) {
          duplicateProfile = byWa.data
        }
      }

      if (duplicateProfile) {
        res.status(409).json({
          ok: false,
          error:
            'Only one profile is allowed per user. A profile already exists for this account, email, or WhatsApp number.',
          existingProfileId: duplicateProfile.id,
        })
        return
      }

      const emailChanged =
        Boolean(existing) &&
        Boolean(email) &&
        (existing?.email || '').trim().toLowerCase() !== email

      const resolvedEmailVerified = tokenMatchesEmail
        ? true
        : emailChanged
        ? false
        : Boolean(existing?.email_verified)

      const resolvedAuthUserId = tokenMatchesEmail
        ? verifiedUser!.id
        : existing?.auth_user_id || null

      const resolvedIsVerified = existing ? Boolean(existing.is_verified) : false
      const resolvedVerificationStatus = existing
        ? existing.verification_status || (existing.is_verified ? 'verified' : 'unverified')
        : 'unverified'
      const fallbackEntry = boostFallbackStore.get(id)
      const resolvedBoostedUntil =
        existing?.boosted_until ?? fallbackEntry?.boostedUntil ?? null
      const resolvedBoostPoints =
        typeof existing?.boost_points === 'number'
          ? existing.boost_points
          : fallbackEntry?.boostPoints ?? BOOST_STARTING_POINTS
      const resolvedLastBoostedAt =
        existing?.last_boosted_at ?? fallbackEntry?.lastBoostedAt ?? null
      const resolvedLastPointsClaimAt =
        existing?.last_points_claim_at ?? fallbackEntry?.lastPointsClaimAt ?? null

      const payload = {
        id,
        full_name: fullName,
        age,
        gender,
        municipality,
        village,
        language,
        intention,
        bio,
        whatsapp,
        email,
        email_verified: resolvedEmailVerified,
        auth_user_id: resolvedAuthUserId,
        email_notifications: emailNotifications,
        photo_url: photoUrl,
        is_verified: resolvedIsVerified,
        verification_status: resolvedVerificationStatus,
        verification_selfie_url: existing?.verification_selfie_url || '',
        verification_requested_at: existing?.verification_requested_at || null,
        verification_reviewed_at: existing?.verification_reviewed_at || null,
        verification_note: existing?.verification_note || '',
        boosted_until: resolvedBoostedUntil,
        boost_points: resolvedBoostPoints,
        last_boosted_at: resolvedLastBoostedAt,
        last_points_claim_at: resolvedLastPointsClaimAt,
        is_approved: existing ? existing.is_approved : true,
        is_banned: existing ? existing.is_banned : false,
        created_at:
          existing?.created_at ||
          (typeof body.created_at === 'string' && body.created_at) ||
          new Date().toISOString(),
      }

      let { data, error } = await adminSupabase
        .from('profiles')
        .upsert([payload], { onConflict: 'id' })
        .select()
        .single()

      if (error && isMissingBoostSchemaErr(error.message || '')) {
        const {
          boosted_until: _bu,
          boost_points: _bp,
          last_boosted_at: _lba,
          last_points_claim_at: _lpc,
          ...withoutBoostCols
        } = payload
        const retry = await adminSupabase
          .from('profiles')
          .upsert([withoutBoostCols], { onConflict: 'id' })
          .select()
          .single()
        data = retry.data
        error = retry.error
      }

      if (
        error &&
        /is_verified|verification_status|verification_selfie_url|pgrst204|column/i.test(
          error.message || ''
        )
      ) {
        const {
          is_verified: _iv,
          verification_status: _vs,
          verification_selfie_url: _vsu,
          verification_requested_at: _vrq,
          verification_reviewed_at: _vrv,
          verification_note: _vn,
          boosted_until: _bu,
          boost_points: _bp,
          last_boosted_at: _lba,
          last_points_claim_at: _lpc,
          ...withoutSelfieVerifyCols
        } = payload
        const retry = await adminSupabase
          .from('profiles')
          .upsert([withoutSelfieVerifyCols], { onConflict: 'id' })
          .select()
          .single()
        data = retry.data
        error = retry.error
      }

      if (error && /email_verified|auth_user_id|pgrst204|column/i.test(error.message || '')) {
        const {
          email_verified: _ev,
          auth_user_id: _au,
          is_verified: _iv,
          verification_status: _vs,
          verification_selfie_url: _vsu,
          verification_requested_at: _vrq,
          verification_reviewed_at: _vrv,
          verification_note: _vn,
          boosted_until: _bu,
          boost_points: _bp,
          last_boosted_at: _lba,
          last_points_claim_at: _lpc,
          ...withoutVerificationCols
        } = payload
        const retry = await adminSupabase
          .from('profiles')
          .upsert([withoutVerificationCols], { onConflict: 'id' })
          .select()
          .single()
        data = retry.data
        error = retry.error
      }

      if (error && /email|schema cache|pgrst204|column/i.test(error.message || '')) {
        const {
          email: _e,
          email_notifications: _en,
          email_verified: _ev,
          auth_user_id: _au,
          is_verified: _iv,
          verification_status: _vs,
          verification_selfie_url: _vsu,
          verification_requested_at: _vrq,
          verification_reviewed_at: _vrv,
          verification_note: _vn,
          boosted_until: _bu,
          boost_points: _bp,
          last_boosted_at: _lba,
          last_points_claim_at: _lpc,
          ...legacyPayload
        } = payload
        const retry = await adminSupabase
          .from('profiles')
          .upsert([legacyPayload], { onConflict: 'id' })
          .select()
          .single()
        data = retry.data
        error = retry.error
      }

      if (error) {
        res.status(400).json({ ok: false, error: error.message })
        return
      }

      const { verification_selfie_url: _hiddenSelfie, ...safeSaved } = (data || {}) as Record<
        string,
        unknown
      >

      res.json({
        ok: true,
        profile: {
          ...safeSaved,
          email_verified: resolvedEmailVerified,
          auth_user_id: resolvedAuthUserId,
          is_verified: resolvedIsVerified,
          verification_status: resolvedVerificationStatus,
          boosted_until: resolvedBoostedUntil,
          boost_points: resolvedBoostPoints,
        },
      })
    } catch (err: unknown) {
      res.status(500).json({
        ok: false,
        error: err instanceof Error ? err.message : 'Unable to save profile',
      })
    }
  })

  app.post('/api/profiles/request-verification', async (req: Request, res: Response) => {
    if (!adminSupabase) {
      res.status(503).json({ ok: false, error: 'Server Supabase client is not configured' })
      return
    }

    const body = (req.body && typeof req.body === 'object' ? req.body : {}) as {
      profileId?: unknown
      selfieDataUrl?: unknown
    }
    const profileId = typeof body.profileId === 'string' ? body.profileId.trim() : ''
    const selfieDataUrl = typeof body.selfieDataUrl === 'string' ? body.selfieDataUrl.trim() : ''

    if (!UUID_RE.test(profileId)) {
      res.status(400).json({ ok: false, error: 'Valid profileId UUID is required' })
      return
    }

    const match = selfieDataUrl.match(
      /^data:(image\/(?:jpeg|jpg|png|webp));base64,([A-Za-z0-9+/=]+)$/
    )
    if (!match) {
      res.status(400).json({ ok: false, error: 'Valid JPEG, PNG, or WebP selfie image is required' })
      return
    }

    const mimeType = match[1] === 'image/jpg' ? 'image/jpeg' : match[1]
    const ext = mimeType === 'image/png' ? 'png' : mimeType === 'image/webp' ? 'webp' : 'jpg'
    const buffer = Buffer.from(match[2], 'base64')
    if (buffer.length === 0 || buffer.length > 2 * 1024 * 1024) {
      res.status(400).json({ ok: false, error: 'Selfie image must be 2 MB or smaller' })
      return
    }

    try {
      const { data: existing, error: fetchErr } = await adminSupabase
        .from('profiles')
        .select('id, is_banned')
        .eq('id', profileId)
        .maybeSingle()

      if (fetchErr || !existing) {
        res.status(404).json({ ok: false, error: 'Profile not found on server' })
        return
      }
      if (existing.is_banned) {
        res.status(403).json({ ok: false, error: 'This profile cannot request verification' })
        return
      }

      await ensureStorageBucket()
      const fileName = `selfie-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`
      const storagePath = `${profileId}/${fileName}`
      let storedRef = ''

      const privateUpload = await adminSupabase.storage
        .from('verifications')
        .upload(storagePath, buffer, {
          cacheControl: '3600',
          upsert: true,
          contentType: mimeType,
        })

      if (!privateUpload.error && privateUpload.data) {
        storedRef = `verifications:${privateUpload.data.path}`
      } else {
        const fallbackPath = `verifications/${storagePath}`
        const fallbackUpload = await adminSupabase.storage
          .from('profiles')
          .upload(fallbackPath, buffer, {
            cacheControl: '3600',
            upsert: true,
            contentType: mimeType,
          })
        if (fallbackUpload.error || !fallbackUpload.data) {
          res.status(400).json({
            ok: false,
            error:
              fallbackUpload.error?.message ||
              privateUpload.error?.message ||
              'Unable to store selfie image',
          })
          return
        }
        storedRef = `profiles:${fallbackUpload.data.path}`
      }

      const nowIso = new Date().toISOString()
      const { data: updated, error: updateErr } = await adminSupabase
        .from('profiles')
        .update({
          is_verified: false,
          verification_status: 'pending',
          verification_selfie_url: storedRef,
          verification_requested_at: nowIso,
          verification_reviewed_at: null,
          verification_note: '',
        })
        .eq('id', profileId)
        .select()
        .single()

      if (updateErr) {
        if (/is_verified|verification_status|verification_selfie_url|pgrst204|column/i.test(updateErr.message || '')) {
          res.status(400).json({
            ok: false,
            error:
              'Verification columns are missing in Supabase. Please run the updated supabase.sql in your Supabase SQL Editor.',
          })
          return
        }
        res.status(400).json({ ok: false, error: updateErr.message })
        return
      }

      const { verification_selfie_url: _hiddenSelfie, ...safeProfile } = (updated || {}) as Record<
        string,
        unknown
      >
      res.json({ ok: true, profile: safeProfile })
    } catch (err: unknown) {
      res.status(500).json({
        ok: false,
        error: err instanceof Error ? err.message : 'Unable to submit verification request',
      })
    }
  })

  app.get('/api/admin/auth/status', async (_req: Request, res: Response) => {
    const storedHash = await getStoredAdminHash()
    res.json({
      ok: true,
      adminEmail: ADMIN_EMAIL,
      setupRequired: !ADMIN_PASSCODE && !storedHash,
    })
  })

  app.post('/api/admin/auth/setup', async (req: Request, res: Response) => {
    const existingHash = await getStoredAdminHash()
    if (ADMIN_PASSCODE || existingHash) {
      res.status(403).json({ ok: false, error: 'Admin password is already configured. Please sign in.' })
      return
    }
    const body = (req.body && typeof req.body === 'object' ? req.body : {}) as {
      email?: unknown
      passcode?: unknown
    }
    const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : ''
    const passcode = typeof body.passcode === 'string' ? body.passcode.trim() : ''

    if (email !== ADMIN_EMAIL) {
      res.status(403).json({ ok: false, error: `Only ${ADMIN_EMAIL} is authorized as admin.` })
      return
    }
    if (passcode.length < 8 || passcode.length > 128) {
      res.status(400).json({ ok: false, error: 'Admin password must be between 8 and 128 characters.' })
      return
    }

    const hash = hashAdminPasscode(passcode)
    await saveStoredAdminHash(hash)
    const token = issueAdminBearerToken(email)
    res.json({ ok: true, token, adminEmail: email })
  })

  app.post('/api/admin/auth/login', async (req: Request, res: Response) => {
    const body = (req.body && typeof req.body === 'object' ? req.body : {}) as {
      email?: unknown
      passcode?: unknown
      supabaseAccessToken?: unknown
    }
    const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : ''
    const passcode = typeof body.passcode === 'string' ? body.passcode.trim() : ''
    const supabaseAccessToken =
      typeof body.supabaseAccessToken === 'string' ? body.supabaseAccessToken.trim() : ''

    if (email !== ADMIN_EMAIL) {
      res.status(403).json({ ok: false, error: `Access Denied: Only ${ADMIN_EMAIL} can access admin.` })
      return
    }

    if (supabaseAccessToken) {
      if (!adminSupabase) {
        res.status(503).json({ ok: false, error: 'Server Supabase client is not configured' })
        return
      }
      const { data, error } = await adminSupabase.auth.getUser(supabaseAccessToken)
      const confirmed = Boolean(data?.user?.email_confirmed_at || data?.user?.confirmed_at)
      if (error || !data?.user?.email || !confirmed || data.user.email.toLowerCase() !== ADMIN_EMAIL) {
        res.status(401).json({ ok: false, error: 'Invalid or unconfirmed admin Supabase Auth session.' })
        return
      }
      res.json({ ok: true, token: issueAdminBearerToken(ADMIN_EMAIL), adminEmail: ADMIN_EMAIL })
      return
    }

    const storedHash = await getStoredAdminHash()
    if (storedHash) {
      if (!passcode || !verifyScryptHash(passcode, storedHash)) {
        res.status(401).json({ ok: false, error: 'Invalid admin password.' })
        return
      }
      res.json({ ok: true, token: issueAdminBearerToken(ADMIN_EMAIL), adminEmail: ADMIN_EMAIL })
      return
    }

    if (ADMIN_PASSCODE) {
      if (!passcode || !verifyPlainSecret(passcode, ADMIN_PASSCODE)) {
        res.status(401).json({ ok: false, error: 'Invalid admin password.' })
        return
      }
      res.json({ ok: true, token: issueAdminBearerToken(ADMIN_EMAIL), adminEmail: ADMIN_EMAIL })
      return
    }

    res.status(400).json({ ok: false, error: 'Admin password has not been claimed yet.' })
  })

  app.post('/api/admin/auth/change-password', async (req: Request, res: Response) => {
    const adminEmail = requireAdminAuth(req, res)
    if (!adminEmail) return

    const body = (req.body && typeof req.body === 'object' ? req.body : {}) as {
      newPassword?: unknown
    }
    const newPassword = typeof body.newPassword === 'string' ? body.newPassword.trim() : ''

    if (newPassword.length < 8 || newPassword.length > 128) {
      res.status(400).json({ ok: false, error: 'Admin password must be between 8 and 128 characters.' })
      return
    }

    const hash = hashAdminPasscode(newPassword)
    await saveStoredAdminHash(hash)
    res.json({ ok: true, message: 'Admin password updated.' })
  })

  app.get('/api/admin/profiles', async (req: Request, res: Response) => {
    const adminEmail = requireAdminAuth(req, res)
    if (!adminEmail) return
    if (!adminSupabase) {
      res.status(503).json({ ok: false, error: 'Server Supabase client is not configured' })
      return
    }

    try {
      const [{ data: profilesData, error: profilesErr }, { data: reportsData }] = await Promise.all([
        adminSupabase
          .from('profiles')
          .select('*')
          .eq('is_banned', false)
          .order('created_at', { ascending: false })
          .limit(300),
        adminSupabase
          .from('reports')
          .select('*')
          .order('created_at', { ascending: false })
          .limit(200),
      ])

      if (profilesErr) {
        res.status(400).json({ ok: false, error: profilesErr.message })
        return
      }

      const enrichedProfiles = await Promise.all(
        (profilesData || []).map(async (row) => {
          const rec = row as Record<string, unknown>
          const rawSelfieRef =
            typeof rec.verification_selfie_url === 'string' ? rec.verification_selfie_url : ''
          let signedSelfieUrl = ''

          if (rawSelfieRef) {
            if (rawSelfieRef.startsWith('verifications:')) {
              const storagePath = rawSelfieRef.slice('verifications:'.length)
              const { data: signed } = await adminSupabase!.storage
                .from('verifications')
                .createSignedUrl(storagePath, 3600)
              signedSelfieUrl = signed?.signedUrl || ''
            } else if (rawSelfieRef.startsWith('profiles:')) {
              const storagePath = rawSelfieRef.slice('profiles:'.length)
              const { data: pub } = adminSupabase!.storage.from('profiles').getPublicUrl(storagePath)
              signedSelfieUrl = pub.publicUrl
            } else if (/^https?:\/\//i.test(rawSelfieRef)) {
              signedSelfieUrl = rawSelfieRef
            }
          }

          const { verification_selfie_url: _rawSelfie, ...safeRec } = rec
          return {
            ...safeRec,
            signed_selfie_url: signedSelfieUrl,
          }
        })
      )

      res.json({
        ok: true,
        profiles: enrichedProfiles,
        reports: reportsData || [],
      })
    } catch (err: unknown) {
      res.status(500).json({
        ok: false,
        error: err instanceof Error ? err.message : 'Unable to load admin queue',
      })
    }
  })

  app.post('/api/admin/verify-profile', async (req: Request, res: Response) => {
    const adminEmail = requireAdminAuth(req, res)
    if (!adminEmail) return
    if (!adminSupabase) {
      res.status(503).json({ ok: false, error: 'Server Supabase client is not configured' })
      return
    }

    const body = (req.body && typeof req.body === 'object' ? req.body : {}) as {
      profileId?: unknown
      decision?: unknown
      note?: unknown
    }
    const profileId = typeof body.profileId === 'string' ? body.profileId.trim() : ''
    const decision = body.decision === 'approve' || body.decision === 'reject' ? body.decision : ''
    const note = typeof body.note === 'string' ? body.note.trim().slice(0, 300) : ''

    if (!UUID_RE.test(profileId) || !decision) {
      res.status(400).json({ ok: false, error: 'Valid profileId and decision (approve/reject) are required' })
      return
    }

    try {
      const nowIso = new Date().toISOString()
      const approved = decision === 'approve'
      const { data, error } = await adminSupabase
        .from('profiles')
        .update({
          is_verified: approved,
          verification_status: approved ? 'verified' : 'rejected',
          verification_reviewed_at: nowIso,
          verification_note: approved ? '' : note || 'Selfie did not match or was unclear. Please retake and resubmit.',
        })
        .eq('id', profileId)
        .select()
        .single()

      if (error) {
        if (/is_verified|verification_status|pgrst204|column/i.test(error.message || '')) {
          res.status(400).json({
            ok: false,
            error: 'Verification columns missing in Supabase. Run the updated supabase.sql in Supabase SQL Editor.',
          })
          return
        }
        res.status(400).json({ ok: false, error: error.message })
        return
      }

      res.json({ ok: true, profile: data })
    } catch (err: unknown) {
      res.status(500).json({
        ok: false,
        error: err instanceof Error ? err.message : 'Unable to update verification status',
      })
    }
  })

  app.post('/api/admin/moderate-profile', async (req: Request, res: Response) => {
    const adminEmail = requireAdminAuth(req, res)
    if (!adminEmail) return
    if (!adminSupabase) {
      res.status(503).json({ ok: false, error: 'Server Supabase client is not configured' })
      return
    }

    const body = (req.body && typeof req.body === 'object' ? req.body : {}) as {
      profileId?: unknown
      action?: unknown
    }
    const profileId = typeof body.profileId === 'string' ? body.profileId.trim() : ''
    const action = body.action === 'approve_listing' || body.action === 'ban' ? body.action : ''

    if (!UUID_RE.test(profileId) || !action) {
      res.status(400).json({ ok: false, error: 'Valid profileId and moderation action are required' })
      return
    }

    try {
      const patch = action === 'approve_listing' ? { is_approved: true } : { is_banned: true }
      const { data, error } = await adminSupabase
        .from('profiles')
        .update(patch)
        .eq('id', profileId)
        .select()
        .single()

      if (error) {
        res.status(400).json({ ok: false, error: error.message })
        return
      }
      res.json({ ok: true, profile: data })
    } catch (err: unknown) {
      res.status(500).json({
        ok: false,
        error: err instanceof Error ? err.message : 'Unable to moderate profile',
      })
    }
  })

  app.post('/api/profiles/delete', async (req: Request, res: Response) => {
    if (!adminSupabase) {
      res.status(503).json({ ok: false, error: 'Server Supabase client is not configured' })
      return
    }
    const body = (req.body && typeof req.body === 'object' ? req.body : {}) as {
      id?: unknown
      whatsapp?: unknown
    }
    const id = typeof body.id === 'string' ? body.id.trim() : ''
    const rawWhatsapp = typeof body.whatsapp === 'string' ? body.whatsapp.trim() : ''

    try {
      if (id) {
        if (!UUID_RE.test(id)) {
          res.status(400).json({ ok: false, error: 'Invalid profile id' })
          return
        }
        const { error } = await adminSupabase.from('profiles').delete().eq('id', id)
        if (error) {
          res.status(400).json({ ok: false, error: error.message })
          return
        }
        res.json({ ok: true })
        return
      }

      const cleanNum = normalizePhoneDigits(rawWhatsapp)
      if (!cleanNum || cleanNum.length < 7) {
        res.status(400).json({ ok: false, error: 'Valid id or WhatsApp number is required' })
        return
      }

      await adminSupabase.from('profiles').delete().eq('whatsapp', cleanNum)
      await adminSupabase.from('profiles').delete().eq('whatsapp', rawWhatsapp)
      res.json({ ok: true })
    } catch (err: unknown) {
      res.status(500).json({
        ok: false,
        error: err instanceof Error ? err.message : 'Unable to delete profile',
      })
    }
  })

  // Profile Boost (24h spotlight at top of Discover feed) + Points & Payment Gateway routes
  async function loadProfileForBoost(profileId: string): Promise<{
    profile: {
      id: string
      full_name: string
      email: string
      auth_user_id: string | null
      is_banned: boolean
      boosted_until: string | null
      boost_points: number
      last_boosted_at: string | null
      last_points_claim_at: string | null
    } | null
    schemaReady: boolean
    error?: string
  }> {
    if (!adminSupabase) {
      return { profile: null, schemaReady: false, error: 'Server Supabase client is not configured' }
    }
    const res = await adminSupabase
      .from('profiles')
      .select(
        'id, full_name, email, auth_user_id, is_banned, boosted_until, boost_points, last_boosted_at, last_points_claim_at'
      )
      .eq('id', profileId)
      .maybeSingle()

    if (
      res.error &&
      (isMissingBoostSchemaErr(res.error.message || '') ||
        /auth_user_id|email|pgrst204|column/i.test(res.error.message || ''))
    ) {
      let basicRow: {
        id: string
        full_name?: string
        email?: string
        auth_user_id?: string | null
        is_banned?: boolean
      } | null = null

      const midRes = await adminSupabase
        .from('profiles')
        .select('id, full_name, email, auth_user_id, is_banned')
        .eq('id', profileId)
        .maybeSingle()

      if (!midRes.error && midRes.data) {
        basicRow = midRes.data
      } else if (midRes.error && /auth_user_id|email|pgrst204|column/i.test(midRes.error.message || '')) {
        const legacyRes = await adminSupabase
          .from('profiles')
          .select('id, full_name, is_banned')
          .eq('id', profileId)
          .maybeSingle()
        if (legacyRes.error || !legacyRes.data) {
          return { profile: null, schemaReady: false, error: legacyRes.error?.message }
        }
        basicRow = legacyRes.data
      } else {
        return { profile: null, schemaReady: false, error: midRes.error?.message }
      }

      if (!basicRow) {
        return { profile: null, schemaReady: false }
      }

      const fallback = boostFallbackStore.get(profileId) || {
        boostedUntil: null,
        boostPoints: BOOST_STARTING_POINTS,
        lastBoostedAt: null,
        lastPointsClaimAt: null,
      }
      boostFallbackStore.set(profileId, fallback)
      return {
        schemaReady: false,
        profile: {
          id: basicRow.id,
          full_name: basicRow.full_name || '',
          email: basicRow.email || '',
          auth_user_id: basicRow.auth_user_id || null,
          is_banned: Boolean(basicRow.is_banned),
          boosted_until: fallback.boostedUntil,
          boost_points: fallback.boostPoints,
          last_boosted_at: fallback.lastBoostedAt,
          last_points_claim_at: fallback.lastPointsClaimAt,
        },
      }
    }

    if (res.error || !res.data) {
      return { profile: null, schemaReady: true, error: res.error?.message }
    }

    return {
      schemaReady: true,
      profile: {
        id: res.data.id,
        full_name: res.data.full_name || '',
        email: res.data.email || '',
        auth_user_id: res.data.auth_user_id || null,
        is_banned: Boolean(res.data.is_banned),
        boosted_until: res.data.boosted_until || null,
        boost_points:
          typeof res.data.boost_points === 'number' ? res.data.boost_points : BOOST_STARTING_POINTS,
        last_boosted_at: res.data.last_boosted_at || null,
        last_points_claim_at: res.data.last_points_claim_at || null,
      },
    }
  }

  async function verifyOptionalProfileBearer(
    req: Request,
    profile: { email: string; auth_user_id: string | null }
  ): Promise<boolean> {
    if (!adminSupabase) return false
    const bearer = extractBearerToken(req)
    if (!bearer) return true
    const { data, error } = await adminSupabase.auth.getUser(bearer)
    if (error || !data?.user) return false
    const tokenEmail = (data.user.email || '').toLowerCase()
    if (profile.auth_user_id && data.user.id === profile.auth_user_id) return true
    if (profile.email && tokenEmail && profile.email.toLowerCase() === tokenEmail) return true
    return false
  }

  async function persistProfileBoostUpdate(
    profileId: string,
    schemaReady: boolean,
    patch: {
      boosted_until?: string | null
      boost_points?: number
      last_boosted_at?: string | null
      last_points_claim_at?: string | null
    },
    transaction?: Omit<BoostTransactionEntry, 'id' | 'created_at'>
  ): Promise<{ persistedToDb: boolean }> {
    const existingFallback = boostFallbackStore.get(profileId) || {
      boostedUntil: null,
      boostPoints: BOOST_STARTING_POINTS,
      lastBoostedAt: null,
      lastPointsClaimAt: null,
    }
    const nextFallback: BoostFallbackEntry = {
      boostedUntil:
        patch.boosted_until !== undefined ? patch.boosted_until : existingFallback.boostedUntil,
      boostPoints:
        typeof patch.boost_points === 'number' ? patch.boost_points : existingFallback.boostPoints,
      lastBoostedAt:
        patch.last_boosted_at !== undefined ? patch.last_boosted_at : existingFallback.lastBoostedAt,
      lastPointsClaimAt:
        patch.last_points_claim_at !== undefined
          ? patch.last_points_claim_at
          : existingFallback.lastPointsClaimAt,
    }
    boostFallbackStore.set(profileId, nextFallback)

    let persistedToDb = false
    if (adminSupabase && schemaReady) {
      const { error } = await adminSupabase
        .from('profiles')
        .update(patch)
        .eq('id', profileId)
      if (!error) {
        persistedToDb = true
      }
    }

    if (transaction) {
      if (transaction.gateway_reference) {
        redeemedCheckoutRefs.add(transaction.gateway_reference)
      }
      const fallbackEntry: BoostTransactionEntry = {
        id: crypto.randomUUID(),
        ...transaction,
        created_at: new Date().toISOString(),
      }
      const prevList = boostTxFallbackStore.get(profileId) || []
      boostTxFallbackStore.set(profileId, [fallbackEntry, ...prevList].slice(0, 20))

      if (adminSupabase) {
        try {
          await adminSupabase.from('boost_transactions').insert([
            {
              profile_id: profileId,
              method: transaction.method,
              amount_cents: transaction.amount_cents,
              currency: transaction.currency,
              points_spent: transaction.points_spent,
              status: transaction.status,
              gateway_reference: transaction.gateway_reference,
              boosted_until: transaction.boosted_until,
            },
          ])
        } catch {
          // fallback ledger already captured in memory
        }
      }
    }

    return { persistedToDb }
  }

  function formatBoostStatusPayload(
    profile: {
      boosted_until: string | null
      boost_points: number
      last_points_claim_at: string | null
    },
    transactions: BoostTransactionEntry[] = []
  ) {
    const now = Date.now()
    const boostedUntilMs = getBoostTimeMs(profile.boosted_until)
    const isBoosted = boostedUntilMs > now
    const remainingSeconds = isBoosted ? Math.max(0, Math.floor((boostedUntilMs - now) / 1000)) : 0
    const lastClaimMs = getBoostTimeMs(profile.last_points_claim_at)
    const cooldownMs = 24 * 60 * 60 * 1000
    const canClaimDailyBonus = !lastClaimMs || now - lastClaimMs >= cooldownMs
    const nextBonusAt = canClaimDailyBonus ? null : new Date(lastClaimMs + cooldownMs).toISOString()

    return {
      boostedUntil: profile.boosted_until,
      isBoosted,
      remainingSeconds,
      boostPoints: profile.boost_points,
      canClaimDailyBonus,
      nextBonusAt,
      transactions,
    }
  }

  app.get('/api/boost/config', (_req: Request, res: Response) => {
    res.json({
      ok: true,
      durationHours: BOOST_DURATION_HOURS,
      pointsCost: BOOST_POINTS_COST,
      dailyBonusPoints: BOOST_DAILY_BONUS_POINTS,
      startingPoints: BOOST_STARTING_POINTS,
      priceZarCents: BOOST_PRICE_ZAR_CENTS,
      currency: 'ZAR',
      gateways: {
        paystack: Boolean(PAYSTACK_SECRET_KEY),
        stripe: Boolean(STRIPE_SECRET_KEY),
        sandbox: true,
      },
    })
  })

  app.get('/api/boost/status', async (req: Request, res: Response) => {
    const profileId = typeof req.query.profileId === 'string' ? req.query.profileId.trim() : ''
    if (!UUID_RE.test(profileId)) {
      res.status(400).json({ ok: false, error: 'Valid profileId UUID is required' })
      return
    }
    try {
      const loaded = await loadProfileForBoost(profileId)
      if (!loaded.profile) {
        res.status(404).json({ ok: false, error: loaded.error || 'Profile not found' })
        return
      }

      let transactions: BoostTransactionEntry[] = boostTxFallbackStore.get(profileId) || []
      if (adminSupabase) {
        const txRes = await adminSupabase
          .from('boost_transactions')
          .select('id, method, amount_cents, currency, points_spent, status, gateway_reference, boosted_until, created_at')
          .eq('profile_id', profileId)
          .order('created_at', { ascending: false })
          .limit(10)
        if (!txRes.error && Array.isArray(txRes.data)) {
          transactions = txRes.data as BoostTransactionEntry[]
        }
      }

      res.json({
        ok: true,
        ...formatBoostStatusPayload(loaded.profile, transactions),
        schemaReady: loaded.schemaReady,
      })
    } catch (err: unknown) {
      res.status(500).json({
        ok: false,
        error: err instanceof Error ? err.message : 'Unable to check boost status',
      })
    }
  })

  app.post('/api/boost/claim-bonus', async (req: Request, res: Response) => {
    const body = (req.body && typeof req.body === 'object' ? req.body : {}) as { profileId?: unknown }
    const profileId = typeof body.profileId === 'string' ? body.profileId.trim() : ''
    if (!UUID_RE.test(profileId)) {
      res.status(400).json({ ok: false, error: 'Valid profileId UUID is required' })
      return
    }
    try {
      const loaded = await loadProfileForBoost(profileId)
      if (!loaded.profile) {
        res.status(404).json({ ok: false, error: loaded.error || 'Profile not found' })
        return
      }
      if (loaded.profile.is_banned) {
        res.status(403).json({ ok: false, error: 'This profile cannot claim boost points' })
        return
      }
      if (!(await verifyOptionalProfileBearer(req, loaded.profile))) {
        res.status(403).json({ ok: false, error: 'Not authorized to modify this profile' })
        return
      }

      const now = Date.now()
      const lastClaimMs = getBoostTimeMs(loaded.profile.last_points_claim_at)
      const cooldownMs = 24 * 60 * 60 * 1000
      if (lastClaimMs && now - lastClaimMs < cooldownMs) {
        res.status(429).json({
          ok: false,
          error: 'Daily bonus already claimed. Come back after 24 hours.',
          ...formatBoostStatusPayload(loaded.profile),
        })
        return
      }

      const nextPoints = loaded.profile.boost_points + BOOST_DAILY_BONUS_POINTS
      const nowIso = new Date(now).toISOString()
      await persistProfileBoostUpdate(profileId, loaded.schemaReady, {
        boost_points: nextPoints,
        last_points_claim_at: nowIso,
      })

      const updatedProfile = {
        ...loaded.profile,
        boost_points: nextPoints,
        last_points_claim_at: nowIso,
      }
      res.json({
        ok: true,
        pointsAdded: BOOST_DAILY_BONUS_POINTS,
        ...formatBoostStatusPayload(updatedProfile),
      })
    } catch (err: unknown) {
      res.status(500).json({
        ok: false,
        error: err instanceof Error ? err.message : 'Unable to claim daily bonus',
      })
    }
  })

  app.post('/api/boost/activate-points', async (req: Request, res: Response) => {
    const body = (req.body && typeof req.body === 'object' ? req.body : {}) as { profileId?: unknown }
    const profileId = typeof body.profileId === 'string' ? body.profileId.trim() : ''
    if (!UUID_RE.test(profileId)) {
      res.status(400).json({ ok: false, error: 'Valid profileId UUID is required' })
      return
    }
    try {
      const loaded = await loadProfileForBoost(profileId)
      if (!loaded.profile) {
        res.status(404).json({ ok: false, error: loaded.error || 'Profile not found' })
        return
      }
      if (loaded.profile.is_banned) {
        res.status(403).json({ ok: false, error: 'Banned profiles cannot be boosted' })
        return
      }
      if (!(await verifyOptionalProfileBearer(req, loaded.profile))) {
        res.status(403).json({ ok: false, error: 'Not authorized to boost this profile' })
        return
      }
      if (loaded.profile.boost_points < BOOST_POINTS_COST) {
        res.status(400).json({
          ok: false,
          error: `You need ${BOOST_POINTS_COST} Boost Points (current balance: ${loaded.profile.boost_points} pts). Claim your daily bonus or use the Payment Gateway.`,
          ...formatBoostStatusPayload(loaded.profile),
        })
        return
      }

      const now = Date.now()
      const existingEndMs = getBoostTimeMs(loaded.profile.boosted_until)
      const baseStartMs = existingEndMs > now ? existingEndMs : now
      const nextBoostedUntil = new Date(
        baseStartMs + BOOST_DURATION_HOURS * 60 * 60 * 1000
      ).toISOString()
      const nowIso = new Date(now).toISOString()
      const nextPoints = loaded.profile.boost_points - BOOST_POINTS_COST

      await persistProfileBoostUpdate(
        profileId,
        loaded.schemaReady,
        {
          boosted_until: nextBoostedUntil,
          boost_points: nextPoints,
          last_boosted_at: nowIso,
        },
        {
          method: 'points',
          amount_cents: 0,
          currency: 'PTS',
          points_spent: BOOST_POINTS_COST,
          status: 'completed',
          gateway_reference: `pts_${crypto.randomUUID()}`,
          boosted_until: nextBoostedUntil,
        }
      )

      const updatedState = {
        ...loaded.profile,
        boosted_until: nextBoostedUntil,
        boost_points: nextPoints,
        last_boosted_at: nowIso,
      }
      res.json({
        ok: true,
        ...formatBoostStatusPayload(updatedState),
      })
    } catch (err: unknown) {
      res.status(500).json({
        ok: false,
        error: err instanceof Error ? err.message : 'Unable to activate boost with points',
      })
    }
  })

  app.post('/api/boost/create-checkout', async (req: Request, res: Response) => {
    const body = (req.body && typeof req.body === 'object' ? req.body : {}) as {
      profileId?: unknown
      gateway?: unknown
      paymentMethod?: unknown
      email?: unknown
    }
    const profileId = typeof body.profileId === 'string' ? body.profileId.trim() : ''
    const requestedGateway =
      body.gateway === 'stripe' || body.gateway === 'paystack' || body.gateway === 'sandbox'
        ? body.gateway
        : 'sandbox'
    const paymentMethod =
      body.paymentMethod === 'eft' || body.paymentMethod === 'snapscan' ? body.paymentMethod : 'card'
    const bodyEmail = typeof body.email === 'string' ? body.email.trim().toLowerCase() : ''

    if (!UUID_RE.test(profileId)) {
      res.status(400).json({ ok: false, error: 'Valid profileId UUID is required' })
      return
    }

    try {
      const loaded = await loadProfileForBoost(profileId)
      if (!loaded.profile) {
        res.status(404).json({ ok: false, error: loaded.error || 'Profile not found' })
        return
      }
      if (loaded.profile.is_banned) {
        res.status(403).json({ ok: false, error: 'Banned profiles cannot be boosted' })
        return
      }
      if (!(await verifyOptionalProfileBearer(req, loaded.profile))) {
        res.status(403).json({ ok: false, error: 'Not authorized to purchase boost for this profile' })
        return
      }

      const appOrigin = resolveSafeAppOrigin(req)
      const checkoutEmail = EMAIL_RE.test(loaded.profile.email)
        ? loaded.profile.email
        : EMAIL_RE.test(bodyEmail)
        ? bodyEmail
        : 'member@mopanisingles.co.za'

      if (requestedGateway === 'stripe' && STRIPE_SECRET_KEY) {
        const params = new URLSearchParams()
        params.set('mode', 'payment')
        params.set(
          'success_url',
          `${appOrigin}/?boost_checkout=success&gateway=stripe&profile_id=${encodeURIComponent(
            profileId
          )}&session_id={CHECKOUT_SESSION_ID}`
        )
        params.set('cancel_url', `${appOrigin}/?boost_checkout=cancelled`)
        params.set('line_items[0][price_data][currency]', 'zar')
        params.set('line_items[0][price_data][unit_amount]', String(BOOST_PRICE_ZAR_CENTS))
        params.set('line_items[0][price_data][product_data][name]', 'Mopani Singles 24-Hour Profile Boost')
        params.set(
          'line_items[0][price_data][product_data][description]',
          'Highlight your profile at the top of the Discover feed for 24 hours'
        )
        params.set('line_items[0][quantity]', '1')
        params.set('metadata[profileId]', profileId)
        if (EMAIL_RE.test(loaded.profile.email) || EMAIL_RE.test(bodyEmail)) {
          params.set('customer_email', checkoutEmail)
        }

        const stripeRes = await fetch('https://api.stripe.com/v1/checkout/sessions', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${STRIPE_SECRET_KEY}`,
            'Content-Type': 'application/x-www-form-urlencoded',
          },
          body: params.toString(),
          signal: AbortSignal.timeout(10000),
        })
        const stripeJson = (await stripeRes.json().catch(() => ({}))) as {
          id?: string
          url?: string
          error?: { message?: string }
        }
        if (!stripeRes.ok || !stripeJson.url || !stripeJson.id || !stripeJson.url.startsWith('https://')) {
          res.status(502).json({
            ok: false,
            error: stripeJson.error?.message || 'Unable to initialize Stripe checkout session',
          })
          return
        }
        res.json({
          ok: true,
          mode: 'redirect',
          gateway: 'stripe',
          reference: stripeJson.id,
          checkoutUrl: stripeJson.url,
        })
        return
      }

      if (requestedGateway === 'paystack' && PAYSTACK_SECRET_KEY) {
        const reference = `mopani_boost_${crypto.randomBytes(10).toString('hex')}`
        const callbackUrl = `${appOrigin}/?boost_checkout=success&gateway=paystack&profile_id=${encodeURIComponent(
          profileId
        )}`
        const paystackRes = await fetch('https://api.paystack.co/transaction/initialize', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${PAYSTACK_SECRET_KEY}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            email: checkoutEmail,
            amount: BOOST_PRICE_ZAR_CENTS,
            currency: 'ZAR',
            reference,
            callback_url: callbackUrl,
            metadata: { profileId },
          }),
          signal: AbortSignal.timeout(10000),
        })
        const paystackJson = (await paystackRes.json().catch(() => ({}))) as {
          status?: boolean
          message?: string
          data?: { authorization_url?: string; reference?: string }
        }
        const authUrl = paystackJson.data?.authorization_url || ''
        if (!paystackRes.ok || !paystackJson.status || !authUrl.startsWith('https://')) {
          res.status(502).json({
            ok: false,
            error: paystackJson.message || 'Unable to initialize Paystack transaction',
          })
          return
        }
        res.json({
          ok: true,
          mode: 'redirect',
          gateway: 'paystack',
          reference: paystackJson.data?.reference || reference,
          checkoutUrl: authUrl,
        })
        return
      }

      const reference = `sbx_${crypto.randomBytes(10).toString('hex')}`
      const exp = Date.now() + 15 * 60 * 1000
      const checkoutToken = signSandboxCheckoutToken({
        reference,
        profileId,
        method: `sandbox_${paymentMethod}`,
        amountCents: BOOST_PRICE_ZAR_CENTS,
        exp,
      })

      res.json({
        ok: true,
        mode: 'sandbox',
        gateway: 'sandbox',
        reference,
        checkoutToken,
        amountCents: BOOST_PRICE_ZAR_CENTS,
        currency: 'ZAR',
        expiresAt: new Date(exp).toISOString(),
      })
    } catch (err: unknown) {
      res.status(500).json({
        ok: false,
        error: err instanceof Error ? err.message : 'Unable to start payment checkout',
      })
    }
  })

  app.post('/api/boost/confirm-checkout', async (req: Request, res: Response) => {
    const body = (req.body && typeof req.body === 'object' ? req.body : {}) as {
      profileId?: unknown
      gateway?: unknown
      reference?: unknown
      checkoutToken?: unknown
    }
    const profileId = typeof body.profileId === 'string' ? body.profileId.trim() : ''
    const gateway =
      body.gateway === 'stripe' || body.gateway === 'paystack' || body.gateway === 'sandbox'
        ? body.gateway
        : ''
    const reference = typeof body.reference === 'string' ? body.reference.trim().slice(0, 128) : ''
    const checkoutToken = typeof body.checkoutToken === 'string' ? body.checkoutToken.trim() : ''

    if (!UUID_RE.test(profileId) || !gateway || !reference) {
      res.status(400).json({ ok: false, error: 'Valid profileId, gateway, and reference are required' })
      return
    }

    try {
      const loaded = await loadProfileForBoost(profileId)
      if (!loaded.profile) {
        res.status(404).json({ ok: false, error: loaded.error || 'Profile not found' })
        return
      }
      if (loaded.profile.is_banned) {
        res.status(403).json({ ok: false, error: 'Banned profiles cannot be boosted' })
        return
      }

      if (redeemedCheckoutRefs.has(reference)) {
        res.json({
          ok: true,
          alreadyProcessed: true,
          ...formatBoostStatusPayload(loaded.profile),
        })
        return
      }
      if (adminSupabase) {
        const existingTx = await adminSupabase
          .from('boost_transactions')
          .select('id')
          .eq('gateway_reference', reference)
          .maybeSingle()
        if (!existingTx.error && existingTx.data) {
          redeemedCheckoutRefs.add(reference)
          res.json({
            ok: true,
            alreadyProcessed: true,
            ...formatBoostStatusPayload(loaded.profile),
          })
          return
        }
      }

      let verifiedMethod = gateway
      let verifiedAmountCents = BOOST_PRICE_ZAR_CENTS
      let verifiedCurrency = 'ZAR'

      if (gateway === 'stripe') {
        if (!STRIPE_SECRET_KEY) {
          res.status(503).json({ ok: false, error: 'Stripe gateway is not configured on the server' })
          return
        }
        const stripeRes = await fetch(
          `https://api.stripe.com/v1/checkout/sessions/${encodeURIComponent(reference)}`,
          {
            headers: { Authorization: `Bearer ${STRIPE_SECRET_KEY}` },
            signal: AbortSignal.timeout(10000),
          }
        )
        const session = (await stripeRes.json().catch(() => ({}))) as {
          payment_status?: string
          amount_total?: number
          currency?: string
          metadata?: { profileId?: string }
        }
        if (
          !stripeRes.ok ||
          session.payment_status !== 'paid' ||
          typeof session.amount_total !== 'number' ||
          session.amount_total < BOOST_PRICE_ZAR_CENTS ||
          (session.metadata?.profileId && session.metadata.profileId !== profileId)
        ) {
          res.status(402).json({ ok: false, error: 'Stripe payment has not been completed or verified' })
          return
        }
        verifiedMethod = 'stripe'
        verifiedAmountCents = session.amount_total
        verifiedCurrency = (session.currency || 'zar').toUpperCase()
      } else if (gateway === 'paystack') {
        if (!PAYSTACK_SECRET_KEY) {
          res.status(503).json({ ok: false, error: 'Paystack gateway is not configured on the server' })
          return
        }
        const paystackRes = await fetch(
          `https://api.paystack.co/transaction/verify/${encodeURIComponent(reference)}`,
          {
            headers: { Authorization: `Bearer ${PAYSTACK_SECRET_KEY}` },
            signal: AbortSignal.timeout(10000),
          }
        )
        const pJson = (await paystackRes.json().catch(() => ({}))) as {
          status?: boolean
          data?: {
            status?: string
            amount?: number
            currency?: string
            metadata?: { profileId?: string }
          }
        }
        if (
          !paystackRes.ok ||
          !pJson.status ||
          pJson.data?.status !== 'success' ||
          typeof pJson.data?.amount !== 'number' ||
          pJson.data.amount < BOOST_PRICE_ZAR_CENTS ||
          (pJson.data.metadata?.profileId && pJson.data.metadata.profileId !== profileId)
        ) {
          res.status(402).json({ ok: false, error: 'Paystack payment could not be verified' })
          return
        }
        verifiedMethod = 'paystack'
        verifiedAmountCents = pJson.data.amount
        verifiedCurrency = (pJson.data.currency || 'ZAR').toUpperCase()
      } else {
        const verifiedSandbox = verifySandboxCheckoutToken(checkoutToken, profileId, reference)
        if (!verifiedSandbox) {
          res.status(400).json({ ok: false, error: 'Invalid or expired payment checkout session' })
          return
        }
        verifiedMethod = verifiedSandbox.method
        verifiedAmountCents = verifiedSandbox.amountCents
      }

      const now = Date.now()
      const existingEndMs = getBoostTimeMs(loaded.profile.boosted_until)
      const baseStartMs = existingEndMs > now ? existingEndMs : now
      const nextBoostedUntil = new Date(
        baseStartMs + BOOST_DURATION_HOURS * 60 * 60 * 1000
      ).toISOString()
      const nowIso = new Date(now).toISOString()

      await persistProfileBoostUpdate(
        profileId,
        loaded.schemaReady,
        {
          boosted_until: nextBoostedUntil,
          last_boosted_at: nowIso,
        },
        {
          method: verifiedMethod,
          amount_cents: verifiedAmountCents,
          currency: verifiedCurrency,
          points_spent: 0,
          status: 'completed',
          gateway_reference: reference,
          boosted_until: nextBoostedUntil,
        }
      )

      const updatedState = {
        ...loaded.profile,
        boosted_until: nextBoostedUntil,
        last_boosted_at: nowIso,
      }

      res.json({
        ok: true,
        ...formatBoostStatusPayload(updatedState),
      })
    } catch (err: unknown) {
      res.status(500).json({
        ok: false,
        error: err instanceof Error ? err.message : 'Unable to confirm payment checkout',
      })
    }
  })

  app.post('/api/boost/webhook', async (req: Request, res: Response) => {
    if (!PAYSTACK_SECRET_KEY) {
      res.status(503).json({ ok: false, error: 'Paystack gateway is not configured on the server' })
      return
    }

    const rawBody = (req as Request & { rawBody?: Buffer }).rawBody
    const signature = (req.get('x-paystack-signature') || '').trim().toLowerCase()
    if (!rawBody || !signature) {
      res.status(401).json({ ok: false, error: 'Missing Paystack webhook signature' })
      return
    }

    const expectedSignature = crypto
      .createHmac('sha512', PAYSTACK_SECRET_KEY)
      .update(rawBody)
      .digest('hex')
      .toLowerCase()

    if (!verifyPlainSecret(signature, expectedSignature)) {
      res.status(401).json({ ok: false, error: 'Invalid Paystack webhook signature' })
      return
    }

    const payload = (req.body && typeof req.body === 'object' ? req.body : {}) as {
      event?: unknown
      data?: {
        reference?: unknown
        status?: unknown
        amount?: unknown
        currency?: unknown
        metadata?: { profileId?: unknown }
      }
    }

    if (payload.event !== 'charge.success') {
      res.json({ ok: true, ignored: true })
      return
    }

    const data = payload.data || {}
    const reference = typeof data.reference === 'string' ? data.reference.trim().slice(0, 128) : ''
    const status = typeof data.status === 'string' ? data.status.trim().toLowerCase() : ''
    const amount = typeof data.amount === 'number' ? data.amount : 0
    const currency = typeof data.currency === 'string' ? data.currency.toUpperCase() : 'ZAR'
    const profileId =
      typeof data.metadata?.profileId === 'string' ? data.metadata.profileId.trim() : ''

    if (
      !reference ||
      status !== 'success' ||
      amount < BOOST_PRICE_ZAR_CENTS ||
      !UUID_RE.test(profileId)
    ) {
      res.json({ ok: true, skipped: true })
      return
    }

    try {
      if (redeemedCheckoutRefs.has(reference)) {
        res.json({ ok: true, alreadyProcessed: true })
        return
      }
      if (adminSupabase) {
        const existingTx = await adminSupabase
          .from('boost_transactions')
          .select('id')
          .eq('gateway_reference', reference)
          .maybeSingle()
        if (!existingTx.error && existingTx.data) {
          redeemedCheckoutRefs.add(reference)
          res.json({ ok: true, alreadyProcessed: true })
          return
        }
      }

      const loaded = await loadProfileForBoost(profileId)
      if (!loaded.profile || loaded.profile.is_banned) {
        res.json({ ok: true, skipped: true })
        return
      }

      const now = Date.now()
      const existingEndMs = getBoostTimeMs(loaded.profile.boosted_until)
      const baseStartMs = existingEndMs > now ? existingEndMs : now
      const nextBoostedUntil = new Date(
        baseStartMs + BOOST_DURATION_HOURS * 60 * 60 * 1000
      ).toISOString()
      const nowIso = new Date(now).toISOString()

      await persistProfileBoostUpdate(
        profileId,
        loaded.schemaReady,
        {
          boosted_until: nextBoostedUntil,
          last_boosted_at: nowIso,
        },
        {
          method: 'paystack',
          amount_cents: amount,
          currency,
          points_spent: 0,
          status: 'completed',
          gateway_reference: reference,
          boosted_until: nextBoostedUntil,
        }
      )

      res.json({ ok: true, boostedUntil: nextBoostedUntil })
    } catch (err: unknown) {
      res.status(500).json({
        ok: false,
        error: err instanceof Error ? err.message : 'Unable to process Paystack webhook',
      })
    }
  })

  const ALLOWED_EVENT_MUNICIPALITIES = new Set([
    'Maruleng',
    'Greater Tzaneen',
    'Greater Letaba',
    'Ba-Phalaborwa',
    'Greater Giyani',
  ])

  const isMissingEventsTableErr = (err: { code?: string; message?: string } | null | undefined) => {
    if (!err) return false
    const code = (err.code || '').toUpperCase()
    const msg = err.message || ''
    return (
      code === '42P01' ||
      code === 'PGRST205' ||
      /relation .*events.* does not exist|could not find the table .*events|schema cache/i.test(msg)
    )
  }

  app.get('/api/events', async (req: Request, res: Response) => {
    if (!adminSupabase) {
      res.status(503).json({ ok: false, error: 'Server Supabase client is not configured' })
      return
    }

    const municipality =
      typeof req.query.municipality === 'string' ? req.query.municipality.trim() : ''

    try {
      let query = adminSupabase
        .from('events')
        .select(
          'id, title, municipality, venue, event_date, description, category, host_name, is_published, created_at'
        )
        .eq('is_published', true)
        .order('event_date', { ascending: true })
        .limit(50)

      if (municipality && municipality !== 'All' && ALLOWED_EVENT_MUNICIPALITIES.has(municipality)) {
        query = query.eq('municipality', municipality)
      }

      const { data, error } = await query
      if (error) {
        if (isMissingEventsTableErr(error)) {
          res.json({ ok: true, events: [], tableMissing: true })
          return
        }
        res.status(400).json({ ok: false, error: error.message })
        return
      }

      res.json({ ok: true, events: data || [], tableMissing: false })
    } catch (err: unknown) {
      res.status(500).json({
        ok: false,
        error: err instanceof Error ? err.message : 'Unable to fetch local events',
      })
    }
  })

  app.get('/api/admin/events', async (req: Request, res: Response) => {
    const adminEmail = requireAdminAuth(req, res)
    if (!adminEmail) return
    if (!adminSupabase) {
      res.status(503).json({ ok: false, error: 'Server Supabase client is not configured' })
      return
    }

    try {
      const { data, error } = await adminSupabase
        .from('events')
        .select(
          'id, title, municipality, venue, event_date, description, category, host_name, is_published, created_at'
        )
        .order('event_date', { ascending: true })
        .limit(100)

      if (error) {
        if (isMissingEventsTableErr(error)) {
          res.json({ ok: true, events: [], tableMissing: true })
          return
        }
        res.status(400).json({ ok: false, error: error.message })
        return
      }

      res.json({ ok: true, events: data || [], tableMissing: false })
    } catch (err: unknown) {
      res.status(500).json({
        ok: false,
        error: err instanceof Error ? err.message : 'Unable to load admin events',
      })
    }
  })

  app.post('/api/admin/events', async (req: Request, res: Response) => {
    const adminEmail = requireAdminAuth(req, res)
    if (!adminEmail) return
    if (!adminSupabase) {
      res.status(503).json({ ok: false, error: 'Server Supabase client is not configured' })
      return
    }

    const body = (req.body && typeof req.body === 'object' ? req.body : {}) as {
      title?: unknown
      municipality?: unknown
      venue?: unknown
      event_date?: unknown
      description?: unknown
      category?: unknown
      host_name?: unknown
      is_published?: unknown
    }

    const title = typeof body.title === 'string' ? body.title.trim().slice(0, 140) : ''
    const municipality =
      typeof body.municipality === 'string' ? body.municipality.trim() : ''
    const venue = typeof body.venue === 'string' ? body.venue.trim().slice(0, 160) : ''
    const rawDate = typeof body.event_date === 'string' ? body.event_date.trim() : ''
    const description =
      typeof body.description === 'string' ? body.description.trim().slice(0, 600) : ''
    const category =
      typeof body.category === 'string' && body.category.trim()
        ? body.category.trim().slice(0, 60)
        : 'Community Meet-Up'
    const hostName =
      typeof body.host_name === 'string' && body.host_name.trim()
        ? body.host_name.trim().slice(0, 80)
        : 'Mopani Singles Community'
    const isPublished = body.is_published !== false

    if (title.length < 3) {
      res.status(400).json({ ok: false, error: 'Event title must be at least 3 characters.' })
      return
    }
    if (!ALLOWED_EVENT_MUNICIPALITIES.has(municipality)) {
      res.status(400).json({ ok: false, error: 'Select a valid Mopani municipality.' })
      return
    }
    if (venue.length < 2) {
      res.status(400).json({ ok: false, error: 'Event venue is required.' })
      return
    }
    const parsedDateMs = Date.parse(rawDate)
    if (!rawDate || !Number.isFinite(parsedDateMs)) {
      res.status(400).json({ ok: false, error: 'Provide a valid event date and time.' })
      return
    }

    try {
      const { data, error } = await adminSupabase
        .from('events')
        .insert([
          {
            title,
            municipality,
            venue,
            event_date: new Date(parsedDateMs).toISOString(),
            description,
            category,
            host_name: hostName,
            is_published: isPublished,
          },
        ])
        .select(
          'id, title, municipality, venue, event_date, description, category, host_name, is_published, created_at'
        )
        .single()

      if (error) {
        if (isMissingEventsTableErr(error)) {
          res.status(400).json({
            ok: false,
            error:
              'The Supabase events table has not been created yet. Run the updated supabase.sql in your Supabase SQL Editor first.',
          })
          return
        }
        res.status(400).json({ ok: false, error: error.message })
        return
      }

      res.json({ ok: true, event: data })
    } catch (err: unknown) {
      res.status(500).json({
        ok: false,
        error: err instanceof Error ? err.message : 'Unable to create event',
      })
    }
  })

  app.delete('/api/admin/events/:id', async (req: Request, res: Response) => {
    const adminEmail = requireAdminAuth(req, res)
    if (!adminEmail) return
    if (!adminSupabase) {
      res.status(503).json({ ok: false, error: 'Server Supabase client is not configured' })
      return
    }

    const id = typeof req.params.id === 'string' ? req.params.id.trim() : ''
    if (!UUID_RE.test(id)) {
      res.status(400).json({ ok: false, error: 'Valid event UUID is required' })
      return
    }

    try {
      const { error } = await adminSupabase.from('events').delete().eq('id', id)
      if (error) {
        if (isMissingEventsTableErr(error)) {
          res.status(400).json({
            ok: false,
            error: 'The Supabase events table has not been created yet.',
          })
          return
        }
        res.status(400).json({ ok: false, error: error.message })
        return
      }
      res.json({ ok: true })
    } catch (err: unknown) {
      res.status(500).json({
        ok: false,
        error: err instanceof Error ? err.message : 'Unable to delete event',
      })
    }
  })

  app.get('/api/messages', async (req: Request, res: Response) => {
    if (!adminSupabase) {
      res.status(503).json({ ok: false, error: 'Server Supabase client is not configured' })
      return
    }
    const profileId =
      typeof req.query.profileId === 'string' ? req.query.profileId.trim() : ''
    const senderId = typeof req.query.senderId === 'string' ? req.query.senderId.trim() : ''
    const peerId = typeof req.query.peerId === 'string' ? req.query.peerId.trim() : ''

    try {
      if (senderId && peerId) {
        if (!UUID_RE.test(senderId) || !UUID_RE.test(peerId)) {
          res.status(400).json({ ok: false, error: 'Invalid participant UUIDs' })
          return
        }
        const { data, error } = await adminSupabase
          .from('messages')
          .select('id, sender_id, receiver_id, content, created_at')
          .or(
            `and(sender_id.eq.${senderId},receiver_id.eq.${peerId}),and(sender_id.eq.${peerId},receiver_id.eq.${senderId})`
          )
          .order('created_at', { ascending: true })
          .limit(300)

        if (error) {
          res.status(400).json({ ok: false, error: error.message })
          return
        }
        res.json({ ok: true, messages: data || [] })
        return
      }

      if (!UUID_RE.test(profileId)) {
        res.status(400).json({ ok: false, error: 'Valid profileId UUID is required' })
        return
      }

      const { data, error } = await adminSupabase
        .from('messages')
        .select('id, sender_id, receiver_id, content, created_at')
        .or(`sender_id.eq.${profileId},receiver_id.eq.${profileId}`)
        .order('created_at', { ascending: true })
        .limit(500)

      if (error) {
        res.status(400).json({ ok: false, error: error.message })
        return
      }
      res.json({ ok: true, messages: data || [] })
    } catch (err: unknown) {
      res.status(500).json({
        ok: false,
        error: err instanceof Error ? err.message : 'Unable to fetch messages',
      })
    }
  })

  app.post('/api/messages/send', async (req: Request, res: Response) => {
    if (!adminSupabase) {
      res.status(503).json({ ok: false, error: 'Server Supabase client is not configured' })
      return
    }
    const body = (req.body && typeof req.body === 'object' ? req.body : {}) as {
      id?: unknown
      sender_id?: unknown
      receiver_id?: unknown
      content?: unknown
    }
    const id = typeof body.id === 'string' && UUID_RE.test(body.id.trim()) ? body.id.trim() : undefined
    const senderId = typeof body.sender_id === 'string' ? body.sender_id.trim() : ''
    const receiverId = typeof body.receiver_id === 'string' ? body.receiver_id.trim() : ''
    const content = typeof body.content === 'string' ? body.content.slice(0, 10000) : ''

    if (!UUID_RE.test(senderId) || !UUID_RE.test(receiverId) || senderId === receiverId) {
      res.status(400).json({ ok: false, error: 'Valid distinct sender_id and receiver_id are required' })
      return
    }
    if (!content.trim()) {
      res.status(400).json({ ok: false, error: 'Message content cannot be empty' })
      return
    }

    try {
      const senderCheck = await adminSupabase
        .from('profiles')
        .select('id, is_banned, email_verified')
        .eq('id', senderId)
        .maybeSingle()

      if (!senderCheck.error && senderCheck.data) {
        if (senderCheck.data.is_banned) {
          res.status(403).json({ ok: false, error: 'Your profile is restricted from sending messages' })
          return
        }
        if (senderCheck.data.email_verified === false) {
          res.status(403).json({
            ok: false,
            error: 'Please verify your email address before connecting with other users.',
          })
          return
        }
      }

      const insertRow = id
        ? { id, sender_id: senderId, receiver_id: receiverId, content }
        : { sender_id: senderId, receiver_id: receiverId, content }

      const { data, error } = await adminSupabase
        .from('messages')
        .insert([insertRow])
        .select('id, sender_id, receiver_id, content, created_at')
        .single()

      if (error) {
        res.status(400).json({ ok: false, error: error.message })
        return
      }
      res.json({ ok: true, message: data })
    } catch (err: unknown) {
      res.status(500).json({
        ok: false,
        error: err instanceof Error ? err.message : 'Unable to send message',
      })
    }
  })

  app.post('/api/reports', async (req: Request, res: Response) => {
    if (!adminSupabase) {
      res.status(503).json({ ok: false, error: 'Server Supabase client is not configured' })
      return
    }
    const body = (req.body && typeof req.body === 'object' ? req.body : {}) as {
      reported_id?: unknown
      reason?: unknown
    }
    const reportedId = typeof body.reported_id === 'string' ? body.reported_id.trim().slice(0, 120) : ''
    const reason = typeof body.reason === 'string' ? body.reason.trim().slice(0, 2000) : ''

    if (!reportedId || !reason) {
      res.status(400).json({ ok: false, error: 'reported_id and reason are required' })
      return
    }

    try {
      const { error } = await adminSupabase
        .from('reports')
        .insert([{ reported_id: reportedId, reason }])
      if (error) {
        res.status(400).json({ ok: false, error: error.message })
        return
      }
      res.json({ ok: true })
    } catch (err: unknown) {
      res.status(500).json({
        ok: false,
        error: err instanceof Error ? err.message : 'Unable to submit report',
      })
    }
  })

  app.post('/api/chat/notify', async (req: Request, res: Response) => {
    const body = (req.body && typeof req.body === 'object' ? req.body : {}) as {
      message_id?: unknown
      sender_id?: unknown
      receiver_id?: unknown
      content?: unknown
    }

    const messageId = typeof body.message_id === 'string' ? body.message_id.trim() : ''
    const senderId = typeof body.sender_id === 'string' ? body.sender_id.trim() : ''
    const receiverId = typeof body.receiver_id === 'string' ? body.receiver_id.trim() : ''
    const content = typeof body.content === 'string' ? body.content.slice(0, 10000) : ''

    if (!UUID_RE.test(senderId) || !UUID_RE.test(receiverId)) {
      res.status(400).json({ ok: false, error: 'Valid sender_id and receiver_id UUIDs are required' })
      return
    }

    if (senderId === receiverId) {
      res.json({ ok: true, skipped: true, reason: 'self_message' })
      return
    }

    if (messageId && !UUID_RE.test(messageId)) {
      res.status(400).json({ ok: false, error: 'Invalid message_id format' })
      return
    }

    const authToken = SUPABASE_SECRET_KEY || SUPABASE_PUBLISHABLE_KEY
    if (!SUPABASE_URL || !authToken) {
      res.status(503).json({ ok: false, error: 'Supabase configuration is incomplete' })
      return
    }

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${authToken}`,
      apikey: SUPABASE_PUBLISHABLE_KEY || authToken,
    }
    if (NOTIFY_WEBHOOK_SECRET) {
      headers['x-webhook-secret'] = NOTIFY_WEBHOOK_SECRET
    }

    try {
      const fnResponse = await fetch(`${SUPABASE_URL}/functions/v1/notify-new-message`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          message_id: messageId || undefined,
          sender_id: senderId,
          receiver_id: receiverId,
          content,
        }),
        signal: AbortSignal.timeout(8000),
      })

      const data = (await fnResponse.json().catch(() => ({}))) as Record<string, unknown>
      if (!fnResponse.ok) {
        res.status(fnResponse.status).json({
          ok: false,
          error: typeof data.error === 'string' ? data.error : 'Notification function returned an error',
        })
        return
      }
      res.json(data)
    } catch {
      res.status(502).json({ ok: false, error: 'Unable to reach notification Edge Function' })
    }
  })

  app.get('/api/maps/config', (_req: Request, res: Response) => {
    res.json({
      apiKey: GOOGLE_MAPS_API_KEY,
    })
  })

  app.post('/api/maps/geocode', async (req: Request, res: Response) => {
    if (!GOOGLE_MAPS_API_KEY) {
      res.status(503).json({ ok: false, error: 'Google Maps API key is not configured' })
      return
    }

    const body = (req.body && typeof req.body === 'object' ? req.body : {}) as {
      addresses?: unknown
    }
    if (!Array.isArray(body.addresses)) {
      res.status(400).json({ ok: false, error: 'addresses array is required' })
      return
    }

    const uniqueAddresses = Array.from(
      new Set(
        body.addresses
          .filter((a): a is string => typeof a === 'string')
          .map((a) => a.trim())
          .filter((a) => a.length >= 2 && a.length <= 200)
      )
    ).slice(0, 25)

    const results: Record<string, { lat: number; lng: number; formattedAddress: string }> = {}
    const referer = req.get('origin') || req.get('referer') || process.env.APP_URL || ''

    for (const address of uniqueAddresses) {
      const cacheKey = address.toLowerCase()
      const cached = geocodeCache.get(cacheKey)
      if (cached && Date.now() - cached.cachedAt < GEOCODE_CACHE_TTL_MS) {
        results[address] = {
          lat: cached.lat,
          lng: cached.lng,
          formattedAddress: cached.formattedAddress,
        }
        continue
      }

      try {
        const geocodeUrl = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(
          address
        )}&region=za&key=${encodeURIComponent(GOOGLE_MAPS_API_KEY)}`
        const geoRes = await fetch(geocodeUrl, {
          headers: referer ? { Referer: referer } : undefined,
          signal: AbortSignal.timeout(6000),
        })

        const geoJson = (await geoRes.json().catch(() => ({}))) as {
          status?: string
          error_message?: string
          results?: Array<{
            formatted_address?: string
            geometry?: { location?: { lat?: number; lng?: number } }
          }>
        }

        if (geoRes.status === 429 || geoJson.status === 'OVER_QUERY_LIMIT') {
          res.status(429).json({
            ok: false,
            quotaExceeded: true,
            error: geoJson.error_message || 'Google Maps Geocoding quota exceeded',
          })
          return
        }

        const first = geoJson.results?.[0]
        const loc = first?.geometry?.location
        if (geoRes.ok && geoJson.status === 'OK' && typeof loc?.lat === 'number' && typeof loc?.lng === 'number') {
          const entry = {
            lat: loc.lat,
            lng: loc.lng,
            formattedAddress: first?.formatted_address || address,
          }
          if (geocodeCache.size >= 100) {
            const oldestKey = geocodeCache.keys().next().value
            if (oldestKey) geocodeCache.delete(oldestKey)
          }
          geocodeCache.set(cacheKey, { ...entry, cachedAt: Date.now() })
          results[address] = entry
        }
      } catch {
        // skip single failed address lookup
      }
    }

    res.json({ ok: true, results })
  })

  app.post('/api/maps/distance-matrix', async (req: Request, res: Response) => {
    if (!GOOGLE_MAPS_API_KEY) {
      res.status(503).json({ ok: false, error: 'Google Maps API key is not configured' })
      return
    }

    const body = (req.body && typeof req.body === 'object' ? req.body : {}) as {
      origin?: { lat?: unknown; lng?: unknown }
      destinations?: Array<{ id?: unknown; lat?: unknown; lng?: unknown }>
      travelMode?: unknown
    }

    const originLat = Number(body.origin?.lat)
    const originLng = Number(body.origin?.lng)
    if (!Number.isFinite(originLat) || !Number.isFinite(originLng)) {
      res.status(400).json({ ok: false, error: 'Valid origin coordinates are required' })
      return
    }

    if (!Array.isArray(body.destinations) || body.destinations.length === 0) {
      res.status(400).json({ ok: false, error: 'At least one destination is required' })
      return
    }

    const validDestinations = body.destinations
      .map((d) => ({
        id: typeof d.id === 'string' ? d.id.trim() : '',
        lat: Number(d.lat),
        lng: Number(d.lng),
      }))
      .filter((d) => d.id && Number.isFinite(d.lat) && Number.isFinite(d.lng))
      .slice(0, 25)

    if (validDestinations.length === 0) {
      res.status(400).json({ ok: false, error: 'No valid destinations provided' })
      return
    }

    const travelMode = body.travelMode === 'WALK' ? 'WALK' : 'DRIVE'
    const referer = req.get('origin') || req.get('referer') || process.env.APP_URL || ''

    try {
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': GOOGLE_MAPS_API_KEY,
        'X-Goog-FieldMask': 'originIndex,destinationIndex,duration,distanceMeters,status,condition',
        'X-Goog-Maps-Solution-ID': 'gmp_mcp_codeassist_v1_aistudio',
      }
      if (referer) {
        headers.Referer = referer
      }

      const matrixRes = await fetch(
        'https://routes.googleapis.com/distanceMatrix/v2:computeRouteMatrix',
        {
          method: 'POST',
          headers,
          body: JSON.stringify({
            origins: [
              {
                waypoint: {
                  location: {
                    latLng: { latitude: originLat, longitude: originLng },
                  },
                },
              },
            ],
            destinations: validDestinations.map((d) => ({
              waypoint: {
                location: {
                  latLng: { latitude: d.lat, longitude: d.lng },
                },
              },
            })),
            travelMode,
            routingPreference: travelMode === 'DRIVE' ? 'TRAFFIC_AWARE' : undefined,
          }),
          signal: AbortSignal.timeout(8000),
        }
      )

      const matrixJson = (await matrixRes.json().catch(() => null)) as
        | Array<{
            originIndex?: number
            destinationIndex?: number
            distanceMeters?: number
            duration?: string
            condition?: string
            status?: { code?: number; message?: string }
          }>
        | { error?: { code?: number; status?: string; message?: string } }
        | null

      if (
        matrixRes.status === 429 ||
        (matrixJson &&
          !Array.isArray(matrixJson) &&
          matrixJson.error?.status === 'RESOURCE_EXHAUSTED')
      ) {
        res.status(429).json({
          ok: false,
          quotaExceeded: true,
          error: 'Google Maps Routes API quota exceeded',
        })
        return
      }

      if (!matrixRes.ok || !Array.isArray(matrixJson)) {
        const msg =
          matrixJson && !Array.isArray(matrixJson) && matrixJson.error?.message
            ? matrixJson.error.message
            : 'Unable to calculate route distances'
        res.status(matrixRes.status >= 400 ? matrixRes.status : 502).json({
          ok: false,
          error: msg,
        })
        return
      }

      const distances: Record<
        string,
        { distanceMeters: number; durationSeconds: number; condition: string }
      > = {}

      for (const item of matrixJson) {
        const idx = typeof item.destinationIndex === 'number' ? item.destinationIndex : -1
        const dest = validDestinations[idx]
        if (!dest) continue
        if (item.condition === 'ROUTE_EXISTS' && typeof item.distanceMeters === 'number') {
          const durationMatch =
            typeof item.duration === 'string' ? item.duration.match(/^(\d+(?:\.\d+)?)s$/) : null
          const durationSeconds = durationMatch ? Math.round(Number(durationMatch[1])) : 0
          distances[dest.id] = {
            distanceMeters: item.distanceMeters,
            durationSeconds,
            condition: item.condition,
          }
        }
      }

      res.json({ ok: true, distances })
    } catch {
      res.status(502).json({ ok: false, error: 'Unable to reach Routes API' })
    }
  })

  if (process.env.NODE_ENV !== 'production') {
    const [{ createServer: createViteServer }, { default: react }, { default: tailwindcss }] =
      await Promise.all([
        import('vite'),
        import('@vitejs/plugin-react'),
        import('@tailwindcss/vite'),
      ])
    const vite = await createViteServer({
      configFile: false,
      cacheDir: '/tmp/mopani-vite-cache',
      envPrefix: ['VITE_', 'NEXT_PUBLIC_'],
      plugins: [react(), tailwindcss()],
      resolve: {
        alias: {
          '@': path.resolve(__dirname, './src'),
        },
      },
      server: {
        middlewareMode: true,
        hmr: process.env.DISABLE_HMR !== 'true',
        watch: process.env.DISABLE_HMR === 'true' ? null : {},
      },
      appType: 'spa',
    })
    app.use(vite.middlewares)
  } else {
    const distDir = path.resolve(__dirname, 'dist')
    app.use(express.static(distDir))
    app.get('*', (_req: Request, res: Response) => {
      res.sendFile(path.join(distDir, 'index.html'))
    })
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Mopani Singles-v2 server listening on http://0.0.0.0:${PORT}`)
  })
}

startServer()
