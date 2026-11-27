import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useMapsLibrary } from '@vis.gl/react-google-maps'
import { Profile } from '@/utils/profileStorage'
import {
  buildProfileLocationQuery,
  computeRouteMatrixViaProxy,
  geocodeAddressesViaProxy,
  GeocodedLocation,
  getGoogleMapsApiKey,
  LatLngPoint,
  RouteDistanceInfo,
} from '@/lib/googleMaps'

export interface OriginLocation {
  coords: LatLngPoint
  label: string
  mode: 'gps' | 'custom' | 'profile' | 'district'
}

const DEFAULT_DISTRICT_QUERY = 'Tzaneen, Limpopo, South Africa'

export function useLocationDistances(
  profiles: Profile[],
  activeProfile: Profile | null
) {
  const geometryLib = useMapsLibrary('geometry')
  const mapsEnabled = Boolean(getGoogleMapsApiKey())

  const [geocodedByQuery, setGeocodedByQuery] = useState<Record<string, GeocodedLocation>>({})
  const [gpsOrigin, setGpsOrigin] = useState<OriginLocation | null>(null)
  const [customOrigin, setCustomOriginState] = useState<OriginLocation | null>(null)
  const [distances, setDistances] = useState<Record<string, RouteDistanceInfo>>({})
  const [loadingDistances, setLoadingDistances] = useState(false)
  const [locatingGps, setLocatingGps] = useState(false)
  const [locationError, setLocationError] = useState('')

  const activeProfileQuery = useMemo(() => {
    if (!activeProfile) return ''
    return buildProfileLocationQuery(activeProfile.village, activeProfile.municipality)
  }, [activeProfile])

  // Collect all unique village/municipality queries across profiles + active origin fallback
  const uniqueQueries = useMemo(() => {
    const set: Record<string, true> = {}
    if (activeProfileQuery) {
      set[activeProfileQuery] = true
    } else {
      set[DEFAULT_DISTRICT_QUERY] = true
    }
    for (const p of profiles) {
      const q = buildProfileLocationQuery(p.village, p.municipality)
      if (q) set[q] = true
    }
    return Object.keys(set)
  }, [profiles, activeProfileQuery])

  const attemptedQueriesRef = useRef<Record<string, true>>({})

  // Geocode any uncached profile/origin queries via server Geocoding API proxy
  useEffect(() => {
    if (!mapsEnabled || uniqueQueries.length === 0) return
    const missing = uniqueQueries.filter(
      (q) => !geocodedByQuery[q] && !attemptedQueriesRef.current[q]
    )
    if (missing.length === 0) return

    for (const q of missing) {
      attemptedQueriesRef.current[q] = true
    }

    let cancelled = false
    geocodeAddressesViaProxy(missing).then(({ results, error }) => {
      if (cancelled) return
      if (error) {
        setLocationError((prev) => prev || error)
      }
      if (Object.keys(results).length > 0) {
        setGeocodedByQuery((prev) => ({ ...prev, ...results }))
      }
    })

    return () => {
      cancelled = true
    }
  }, [mapsEnabled, uniqueQueries, geocodedByQuery])

  // Resolve current origin location
  const origin: OriginLocation | null = useMemo(() => {
    if (gpsOrigin) return gpsOrigin
    if (customOrigin) return customOrigin
    if (activeProfileQuery && geocodedByQuery[activeProfileQuery]) {
      const geo = geocodedByQuery[activeProfileQuery]
      return {
        coords: { lat: geo.lat, lng: geo.lng },
        label: `${activeProfile?.village || ''}, ${activeProfile?.municipality || ''}`.replace(
          /^,\s*|,\s*$/g,
          ''
        ),
        mode: 'profile',
      }
    }
    if (geocodedByQuery[DEFAULT_DISTRICT_QUERY]) {
      const geo = geocodedByQuery[DEFAULT_DISTRICT_QUERY]
      return {
        coords: { lat: geo.lat, lng: geo.lng },
        label: 'Tzaneen, Mopani District',
        mode: 'district',
      }
    }
    return null
  }, [gpsOrigin, customOrigin, activeProfileQuery, activeProfile, geocodedByQuery])

  // Map each profile ID to its geocoded coordinates
  const profileCoords = useMemo(() => {
    const mapObj: Record<string, LatLngPoint> = {}
    for (const p of profiles) {
      const q = buildProfileLocationQuery(p.village, p.municipality)
      const geo = geocodedByQuery[q]
      if (geo) {
        mapObj[p.id] = { lat: geo.lat, lng: geo.lng }
      }
    }
    return mapObj
  }, [profiles, geocodedByQuery])

  // Compute road distances via Routes API computeRouteMatrix proxy, falling back to spherical geometry
  useEffect(() => {
    if (!mapsEnabled || !origin) return

    const destinations = profiles
      .filter((p) => Boolean(profileCoords[p.id]))
      .map((p) => ({
        id: p.id,
        lat: profileCoords[p.id].lat,
        lng: profileCoords[p.id].lng,
      }))

    if (destinations.length === 0) {
      setDistances({})
      return
    }

    let cancelled = false
    setLoadingDistances(true)

    const applySphericalFallback = (existing: Record<string, RouteDistanceInfo>) => {
      if (!geometryLib) return existing
      const next = { ...existing }
      for (const dest of destinations) {
        if (!next[dest.id]) {
          const meters = geometryLib.spherical.computeDistanceBetween(
            origin.coords,
            { lat: dest.lat, lng: dest.lng }
          )
          next[dest.id] = {
            distanceMeters: Math.round(meters),
            source: 'spherical',
          }
        }
      }
      return next
    }

    computeRouteMatrixViaProxy(origin.coords, destinations).then(({ distances: matrixDistances }) => {
      if (cancelled) return
      const enriched = applySphericalFallback(matrixDistances)
      setDistances(enriched)
      setLoadingDistances(false)
    })

    return () => {
      cancelled = true
    }
  }, [mapsEnabled, origin, profiles, profileCoords, geometryLib])

  const requestGpsLocation = useCallback(() => {
    setLocationError('')
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      setLocationError('GPS geolocation is not supported on this browser.')
      return
    }
    setLocatingGps(true)
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLocatingGps(false)
        setCustomOriginState(null)
        setGpsOrigin({
          coords: { lat: pos.coords.latitude, lng: pos.coords.longitude },
          label: 'Your Live GPS Location',
          mode: 'gps',
        })
      },
      (err) => {
        setLocatingGps(false)
        if (err.code === err.PERMISSION_DENIED) {
          setLocationError('Location permission was denied. You can search a town below instead.')
        } else {
          setLocationError('Could not detect your GPS location. Please search a town instead.')
        }
      },
      { enableHighAccuracy: false, timeout: 10000, maximumAge: 120000 }
    )
  }, [])

  const setCustomOrigin = useCallback((coords: LatLngPoint, label: string) => {
    setLocationError('')
    setGpsOrigin(null)
    setCustomOriginState({
      coords,
      label,
      mode: 'custom',
    })
  }, [])

  const clearOriginOverride = useCallback(() => {
    setLocationError('')
    setGpsOrigin(null)
    setCustomOriginState(null)
  }, [])

  const updateSingleProfileDistance = useCallback(
    (profileId: string, info: RouteDistanceInfo) => {
      setDistances((prev) => ({
        ...prev,
        [profileId]: info,
      }))
    },
    []
  )

  return {
    mapsEnabled,
    origin,
    profileCoords,
    distances,
    loadingDistances,
    locatingGps,
    locationError,
    requestGpsLocation,
    setCustomOrigin,
    clearOriginOverride,
    updateSingleProfileDistance,
  }
}
