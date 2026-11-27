import { hasDirectClientSupabase, hydrateSupabaseFromServerConfig, supabase } from './client'

export interface VerifiedEmailUser {
  id: string
  email: string
}

// Held strictly in JS memory (never persisted to localStorage/sessionStorage)
const verifiedTokensByEmail = new Map<string, string>()
let latestVerifiedSession: { email: string; authUserId: string; accessToken: string } | null = null

function normalizeEmail(email?: string): string {
  return (email || '').trim().toLowerCase()
}

export function setVerifiedAuthToken(
  email: string,
  accessToken: string,
  authUserId = ''
): void {
  const cleanEmail = normalizeEmail(email)
  if (!cleanEmail || !accessToken) return
  verifiedTokensByEmail.set(cleanEmail, accessToken)
  latestVerifiedSession = {
    email: cleanEmail,
    authUserId,
    accessToken,
  }
}

export function getVerifiedAuthToken(email?: string): string {
  const cleanEmail = normalizeEmail(email)
  if (!cleanEmail) return ''
  return verifiedTokensByEmail.get(cleanEmail) || ''
}

export function getLatestVerifiedEmailSession(): {
  email: string
  authUserId: string
  accessToken: string
} | null {
  return latestVerifiedSession
}

export function clearVerifiedAuthToken(email?: string): void {
  const cleanEmail = normalizeEmail(email)
  if (cleanEmail) {
    verifiedTokensByEmail.delete(cleanEmail)
    if (latestVerifiedSession?.email === cleanEmail) {
      latestVerifiedSession = null
    }
    return
  }
  verifiedTokensByEmail.clear()
  latestVerifiedSession = null
}

export async function sendEmailVerificationOtp(email: string): Promise<{
  ok: boolean
  email?: string
  error?: string
}> {
  const cleanEmail = normalizeEmail(email)
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
    return { ok: false, error: 'Please enter a valid email address.' }
  }

  await hydrateSupabaseFromServerConfig()
  const redirectTo =
    typeof window !== 'undefined' ? `${window.location.origin}${window.location.pathname}` : undefined

  if (hasDirectClientSupabase()) {
    try {
      const { error } = await supabase.auth.signInWithOtp({
        email: cleanEmail,
        options: {
          shouldCreateUser: true,
          ...(redirectTo ? { emailRedirectTo: redirectTo } : {}),
        },
      })
      if (!error) {
        return { ok: true, email: cleanEmail }
      }
    } catch {
      // fall through to server proxy
    }
  }

  try {
    const res = await fetch('/api/auth/send-email-otp', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: cleanEmail, redirectTo }),
    })
    const json = (await res.json().catch(() => ({}))) as {
      ok?: boolean
      email?: string
      error?: string
    }
    if (!res.ok || !json.ok) {
      return {
        ok: false,
        error: json.error || 'Could not send verification email right now.',
      }
    }
    return { ok: true, email: json.email || cleanEmail }
  } catch (err: unknown) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : 'Unable to reach verification service.',
    }
  }
}

export async function verifyEmailOtpCode(
  email: string,
  token: string
): Promise<{
  ok: boolean
  accessToken?: string
  user?: VerifiedEmailUser
  error?: string
}> {
  const cleanEmail = normalizeEmail(email)
  const cleanCode = (token || '').trim().replace(/\s+/g, '')
  if (!cleanEmail || !cleanCode) {
    return { ok: false, error: 'Please enter the verification code from your email.' }
  }

  await hydrateSupabaseFromServerConfig()

  if (hasDirectClientSupabase()) {
    try {
      const { data, error } = await supabase.auth.verifyOtp({
        email: cleanEmail,
        token: cleanCode,
        type: 'email',
      })
      if (!error && data?.user && data?.session?.access_token) {
        const verifiedEmail = normalizeEmail(data.user.email || cleanEmail)
        setVerifiedAuthToken(verifiedEmail, data.session.access_token, data.user.id)
        return {
          ok: true,
          accessToken: data.session.access_token,
          user: { id: data.user.id, email: verifiedEmail },
        }
      }
    } catch {
      // fall through to server proxy
    }
  }

  try {
    const res = await fetch('/api/auth/verify-email-otp', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: cleanEmail, token: cleanCode }),
    })
    const json = (await res.json().catch(() => ({}))) as {
      ok?: boolean
      accessToken?: string
      user?: VerifiedEmailUser
      error?: string
    }
    if (!res.ok || !json.ok || !json.accessToken || !json.user?.email) {
      return {
        ok: false,
        error: json.error || 'Invalid or expired verification code. Please try again.',
      }
    }
    const verifiedEmail = normalizeEmail(json.user.email)
    setVerifiedAuthToken(verifiedEmail, json.accessToken, json.user.id)
    return {
      ok: true,
      accessToken: json.accessToken,
      user: { id: json.user.id, email: verifiedEmail },
    }
  } catch (err: unknown) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : 'Unable to verify code right now.',
    }
  }
}

export async function consumeEmailVerificationFromUrl(): Promise<{
  verified: boolean
  email?: string
  authUserId?: string
  accessToken?: string
  error?: string
} | null> {
  if (typeof window === 'undefined') return null

  const rawHash = window.location.hash.startsWith('#') ? window.location.hash.slice(1) : ''
  const hashParams = new URLSearchParams(rawHash)
  const searchParams = new URLSearchParams(window.location.search)

  const accessToken = hashParams.get('access_token') || ''
  const tokenHash = searchParams.get('token_hash') || hashParams.get('token_hash') || ''
  const type = searchParams.get('type') || hashParams.get('type') || 'email'
  const urlError =
    hashParams.get('error_description') ||
    searchParams.get('error_description') ||
    hashParams.get('error') ||
    searchParams.get('error') ||
    ''

  if (!accessToken && !tokenHash && !urlError) {
    return null
  }

  window.history.replaceState({}, document.title, window.location.pathname)

  if (urlError && !accessToken && !tokenHash) {
    return {
      verified: false,
      error: urlError.replace(/\+/g, ' '),
    }
  }

  try {
    const res = await fetch('/api/auth/verify-email-link', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...(accessToken ? { accessToken } : {}),
        ...(tokenHash ? { tokenHash, type } : {}),
      }),
    })
    const json = (await res.json().catch(() => ({}))) as {
      ok?: boolean
      accessToken?: string
      user?: VerifiedEmailUser
      error?: string
    }
    if (!res.ok || !json.ok || !json.accessToken || !json.user?.email) {
      return {
        verified: false,
        error: json.error || 'Verification link is invalid or expired. Please request a new code.',
      }
    }
    const verifiedEmail = normalizeEmail(json.user.email)
    setVerifiedAuthToken(verifiedEmail, json.accessToken, json.user.id)
    return {
      verified: true,
      email: verifiedEmail,
      authUserId: json.user.id,
      accessToken: json.accessToken,
    }
  } catch (err: unknown) {
    return {
      verified: false,
      error: err instanceof Error ? err.message : 'Unable to confirm verification link.',
    }
  }
}
