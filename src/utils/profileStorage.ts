import {
  getVerifiedAuthToken,
  hasDirectClientSupabase,
  hydrateSupabaseFromServerConfig,
  supabase,
} from '@/lib/supabase'

export interface Profile {
  id: string
  full_name: string
  age: number
  gender: string
  municipality: string
  village: string
  language: string
  intention: string
  bio: string
  whatsapp: string
  email?: string
  email_verified?: boolean
  auth_user_id?: string | null
  email_notifications?: boolean
  photo_url: string
  is_verified?: boolean
  verification_status?: 'unverified' | 'pending' | 'verified' | 'rejected' | string
  verification_requested_at?: string | null
  verification_reviewed_at?: string | null
  verification_note?: string
  boosted_until?: string | null
  boost_points?: number
  last_boosted_at?: string | null
  is_approved?: boolean
  is_banned?: boolean
  consent_popia?: boolean
  created_at?: string
}

export interface PrivateMessage {
  id: string
  sender_id: string
  receiver_id: string
  content: string
  created_at: string
}

const MY_PROFILES_KEY = 'mopani_my_profiles'
const LEGACY_MY_PROFILE_KEY = 'mopani_my_profile'
const ACTIVE_PROFILE_ID_KEY = 'mopani_active_profile_id'
const LOCAL_PROFILES_KEY = 'mopani_local_profiles'
const PRIVATE_MESSAGES_KEY = 'mopani_private_messages'
const CHAT_LAST_SEEN_KEY = 'mopani_chat_last_seen'

export function generateProfileId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0
    const v = c === 'x' ? r : (r & 0x3) | 0x8
    return v.toString(16)
  })
}

function safeParseJson<T>(raw: string | null, fallback: T): T {
  if (!raw) return fallback
  try {
    return JSON.parse(raw) as T
  } catch {
    return fallback
  }
}

export function normalizePhone(value: string): string {
  const digits = (value || '').replace(/\D/g, '')
  if (digits.startsWith('0')) {
    return '27' + digits.substring(1)
  }
  return digits
}

export function toSupabaseProfilePayload(profile: Profile) {
  return {
    id: profile.id,
    full_name: profile.full_name,
    age: profile.age,
    gender: profile.gender,
    municipality: profile.municipality,
    village: profile.village,
    language: profile.language,
    intention: profile.intention,
    bio: profile.bio,
    whatsapp: profile.whatsapp,
    email: (profile.email || '').trim().toLowerCase(),
    email_verified: Boolean(profile.email_verified),
    auth_user_id: profile.auth_user_id || null,
    email_notifications: profile.email_notifications ?? true,
    photo_url: profile.photo_url,
    is_approved: profile.is_approved ?? true,
    is_banned: profile.is_banned ?? false,
    created_at: profile.created_at || new Date().toISOString(),
  }
}

export async function saveProfileToSupabase(
  profile: Profile,
  options?: { authToken?: string }
): Promise<{
  profile: Profile
  syncedToSupabase: boolean
  error?: string
}> {
  const payload = toSupabaseProfilePayload(profile)
  await hydrateSupabaseFromServerConfig()

  const authToken = (options?.authToken || getVerifiedAuthToken(payload.email) || '').trim()
  let serverNetworkOrUnavailable = false
  let serverError: string | undefined

  try {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' }
    if (authToken) {
      headers.Authorization = `Bearer ${authToken}`
    }

    const res = await fetch('/api/profiles/save', {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
    })
    const json = (await res.json().catch(() => ({}))) as {
      ok?: boolean
      profile?: Profile
      error?: string
    }
    if (res.ok && json.ok && json.profile) {
      const merged: Profile = {
        ...profile,
        ...json.profile,
        email: json.profile.email ?? profile.email,
        email_verified: json.profile.email_verified ?? profile.email_verified,
        auth_user_id: json.profile.auth_user_id ?? profile.auth_user_id,
        is_verified: json.profile.is_verified ?? profile.is_verified,
        verification_status: json.profile.verification_status ?? profile.verification_status,
        email_notifications:
          json.profile.email_notifications ?? profile.email_notifications ?? true,
      }
      return {
        profile: merged,
        syncedToSupabase: true,
      }
    }
    if (res.status === 503) {
      serverNetworkOrUnavailable = true
      serverError = json.error
    } else {
      return {
        profile,
        syncedToSupabase: false,
        error: json.error || `Unable to sync profile to Supabase (HTTP ${res.status})`,
      }
    }
  } catch (err: unknown) {
    serverNetworkOrUnavailable = true
    serverError = err instanceof Error ? err.message : undefined
  }

  if (serverNetworkOrUnavailable && hasDirectClientSupabase()) {
    try {
      let { data, error } = await supabase
        .from('profiles')
        .upsert([payload], { onConflict: 'id' })
        .select()
        .single()

      if (
        error &&
        /email_verified|auth_user_id|pgrst204|column/i.test(error.message || '')
      ) {
        const {
          email_verified: _ev,
          auth_user_id: _au,
          ...withoutVerificationCols
        } = payload
        const retry = await supabase
          .from('profiles')
          .upsert([withoutVerificationCols], { onConflict: 'id' })
          .select()
          .single()
        data = retry.data
        error = retry.error
      }

      if (
        error &&
        /email|schema cache|pgrst204|column/i.test(error.message || '')
      ) {
        const {
          email: _ignoredEmail,
          email_notifications: _ignoredOptIn,
          email_verified: _ev,
          auth_user_id: _au,
          ...legacyPayload
        } = payload
        const retry = await supabase
          .from('profiles')
          .upsert([legacyPayload], { onConflict: 'id' })
          .select()
          .single()
        data = retry.data
        error = retry.error
      }

      if (!error && data) {
        const merged: Profile = {
          ...profile,
          ...(data as Profile),
          email: (data as Profile)?.email ?? profile.email,
          email_verified:
            (data as Profile)?.email_verified ?? profile.email_verified,
          auth_user_id: (data as Profile)?.auth_user_id ?? profile.auth_user_id,
          email_notifications:
            (data as Profile)?.email_notifications ?? profile.email_notifications ?? true,
        }
        return {
          profile: merged,
          syncedToSupabase: true,
        }
      }
      return {
        profile,
        syncedToSupabase: false,
        error: error?.message || serverError || 'Unable to sync profile to Supabase',
      }
    } catch (err: unknown) {
      return {
        profile,
        syncedToSupabase: false,
        error:
          (err instanceof Error ? err.message : undefined) ||
          serverError ||
          'Unable to sync profile to Supabase',
      }
    }
  }

  return {
    profile,
    syncedToSupabase: false,
    error: serverError || 'Unable to sync profile to Supabase',
  }
}

