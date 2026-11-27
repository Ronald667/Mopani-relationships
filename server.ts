import dotenv from 'dotenv'
dotenv.config({ path: '.env.local' })
dotenv.config()
import express, { type Request, type Response } from 'express'
import path from 'path'
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
const GOOGLE_MAPS_API_KEY = (
  process.env.VITE_GOOGLE_MAPS_API_KEY ||
  process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY ||
  process.env.GOOGLE_MAPS_API_KEY ||
  ''
).trim()
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

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
  const requiredBuckets = Array.from(new Set(['profiles', STORAGE_BUCKET]))
  try {
    const { data: buckets, error: listErr } = await adminSupabase.storage.listBuckets()
    if (listErr) {
      return { ok: false, error: listErr.message }
    }
    for (const bucketName of requiredBuckets) {
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
    return { ok: true }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Unable to verify storage bucket'
    return { ok: false, error: msg }
  }
}

async function startServer() {
  const app = express()
  app.use(express.json({ limit: '2mb' }))

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

    if (SUPABASE_PUBLISHABLE_KEY) {
      try {
        const resp = await fetch(`${SUPABASE_URL}/rest/v1/profiles?select=id&limit=1`, {
          headers: {
            apikey: SUPABASE_PUBLISHABLE_KEY,
            Authorization: `Bearer ${SUPABASE_PUBLISHABLE_KEY}`,
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
      publishableKeyConfigured: Boolean(SUPABASE_PUBLISHABLE_KEY),
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
      publishableKey: SUPABASE_PUBLISHABLE_KEY,
      storageBucket: STORAGE_BUCKET,
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
