export interface LatLngPoint {
  lat: number
  lng: number
}

export interface GeocodedLocation {
  lat: number
  lng: number
  formattedAddress: string
}

export interface RouteDistanceInfo {
  distanceMeters: number
  durationSeconds?: number
  source: 'routes_api' | 'spherical'
}

let runtimeGoogleMapsApiKey = (
  (import.meta.env.VITE_GOOGLE_MAPS_API_KEY as string | undefined) || ''
).trim()

export function getGoogleMapsApiKey(): string {
  return runtimeGoogleMapsApiKey
}

export async function hydrateGoogleMapsConfig(): Promise<void> {
  if (runtimeGoogleMapsApiKey) return
  try {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 1800)
    const res = await fetch('/api/maps/config', { signal: controller.signal })
    clearTimeout(timeout)
    if (!res.ok) return
    const data = (await res.json()) as { apiKey?: string }
    if (typeof data.apiKey === 'string' && data.apiKey.trim()) {
      runtimeGoogleMapsApiKey = data.apiKey.trim()
    }
  } catch {
    // non-fatal; map features stay disabled gracefully if unavailable
  }
}

export function triggerGmpQuotaExceeded(): void {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('gmp-quota-exceeded'))
  }
}

export function isGmpQuotaError(err: unknown): boolean {
  const msg =
    err instanceof Error
      ? err.message
      : typeof err === 'string'
      ? err
      : JSON.stringify(err || '')
  return (
    msg.includes('RESOURCE_EXHAUSTED') ||
    msg.includes('OVER_QUERY_LIMIT') ||
    msg.includes('OverQuotaMapError') ||
    msg.includes('QuotaExceededError') ||
    msg.includes('429')
  )
}

export function formatDistanceKm(meters: number): string {
  if (!Number.isFinite(meters) || meters < 0) return ''
  if (meters < 1000) {
    return `${Math.round(meters)} m`
  }
  const km = meters / 1000
  return km < 10 ? `${km.toFixed(1)} km` : `${Math.round(km)} km`
}

export function formatTravelDuration(seconds?: number): string {
  if (!seconds || !Number.isFinite(seconds) || seconds <= 0) return ''
  const mins = Math.round(seconds / 60)
  if (mins < 60) return `${Math.max(1, mins)} min drive`
  const hrs = Math.floor(mins / 60)
  const remMins = mins % 60
  return remMins > 0 ? `${hrs}h ${remMins}m drive` : `${hrs}h drive`
}

export function buildProfileLocationQuery(village?: string, municipality?: string): string {
  return [village, municipality, 'Limpopo', 'South Africa']
    .map((part) => (part || '').trim())
    .filter(Boolean)
    .join(', ')
}

export async function geocodeAddressesViaProxy(
  addresses: string[]
): Promise<{ results: Record<string, GeocodedLocation>; error?: string }> {
  if (addresses.length === 0) return { results: {} }
  try {
    const res = await fetch('/api/maps/geocode', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ addresses }),
    })
    const data = (await res.json().catch(() => ({}))) as {
      ok?: boolean
      quotaExceeded?: boolean
      results?: Record<string, GeocodedLocation>
      error?: string
    }
    if (res.status === 429 || data.quotaExceeded) {
      triggerGmpQuotaExceeded()
      return { results: {}, error: data.error || 'Quota exceeded' }
    }
    if (!res.ok || !data.ok) {
      return { results: {}, error: data.error || 'Unable to geocode locations' }
    }
    return { results: data.results || {} }
  } catch (err: unknown) {
    return {
      results: {},
      error: err instanceof Error ? err.message : 'Network error geocoding locations',
    }
  }
}

export async function computeRouteMatrixViaProxy(
  origin: LatLngPoint,
  destinations: Array<{ id: string; lat: number; lng: number }>
): Promise<{ distances: Record<string, RouteDistanceInfo>; error?: string }> {
  if (destinations.length === 0) return { distances: {} }
  try {
    const res = await fetch('/api/maps/distance-matrix', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ origin, destinations, travelMode: 'DRIVE' }),
    })
    const data = (await res.json().catch(() => ({}))) as {
      ok?: boolean
      quotaExceeded?: boolean
      distances?: Record<
        string,
        { distanceMeters: number; durationSeconds: number; condition: string }
      >
      error?: string
    }
    if (res.status === 429 || data.quotaExceeded) {
      triggerGmpQuotaExceeded()
      return { distances: {}, error: data.error || 'Quota exceeded' }
    }
    if (!res.ok || !data.ok || !data.distances) {
      return { distances: {}, error: data.error || 'Unable to calculate road distances' }
    }
    const mapped: Record<string, RouteDistanceInfo> = {}
    for (const [id, info] of Object.entries(data.distances)) {
      mapped[id] = {
        distanceMeters: info.distanceMeters,
        durationSeconds: info.durationSeconds,
        source: 'routes_api',
      }
    }
    return { distances: mapped }
  } catch (err: unknown) {
    return {
      distances: {},
      error: err instanceof Error ? err.message : 'Network error computing route matrix',
    }
  }
}