const FULL_PUBLIC_PROFILE_COLUMNS =
  'id, full_name, age, gender, municipality, village, language, intention, bio, whatsapp, photo_url, email_verified, is_verified, verification_status, boosted_until, is_approved, is_banned, created_at'

const PUBLIC_PROFILE_COLUMNS =
  'id, full_name, age, gender, municipality, village, language, intention, bio, whatsapp, photo_url, email_verified, is_verified, verification_status, is_approved, is_banned, created_at'

const MID_PUBLIC_PROFILE_COLUMNS =
  'id, full_name, age, gender, municipality, village, language, intention, bio, whatsapp, photo_url, email_verified, is_approved, is_banned, created_at'

const LEGACY_PUBLIC_PROFILE_COLUMNS =
  'id, full_name, age, gender, municipality, village, language, intention, bio, whatsapp, photo_url, is_approved, is_banned, created_at'

export async function fetchProfileById(id: string): Promise<Profile | null> {
  if (!id) return null
  await hydrateSupabaseFromServerConfig()

  if (hasDirectClientSupabase()) {
    try {
      let { data, error } = await supabase
        .from('profiles')
        .select(FULL_PUBLIC_PROFILE_COLUMNS)
        .eq('id', id)
        .maybeSingle()

      if (error && /boosted_until|pgrst204|column/i.test(error.message || '')) {
        const retryPublic = await supabase
          .from('profiles')
          .select(PUBLIC_PROFILE_COLUMNS)
          .eq('id', id)
          .maybeSingle()
        data = retryPublic.data as typeof data
        error = retryPublic.error
      }

      if (error && /is_verified|verification_status|pgrst204|column/i.test(error.message || '')) {
        const retryMid = await supabase
          .from('profiles')
          .select(MID_PUBLIC_PROFILE_COLUMNS)
          .eq('id', id)
          .maybeSingle()
        data = retryMid.data as typeof data
        error = retryMid.error
      }

      if (error && /email_verified|pgrst204|column/i.test(error.message || '')) {
        const retry = await supabase
          .from('profiles')
          .select(LEGACY_PUBLIC_PROFILE_COLUMNS)
          .eq('id', id)
          .maybeSingle()
        data = retry.data as typeof data
        error = retry.error
      }

      if (!error && data) {
        const remote = data as Profile
        upsertLocalProfile(remote)
        return remote
      }
    } catch {
      // fall through to server proxy
    }
  }

  try {
    const res = await fetch(`/api/profiles/${encodeURIComponent(id)}`)
    const json = (await res.json().catch(() => ({}))) as {
      ok?: boolean
      profile?: Profile | null
    }
    if (res.ok && json.ok && json.profile) {
      upsertLocalProfile(json.profile)
      return json.profile
    }
  } catch {
    // fall back to local cache
  }

  return getLocalProfiles().find((p) => p.id === id) || null
}

export function getMyProfiles(): Profile[] {
  const stored = safeParseJson<Profile[]>(localStorage.getItem(MY_PROFILES_KEY), [])
  if (stored.length > 0) {
    return stored
  }

  const legacy = safeParseJson<Profile | null>(localStorage.getItem(LEGACY_MY_PROFILE_KEY), null)
  if (legacy && legacy.id) {
    const migrated = [legacy]
    localStorage.setItem(MY_PROFILES_KEY, JSON.stringify(migrated))
    if (!localStorage.getItem(ACTIVE_PROFILE_ID_KEY)) {
      localStorage.setItem(ACTIVE_PROFILE_ID_KEY, legacy.id)
    }
    return migrated
  }

  return []
}

