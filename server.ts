import dotenv from 'dotenv'
dotenv.config({ path: '.env.local' })
dotenv.config()
import express, { type Request, type Response } from 'express'
import path from 'path'
import { fileURLToPath } from 'url'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const PORT = Number(process.env.PORT) || 3000
const SUPABASE_URL =
  process.env.SUPABASE_URL ||
  process.env.VITE_SUPABASE_URL ||
  process.env.NEXT_PUBLIC_SUPABASE_URL ||
  'https://fmsnansclqsrupufalhz.supabase.co'

const SUPABASE_SECRET_KEY = process.env.SUPABASE_SECRET_KEY || ''

const SUPABASE_PUBLISHABLE_KEY =
  process.env.VITE_SUPABASE_PUBLISHABLE_KEY ||
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
  process.env.VITE_SUPABASE_ANON_KEY ||
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
  ''

const STORAGE_BUCKET =
  process.env.VITE_SUPABASE_STORAGE_BUCKET ||
  process.env.NEXT_PUBLIC_SUPABASE_STORAGE_BUCKET ||
  'mopani-files'

let adminSupabase: SupabaseClient | null = null
if (SUPABASE_URL && SUPABASE_SECRET_KEY) {
  adminSupabase = createClient(SUPABASE_URL, SUPABASE_SECRET_KEY, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  })
}

async function ensureStorageBucket(): Promise<{ ok: boolean; error?: string }> {
  if (!adminSupabase) {
    return { ok: false, error: 'SUPABASE_SECRET_KEY is not configured on the server' }
  }
  try {
    const { data: buckets, error: listErr } = await adminSupabase.storage.listBuckets()
    if (listErr) {
      return { ok: false, error: listErr.message }
    }
    const exists = buckets?.some((b) => b.name === STORAGE_BUCKET)
    if (!exists) {
      const { error: createErr } = await adminSupabase.storage.createBucket(STORAGE_BUCKET, {
        public: true,
      })
      if (createErr) {
        return { ok: false, error: createErr.message }
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
    let dbConnected = false
    if (adminSupabase) {
      try {
        const { error } = await adminSupabase.from('profiles').select('id').limit(1)
        dbConnected = !error
      } catch {
        dbConnected = false
      }
    }
    res.json({
      ok: true,
      serverSecretConfigured: Boolean(SUPABASE_SECRET_KEY),
      publishableKeyConfigured: Boolean(SUPABASE_PUBLISHABLE_KEY),
      dbConnected,
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

  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite')
    const vite = await createViteServer({
      server: { middlewareMode: true },
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
