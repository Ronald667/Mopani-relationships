import { supabase } from '@/lib/supabase'

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
  photo_url: string
  is_verified?: boolean
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
    photo_url: profile.photo_url,
    is_approved: profile.is_approved ?? true,
    is_banned: profile.is_banned ?? false,
    created_at: profile.created_at || new Date().toISOString(),
  }
}

export async function saveProfileToSupabase(profile: Profile): Promise<{
  profile: Profile
  syncedToSupabase: boolean
  error?: string
}> {
  const payload = toSupabaseProfilePayload(profile)
  try {
    const { data, error } = await supabase
      .from('profiles')
      .upsert([payload], { onConflict: 'id' })
      .select()
      .single()

    if (error) {
      return { profile, syncedToSupabase: false, error: error.message }
    }
    return {
      profile: (data as Profile) || profile,
      syncedToSupabase: true,
    }
  } catch (err: any) {
    return {
      profile,
      syncedToSupabase: false,
      error: err?.message || 'Unable to sync profile to Supabase',
    }
  }
}

export async function fetchProfileById(id: string): Promise<Profile | null> {
  if (!id) return null
  try {
    const { data, error } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', id)
      .maybeSingle()

    if (!error && data) {
      const remote = data as Profile
      upsertLocalProfile(remote)
      return remote
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
  const existing = getMyProfiles().filter((p) => p.id !== profile.id)
  const next = [...existing, profile]
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

export function updateProfileModerationStatus(id: string, patch: { is_approved?: boolean; is_banned?: boolean }): void {
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

export async function fetchApprovedProfiles(): Promise<Profile[]> {
  const localApproved = getLocalProfiles().filter((p) => p.is_approved && !p.is_banned)

  try {
    const { data, error } = await supabase
      .from('profiles')
      .select('*')
      .eq('is_approved', true)
      .eq('is_banned', false)
      .order('created_at', { ascending: false })

    if (error || !data) {
      return localApproved
    }

    const remoteProfiles = data as Profile[]
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

    return Array.from(map.values())
  } catch {
    return localApproved
  }
}

export async function syncMyProfilesStatus(): Promise<Profile[]> {
  const myProfiles = getMyProfiles()
  if (myProfiles.length === 0) return []

  const localMap = new Map(getLocalProfiles().map((p) => [p.id, p]))
  let synced = myProfiles.map((p) => {
    const localMatch = localMap.get(p.id)
    return localMatch ? { ...p, is_approved: localMatch.is_approved, is_banned: localMatch.is_banned } : p
  })

  try {
    const ids = synced.map((p) => p.id)
    const { data, error } = await supabase
      .from('profiles')
      .select('*')
      .in('id', ids)

    if (!error && data && data.length > 0) {
      const remoteMap = new Map((data as Profile[]).map((p) => [p.id, p]))
      synced = synced.map((p) => {
        const remote = remoteMap.get(p.id)
        return remote ? { ...p, ...remote } : p
      })
    }
  } catch {
    // keep local status when Supabase is offline
  }

  saveMyProfiles(synced)
  return synced
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