export function saveMyProfiles(profiles: Profile[]): void {
  localStorage.setItem(MY_PROFILES_KEY, JSON.stringify(profiles))
  localStorage.removeItem(LEGACY_MY_PROFILE_KEY)
  const currentActive = localStorage.getItem(ACTIVE_PROFILE_ID_KEY)
  if (profiles.length === 0) {
    localStorage.removeItem(ACTIVE_PROFILE_ID_KEY)
  } else if (!currentActive || !profiles.some((p) => p.id === currentActive)) {
    localStorage.setItem(ACTIVE_PROFILE_ID_KEY, profiles[0].id)
  }
}

export function getActiveProfileId(): string {
  const profiles = getMyProfiles()
  if (profiles.length === 0) return ''
  const storedId = localStorage.getItem(ACTIVE_PROFILE_ID_KEY)
  if (storedId && profiles.some((p) => p.id === storedId)) {
    return storedId
  }
  localStorage.setItem(ACTIVE_PROFILE_ID_KEY, profiles[0].id)
  return profiles[0].id
}

export function setActiveProfileId(id: string): void {
  const profiles = getMyProfiles()
  if (profiles.some((p) => p.id === id)) {
    localStorage.setItem(ACTIVE_PROFILE_ID_KEY, id)
  }
}

export function getActiveProfile(): Profile | null {
  const profiles = getMyProfiles()
  if (profiles.length === 0) return null
  const activeId = getActiveProfileId()
  return profiles.find((p) => p.id === activeId) || profiles[0]
}

export function addMyProfile(profile: Profile): Profile[] {
  // Enforce one profile per user
  const next = [profile]
  saveMyProfiles(next)
  localStorage.setItem(ACTIVE_PROFILE_ID_KEY, profile.id)
  upsertLocalProfile(profile)
  return next
}

export function updateMyProfile(updated: Profile): Profile[] {
  const existing = getMyProfiles()
  const idx = existing.findIndex((p) => p.id === updated.id)
  const next = idx >= 0
    ? existing.map((p) => (p.id === updated.id ? updated : p))
    : [...existing, updated]
  saveMyProfiles(next)
  upsertLocalProfile(updated)
  return next
}

export function deleteMyProfile(id: string): Profile[] {
  const next = getMyProfiles().filter((p) => p.id !== id)
  saveMyProfiles(next)
  const localProfiles = getLocalProfiles().filter((p) => p.id !== id)
  localStorage.setItem(LOCAL_PROFILES_KEY, JSON.stringify(localProfiles))
  return next
}

export function getLocalProfiles(): Profile[] {
  return safeParseJson<Profile[]>(localStorage.getItem(LOCAL_PROFILES_KEY), [])
}

export function upsertLocalProfile(profile: Profile): void {
  const localProfiles = getLocalProfiles()
  const idx = localProfiles.findIndex((p) => p.id === profile.id)
  if (idx >= 0) {
    localProfiles[idx] = { ...localProfiles[idx], ...profile }
  } else {
    localProfiles.push(profile)
  }
  localStorage.setItem(LOCAL_PROFILES_KEY, JSON.stringify(localProfiles))
}

export function updateProfileModerationStatus(
  id: string,
  patch: {
    is_approved?: boolean
    is_banned?: boolean
    is_verified?: boolean
    verification_status?: string
    verification_note?: string
  }
): void {
  const localProfiles = getLocalProfiles()
  const updatedLocal = localProfiles.map((p) => (p.id === id ? { ...p, ...patch } : p))
  localStorage.setItem(LOCAL_PROFILES_KEY, JSON.stringify(updatedLocal))

  const myProfiles = getMyProfiles()
  if (myProfiles.some((p) => p.id === id)) {
    const updatedMine = myProfiles.map((p) => (p.id === id ? { ...p, ...patch } : p))
    saveMyProfiles(updatedMine)
  }
}

export function removeProfilesByWhatsapp(rawWhatsapp: string): void {
  const cleanTarget = normalizePhone(rawWhatsapp)
  const rawTrimmed = rawWhatsapp.trim()

  const matchesPhone = (p: Profile) => {
    const cleanP = normalizePhone(p.whatsapp)
    return (cleanTarget && cleanP === cleanTarget) || p.whatsapp === rawTrimmed
  }

  const nextLocal = getLocalProfiles().filter((p) => !matchesPhone(p))
  localStorage.setItem(LOCAL_PROFILES_KEY, JSON.stringify(nextLocal))

  const nextMine = getMyProfiles().filter((p) => !matchesPhone(p))
  saveMyProfiles(nextMine)
}

export function isProfileEmailVerified(profile: Profile | null | undefined): boolean {
  return Boolean(profile && profile.email_verified === true)
}

export function isProfileIdentityVerified(profile: Profile | null | undefined): boolean {
  return Boolean(
    profile && (profile.is_verified === true || profile.verification_status === 'verified')
  )
}

export function getProfileVerificationStatus(
  profile: Profile | null | undefined
): 'verified' | 'pending' | 'rejected' | 'unverified' {
  if (!profile) return 'unverified'
  if (profile.is_verified === true || profile.verification_status === 'verified') {
    return 'verified'
  }
  if (profile.verification_status === 'pending') return 'pending'
  if (profile.verification_status === 'rejected') return 'rejected'
  return 'unverified'
}

export async function requestProfileVerification(
  profileId: string,
  selfieDataUrl: string
): Promise<{ ok: boolean; profile?: Profile; error?: string }> {
  try {
    const res = await fetch('/api/profiles/request-verification', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ profileId, selfieDataUrl }),
    })
    const json = (await res.json().catch(() => ({}))) as {
      ok?: boolean
      profile?: Profile
      error?: string
    }
    if (!res.ok || !json.ok || !json.profile) {
      return {
        ok: false,
        error: json.error || `Verification request failed (HTTP ${res.status})`,
      }
    }
    updateMyProfile(json.profile)
    upsertLocalProfile(json.profile)
    return { ok: true, profile: json.profile }
  } catch (err: unknown) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : 'Unable to submit verification selfie',
    }
  }
}

export function isProfileBoosted(profile: Profile | null | undefined): boolean {
  if (!profile?.boosted_until) return false
  const ms = Date.parse(profile.boosted_until)
  return Number.isFinite(ms) && ms > Date.now()
}

export function getBoostRemainingLabel(boostedUntil: string | null | undefined): string {
  if (!boostedUntil) return ''
  const ms = Date.parse(boostedUntil)
  if (!Number.isFinite(ms) || ms <= Date.now()) return ''
  const diffMinutes = Math.max(1, Math.ceil((ms - Date.now()) / 60000))
  const hours = Math.floor(diffMinutes / 60)
  const mins = diffMinutes % 60
  if (hours > 0 && mins > 0) return `${hours}h ${mins}m left`
  if (hours > 0) return `${hours}h left`
  return `${mins}m left`
}

export function sortProfilesBoostFirst(profiles: Profile[]): Profile[] {
  const now = Date.now()
  return [...profiles].sort((a, b) => {
    const aMs = a.boosted_until ? Date.parse(a.boosted_until) : 0
    const bMs = b.boosted_until ? Date.parse(b.boosted_until) : 0
    const aActive = Number.isFinite(aMs) && aMs > now
    const bActive = Number.isFinite(bMs) && bMs > now
    if (aActive && !bActive) return -1
    if (!aActive && bActive) return 1
    if (aActive && bActive && bMs !== aMs) return bMs - aMs
    return 0
  })
}

export interface BoostConfig {
  durationHours: number
  pointsCost: number
  dailyBonusPoints: number
  startingPoints: number
  priceZarCents: number
  currency: string
  gateways: {
    paystack: boolean
    stripe: boolean
    sandbox: boolean
  }
}

export interface BoostTransaction {
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

export interface BoostStatusResponse {
  ok: boolean
  boostedUntil: string | null
  isBoosted: boolean
  remainingSeconds: number
  boostPoints: number
  canClaimDailyBonus: boolean
  nextBonusAt: string | null
  transactions?: BoostTransaction[]
  pointsAdded?: number
  alreadyProcessed?: boolean
  error?: string
}

function applyBoostStateLocally(
  profileId: string,
  state: { boostedUntil?: string | null; boostPoints?: number }
): Profile | null {
  const mine = getMyProfiles().find((p) => p.id === profileId)
  const local = getLocalProfiles().find((p) => p.id === profileId)
  const base = mine || local
  if (!base) return null
  const updated: Profile = {
    ...base,
    boosted_until:
      state.boostedUntil !== undefined ? state.boostedUntil : base.boosted_until ?? null,
    boost_points:
      typeof state.boostPoints === 'number' ? state.boostPoints : base.boost_points ?? 100,
  }
  if (mine) {
    updateMyProfile(updated)
  } else {
    upsertLocalProfile(updated)
  }
  return updated
}

function buildOptionalProfileAuthHeaders(email?: string): Record<string, string> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  const token = (getVerifiedAuthToken(email) || '').trim()
  if (token) {
    headers.Authorization = `Bearer ${token}`
  }
  return headers
}

export async function fetchBoostConfig(): Promise<BoostConfig> {
  const fallback: BoostConfig = {
    durationHours: 24,
    pointsCost: 50,
    dailyBonusPoints: 25,
    startingPoints: 100,
    priceZarCents: 2900,
    currency: 'ZAR',
    gateways: { paystack: false, stripe: false, sandbox: true },
  }
  try {
    const res = await fetch('/api/boost/config')
    const json = (await res.json().catch(() => ({}))) as Partial<BoostConfig> & { ok?: boolean }
    if (!res.ok || !json.ok) return fallback
    return {
      durationHours: json.durationHours ?? fallback.durationHours,
      pointsCost: json.pointsCost ?? fallback.pointsCost,
      dailyBonusPoints: json.dailyBonusPoints ?? fallback.dailyBonusPoints,
      startingPoints: json.startingPoints ?? fallback.startingPoints,
      priceZarCents: json.priceZarCents ?? fallback.priceZarCents,
      currency: json.currency ?? fallback.currency,
      gateways: {
        paystack: Boolean(json.gateways?.paystack),
        stripe: Boolean(json.gateways?.stripe),
        sandbox: json.gateways?.sandbox !== false,
      },
    }
  } catch {
    return fallback
  }
}

export async function fetchBoostStatus(profileId: string): Promise<BoostStatusResponse> {
  try {
    const res = await fetch(`/api/boost/status?profileId=${encodeURIComponent(profileId)}`)
    const json = (await res.json().catch(() => ({}))) as Partial<BoostStatusResponse>
    if (!res.ok || !json.ok) {
      return {
        ok: false,
        boostedUntil: null,
        isBoosted: false,
        remainingSeconds: 0,
        boostPoints: 100,
        canClaimDailyBonus: false,
        nextBonusAt: null,
        error: json.error || 'Could not load boost status',
      }
    }
    applyBoostStateLocally(profileId, {
      boostedUntil: json.boostedUntil,
      boostPoints: json.boostPoints,
    })
    return {
      ok: true,
      boostedUntil: json.boostedUntil ?? null,
      isBoosted: Boolean(json.isBoosted),
      remainingSeconds: json.remainingSeconds ?? 0,
      boostPoints: typeof json.boostPoints === 'number' ? json.boostPoints : 100,
      canClaimDailyBonus: Boolean(json.canClaimDailyBonus),
      nextBonusAt: json.nextBonusAt ?? null,
      transactions: Array.isArray(json.transactions) ? json.transactions : [],
    }
  } catch (err: unknown) {
    return {
      ok: false,
      boostedUntil: null,
      isBoosted: false,
      remainingSeconds: 0,
      boostPoints: 100,
      canClaimDailyBonus: false,
      nextBonusAt: null,
      error: err instanceof Error ? err.message : 'Unable to load boost status',
    }
  }
}

export async function claimDailyBoostBonus(
  profileId: string,
  email?: string
): Promise<BoostStatusResponse> {
  try {
    const res = await fetch('/api/boost/claim-bonus', {
      method: 'POST',
      headers: buildOptionalProfileAuthHeaders(email),
      body: JSON.stringify({ profileId }),
    })
    const json = (await res.json().catch(() => ({}))) as Partial<BoostStatusResponse>
    if (!res.ok || !json.ok) {
      return {
        ok: false,
        boostedUntil: json.boostedUntil ?? null,
        isBoosted: Boolean(json.isBoosted),
        remainingSeconds: json.remainingSeconds ?? 0,
        boostPoints: typeof json.boostPoints === 'number' ? json.boostPoints : 0,
        canClaimDailyBonus: Boolean(json.canClaimDailyBonus),
        nextBonusAt: json.nextBonusAt ?? null,
        error: json.error || 'Unable to claim daily bonus points',
      }
    }
    applyBoostStateLocally(profileId, {
      boostedUntil: json.boostedUntil,
      boostPoints: json.boostPoints,
    })
    return {
      ok: true,
      boostedUntil: json.boostedUntil ?? null,
      isBoosted: Boolean(json.isBoosted),
      remainingSeconds: json.remainingSeconds ?? 0,
      boostPoints: typeof json.boostPoints === 'number' ? json.boostPoints : 100,
      canClaimDailyBonus: Boolean(json.canClaimDailyBonus),
      nextBonusAt: json.nextBonusAt ?? null,
      pointsAdded: json.pointsAdded,
    }
  } catch (err: unknown) {
    return {
      ok: false,
      boostedUntil: null,
      isBoosted: false,
      remainingSeconds: 0,
      boostPoints: 0,
      canClaimDailyBonus: false,
      nextBonusAt: null,
      error: err instanceof Error ? err.message : 'Unable to claim daily bonus',
    }
  }
}

export async function activateBoostWithPoints(
  profileId: string,
  email?: string
): Promise<BoostStatusResponse> {
  try {
    const res = await fetch('/api/boost/activate-points', {
      method: 'POST',
      headers: buildOptionalProfileAuthHeaders(email),
      body: JSON.stringify({ profileId }),
    })
    const json = (await res.json().catch(() => ({}))) as Partial<BoostStatusResponse>
    if (!res.ok || !json.ok) {
      return {
        ok: false,
        boostedUntil: json.boostedUntil ?? null,
        isBoosted: Boolean(json.isBoosted),
        remainingSeconds: json.remainingSeconds ?? 0,
        boostPoints: typeof json.boostPoints === 'number' ? json.boostPoints : 0,
        canClaimDailyBonus: Boolean(json.canClaimDailyBonus),
        nextBonusAt: json.nextBonusAt ?? null,
        error: json.error || 'Could not activate boost with points',
      }
    }
    applyBoostStateLocally(profileId, {
      boostedUntil: json.boostedUntil,
      boostPoints: json.boostPoints,
    })
    return {
      ok: true,
      boostedUntil: json.boostedUntil ?? null,
      isBoosted: Boolean(json.isBoosted),
      remainingSeconds: json.remainingSeconds ?? 0,
      boostPoints: typeof json.boostPoints === 'number' ? json.boostPoints : 0,
      canClaimDailyBonus: Boolean(json.canClaimDailyBonus),
      nextBonusAt: json.nextBonusAt ?? null,
    }
  } catch (err: unknown) {
    return {
      ok: false,
      boostedUntil: null,
      isBoosted: false,
      remainingSeconds: 0,
      boostPoints: 0,
      canClaimDailyBonus: false,
      nextBonusAt: null,
      error: err instanceof Error ? err.message : 'Could not activate boost with points',
    }
  }
}

export async function createBoostCheckout(params: {
  profileId: string
  gateway: 'stripe' | 'paystack' | 'sandbox'
  paymentMethod?: 'card' | 'eft' | 'snapscan'
  email?: string
}): Promise<{
  ok: boolean
  mode?: 'redirect' | 'sandbox'
  gateway?: 'stripe' | 'paystack' | 'sandbox'
  reference?: string
  checkoutToken?: string
  checkoutUrl?: string
  error?: string
}> {
  try {
    const res = await fetch('/api/boost/create-checkout', {
      method: 'POST',
      headers: buildOptionalProfileAuthHeaders(params.email),
      body: JSON.stringify({
        profileId: params.profileId,
        gateway: params.gateway,
        paymentMethod: params.paymentMethod || 'card',
        email: params.email || '',
      }),
    })
    const json = (await res.json().catch(() => ({}))) as {
      ok?: boolean
      mode?: 'redirect' | 'sandbox'
      gateway?: 'stripe' | 'paystack' | 'sandbox'
      reference?: string
      checkoutToken?: string
      checkoutUrl?: string
      error?: string
    }
    if (!res.ok || !json.ok) {
      return { ok: false, error: json.error || 'Could not initiate checkout' }
    }
    return {
      ok: true,
      mode: json.mode,
      gateway: json.gateway,
      reference: json.reference,
      checkoutToken: json.checkoutToken,
      checkoutUrl: json.checkoutUrl,
    }
  } catch (err: unknown) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : 'Unable to start payment checkout',
    }
  }
}

export async function confirmBoostCheckout(params: {
  profileId: string
  gateway: 'stripe' | 'paystack' | 'sandbox'
  reference: string
  checkoutToken?: string
}): Promise<BoostStatusResponse> {
  try {
    const res = await fetch('/api/boost/confirm-checkout', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
    })
    const json = (await res.json().catch(() => ({}))) as Partial<BoostStatusResponse>
    if (!res.ok || !json.ok) {
      return {
        ok: false,
        boostedUntil: json.boostedUntil ?? null,
        isBoosted: Boolean(json.isBoosted),
        remainingSeconds: json.remainingSeconds ?? 0,
        boostPoints: typeof json.boostPoints === 'number' ? json.boostPoints : 100,
        canClaimDailyBonus: Boolean(json.canClaimDailyBonus),
        nextBonusAt: json.nextBonusAt ?? null,
        error: json.error || 'Payment confirmation failed',
      }
    }
    applyBoostStateLocally(params.profileId, {
      boostedUntil: json.boostedUntil,
      boostPoints: json.boostPoints,
    })
    return {
      ok: true,
      boostedUntil: json.boostedUntil ?? null,
      isBoosted: Boolean(json.isBoosted),
      remainingSeconds: json.remainingSeconds ?? 0,
      boostPoints: typeof json.boostPoints === 'number' ? json.boostPoints : 100,
      canClaimDailyBonus: Boolean(json.canClaimDailyBonus),
      nextBonusAt: json.nextBonusAt ?? null,
      alreadyProcessed: Boolean(json.alreadyProcessed),
    }
  } catch (err: unknown) {
    return {
      ok: false,
      boostedUntil: null,
      isBoosted: false,
      remainingSeconds: 0,
      boostPoints: 100,
      canClaimDailyBonus: false,
      nextBonusAt: null,
      error: err instanceof Error ? err.message : 'Unable to verify payment',
    }
  }
}

export async function fetchApprovedProfiles(): Promise<Profile[]> {
  const localApproved = getLocalProfiles().filter((p) => p.is_approved && !p.is_banned)
  await hydrateSupabaseFromServerConfig()

  let remoteProfiles: Profile[] | null = null

  // Prefer server proxy first so server-side Boost sort/overlay is always included
  try {
    const res = await fetch('/api/profiles')
    const json = (await res.json().catch(() => ({}))) as {
      ok?: boolean
      profiles?: Profile[]
    }
    if (res.ok && json.ok && Array.isArray(json.profiles)) {
      remoteProfiles = json.profiles
    }
  } catch {
    // fall through to direct Supabase client
  }

  if (!remoteProfiles && hasDirectClientSupabase()) {
    try {
      let { data, error } = await supabase
        .from('profiles')
        .select(FULL_PUBLIC_PROFILE_COLUMNS)
        .eq('is_approved', true)
        .eq('is_banned', false)
        .order('created_at', { ascending: false })

      if (error && /boosted_until|pgrst204|column/i.test(error.message || '')) {
        const retryPublic = await supabase
          .from('profiles')
          .select(PUBLIC_PROFILE_COLUMNS)
          .eq('is_approved', true)
          .eq('is_banned', false)
          .order('created_at', { ascending: false })
        data = retryPublic.data as typeof data
        error = retryPublic.error
      }

      if (error && /is_verified|verification_status|pgrst204|column/i.test(error.message || '')) {
        const retryMid = await supabase
          .from('profiles')
          .select(MID_PUBLIC_PROFILE_COLUMNS)
          .eq('is_approved', true)
          .eq('is_banned', false)
          .order('created_at', { ascending: false })
        data = retryMid.data as typeof data
        error = retryMid.error
      }

      if (error && /email_verified|pgrst204|column/i.test(error.message || '')) {
        const retry = await supabase
          .from('profiles')
          .select(LEGACY_PUBLIC_PROFILE_COLUMNS)
          .eq('is_approved', true)
          .eq('is_banned', false)
          .order('created_at', { ascending: false })
        data = retry.data as typeof data
        error = retry.error
      }

      if (!error && data) {
        remoteProfiles = data as Profile[]
      }
    } catch {
      // fall back to local cache
    }
  }

  if (!remoteProfiles) {
    return sortProfilesBoostFirst(localApproved)
  }

  const map = new Map<string, Profile>()
  for (const p of remoteProfiles) {
    map.set(p.id, p)
    upsertLocalProfile(p)
  }
  for (const lp of localApproved) {
    if (!map.has(lp.id)) {
      map.set(lp.id, lp)
    }
  }

  return sortProfilesBoostFirst(Array.from(map.values()))
}

export async function syncMyProfilesStatus(): Promise<Profile[]> {
  const myProfiles = getMyProfiles()
  if (myProfiles.length === 0) return []

  await hydrateSupabaseFromServerConfig()

  const localMap = new Map(getLocalProfiles().map((p) => [p.id, p]))
  let synced = myProfiles.map((p) => {
    const localMatch = localMap.get(p.id)
    return localMatch ? { ...p, is_approved: localMatch.is_approved, is_banned: localMatch.is_banned } : p
  })

  const ids = synced.map((p) => p.id)
  let remoteRows: Profile[] | null = null

  try {
    const res = await fetch('/api/profiles/sync-status', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids }),
    })
    const json = (await res.json().catch(() => ({}))) as {
      ok?: boolean
      profiles?: Profile[]
    }
    if (res.ok && json.ok && Array.isArray(json.profiles) && json.profiles.length > 0) {
      remoteRows = json.profiles
    }
  } catch {
    // fall through to direct Supabase client
  }

  if (!remoteRows && hasDirectClientSupabase()) {
    try {
      const selfColumns = `${FULL_PUBLIC_PROFILE_COLUMNS}, boost_points, last_boosted_at, email, email_notifications, auth_user_id, verification_requested_at, verification_reviewed_at, verification_note`
      let { data, error } = await supabase
        .from('profiles')
        .select(selfColumns)
        .in('id', ids)

      if (
        error &&
        /boosted_until|boost_points|last_boosted_at|pgrst204|column/i.test(error.message || '')
      ) {
        const retryWithoutBoost = await supabase
          .from('profiles')
          .select(
            `${PUBLIC_PROFILE_COLUMNS}, email, email_notifications, auth_user_id, verification_requested_at, verification_reviewed_at, verification_note`
          )
          .in('id', ids)
        data = retryWithoutBoost.data as typeof data
        error = retryWithoutBoost.error
      }

      if (
        error &&
        /is_verified|verification_status|verification_requested_at|verification_reviewed_at|verification_note|pgrst204|column/i.test(
          error.message || ''
        )
      ) {
        const retryMid = await supabase
          .from('profiles')
          .select(`${MID_PUBLIC_PROFILE_COLUMNS}, email, email_notifications, auth_user_id`)
          .in('id', ids)
        data = retryMid.data as typeof data
        error = retryMid.error
      }

      if (error && /email_verified|auth_user_id|email|pgrst204|column/i.test(error.message || '')) {
        const retryLegacy = await supabase
          .from('profiles')
          .select(LEGACY_PUBLIC_PROFILE_COLUMNS)
          .in('id', ids)
        data = retryLegacy.data as typeof data
        error = retryLegacy.error
      }

      if (!error && data && data.length > 0) {
        remoteRows = data as Profile[]
      }
    } catch {
      // keep local status when Supabase is offline
    }
  }

  if (remoteRows) {
    const remoteMap = new Map(remoteRows.map((p) => [p.id, p]))
    synced = synced.map((p) => {
      const remote = remoteMap.get(p.id)
      return remote ? { ...p, ...remote } : p
    })
  }

  saveMyProfiles(synced)
  return synced
}

export async function restoreProfileByAuthToken(accessToken: string): Promise<{
  ok: boolean
  profile: Profile | null
  email?: string
  authUserId?: string
  error?: string
}> {
  const cleanToken = (accessToken || '').trim()
  if (!cleanToken) {
    return { ok: false, profile: null, error: 'Verification token is required.' }
  }

  try {
    const res = await fetch('/api/profiles/restore', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${cleanToken}`,
      },
    })
    const json = (await res.json().catch(() => ({}))) as {
      ok?: boolean
      profile?: Profile | null
      email?: string
      authUserId?: string
      error?: string
    }
    if (!res.ok || !json.ok) {
      return {
        ok: false,
        profile: null,
        error: json.error || 'Could not restore your profile right now.',
      }
    }
    if (json.profile) {
      addMyProfile(json.profile)
      setActiveProfileId(json.profile.id)
      upsertLocalProfile(json.profile)
      return { ok: true, profile: json.profile }
    }
    return {
      ok: true,
      profile: null,
      email: json.email,
      authUserId: json.authUserId,
    }
  } catch (err: unknown) {
    return {
      ok: false,
      profile: null,
      error: err instanceof Error ? err.message : 'Unable to restore profile right now.',
    }
  }
}

export async function deleteProfileOnSupabase(
  id: string
): Promise<{ ok: boolean; error?: string }> {
  if (!id) return { ok: false, error: 'Missing profile id' }
  await hydrateSupabaseFromServerConfig()

  if (hasDirectClientSupabase()) {
    try {
      const { error } = await supabase.from('profiles').delete().eq('id', id)
      if (!error) return { ok: true }
    } catch {
      // fall through to server proxy
    }
  }

  try {
    const res = await fetch('/api/profiles/delete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id }),
    })
    const json = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string }
    return { ok: Boolean(res.ok && json.ok), error: json.error }
  } catch (err: unknown) {
    return { ok: false, error: err instanceof Error ? err.message : 'Unable to delete profile' }
  }
}

export async function deleteProfilesByWhatsappOnSupabase(
  rawWhatsapp: string
): Promise<{ ok: boolean; error?: string }> {
  const cleanNum = normalizePhone(rawWhatsapp)
  const rawTrimmed = rawWhatsapp.trim()
  if (!cleanNum && !rawTrimmed) return { ok: false, error: 'WhatsApp number is required' }

  await hydrateSupabaseFromServerConfig()

  if (hasDirectClientSupabase()) {
    try {
      const [r1, r2] = await Promise.all([
        supabase.from('profiles').delete().eq('whatsapp', cleanNum),
        supabase.from('profiles').delete().eq('whatsapp', rawTrimmed),
      ])
      if (!r1.error && !r2.error) return { ok: true }
    } catch {
      // fall through to server proxy
    }
  }

  try {
    const res = await fetch('/api/profiles/delete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ whatsapp: rawTrimmed }),
    })
    const json = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string }
    return { ok: Boolean(res.ok && json.ok), error: json.error }
  } catch (err: unknown) {
    return { ok: false, error: err instanceof Error ? err.message : 'Unable to delete data' }
  }
}

// Private 1-on-1 message local fallback helpers
export function getPrivatePairKey(profileIdA: string, profileIdB: string): string {
  return [profileIdA, profileIdB].sort().join('::')
}

export function getLocalThreadMessages(profileIdA: string, profileIdB: string): PrivateMessage[] {
  if (!profileIdA || !profileIdB) return []
  const map = safeParseJson<Record<string, PrivateMessage[]>>(
    localStorage.getItem(PRIVATE_MESSAGES_KEY),
    {}
  )
  const key = getPrivatePairKey(profileIdA, profileIdB)
  const msgs = map[key] || []
  return [...msgs].sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime())
}

export function appendLocalThreadMessage(msg: PrivateMessage): void {
  const map = safeParseJson<Record<string, PrivateMessage[]>>(
    localStorage.getItem(PRIVATE_MESSAGES_KEY),
    {}
  )
  const key = getPrivatePairKey(msg.sender_id, msg.receiver_id)
  const existing = map[key] || []
  if (!existing.some((m) => m.id === msg.id)) {
    map[key] = [...existing, msg]
    localStorage.setItem(PRIVATE_MESSAGES_KEY, JSON.stringify(map))
  }
}

export function getAllLocalConversationsForProfile(activeProfileId: string): Record<string, PrivateMessage[]> {
  if (!activeProfileId) return {}
  const map = safeParseJson<Record<string, PrivateMessage[]>>(
    localStorage.getItem(PRIVATE_MESSAGES_KEY),
    {}
  )
  const result: Record<string, PrivateMessage[]> = {}
  for (const [key, msgs] of Object.entries(map)) {
    const parts = key.split('::')
    if (parts.length !== 2) continue
    const [a, b] = parts
    if (a === activeProfileId || b === activeProfileId) {
      const peerId = a === activeProfileId ? b : a
      result[peerId] = msgs
    }
  }
  return result
}

export function getLastSeenTimestamp(viewerProfileId: string, peerProfileId: string): number {
  const map = safeParseJson<Record<string, number>>(localStorage.getItem(CHAT_LAST_SEEN_KEY), {})
  return map[`${viewerProfileId}::${peerProfileId}`] || 0
}

export function markThreadAsSeen(viewerProfileId: string, peerProfileId: string): void {
  if (!viewerProfileId || !peerProfileId) return
  const map = safeParseJson<Record<string, number>>(localStorage.getItem(CHAT_LAST_SEEN_KEY), {})
  map[`${viewerProfileId}::${peerProfileId}`] = Date.now()
  localStorage.setItem(CHAT_LAST_SEEN_KEY, JSON.stringify(map))
}
