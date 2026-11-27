import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  AdvancedMarker,
  InfoWindow,
  Map as GoogleMap,
  Pin,
  useAdvancedMarkerRef,
  useMap,
  useMapsLibrary,
} from '@vis.gl/react-google-maps'
import {
  Compass,
  LocateFixed,
  Map as MapIcon,
  MapPin,
  MessageCircle,
  Navigation,
  Route as RouteIcon,
  Search,
  X,
} from 'lucide-react'
import { Profile } from '@/utils/profileStorage'
import { ProfileAvatar } from '@/components/ProfileAvatar'
import { OriginLocation } from '@/hooks/useLocationDistances'
import {
  formatDistanceKm,
  formatTravelDuration,
  isGmpQuotaError,
  LatLngPoint,
  RouteDistanceInfo,
  triggerGmpQuotaExceeded,
} from '@/lib/googleMaps'

interface DistanceMapPanelProps {
  mapsEnabled: boolean
  profiles: Profile[]
  origin: OriginLocation | null
  profileCoords: Record<string, LatLngPoint>
  distances: Record<string, RouteDistanceInfo>
  loadingDistances: boolean
  locatingGps: boolean
  locationError: string
  maxDistanceKm: number | null
  sortByDistance: boolean
  focusedProfileId: string | null
  onMaxDistanceChange: (km: number | null) => void
  onSortByDistanceChange: (sort: boolean) => void
  onRequestGps: () => void
  onSelectCustomOrigin: (coords: LatLngPoint, label: string) => void
  onClearOriginOverride: () => void
  onFocusHandled: () => void
  onRouteComputed: (profileId: string, info: RouteDistanceInfo) => void
  onStartChat: (profileId: string) => void
}

interface PlaceSuggestionItem {
  id: string
  mainText: string
  secondaryText: string
  prediction: google.maps.places.PlacePrediction
}

interface ActiveRouteSummary {
  profileId: string
  profileName: string
  distanceMeters: number
  durationSeconds?: number
}

function getSpreadPosition(
  base: LatLngPoint,
  indexInSameSpot: number,
  totalInSameSpot: number
): LatLngPoint {
  if (totalInSameSpot <= 1) return base
  const angle = (indexInSameSpot / totalInSameSpot) * 2 * Math.PI
  const radius = 0.0025
  return {
    lat: base.lat + Math.sin(angle) * radius,
    lng: base.lng + Math.cos(angle) * radius,
  }
}

function MapViewportController({
  origin,
  focusedCoords,
}: {
  origin: OriginLocation | null
  focusedCoords: LatLngPoint | null
}) {
  const map = useMap()

  useEffect(() => {
    if (!map) return
    if (focusedCoords) {
      map.panTo(focusedCoords)
      if ((map.getZoom() || 9) < 11) {
        map.setZoom(11)
      }
    } else if (origin) {
      map.panTo(origin.coords)
    }
  }, [map, origin, focusedCoords])

  return null
}

function RouteOverlayController({
  origin,
  destination,
  profileId,
  profileName,
  onRouteReady,
  onRouteError,
}: {
  origin: LatLngPoint
  destination: LatLngPoint
  profileId: string
  profileName: string
  onRouteReady: (summary: ActiveRouteSummary) => void
  onRouteError: (msg: string) => void
}) {
  const map = useMap()
  const routesLib = useMapsLibrary('routes')
  const polylinesRef = useRef<google.maps.Polyline[]>([])

  useEffect(() => {
    if (!map || !routesLib) return
    let cancelled = false

    for (const line of polylinesRef.current) {
      line.setMap(null)
    }
    polylinesRef.current = []

    routesLib.Route.computeRoutes({
      origin,
      destination,
      travelMode: 'DRIVING',
      fields: ['distanceMeters', 'durationMillis', 'path', 'viewport'],
      internalUsageAttributionIds: ['gmp_mcp_codeassist_v1_aistudio'],
    })
      .then((response) => {
        if (cancelled) return
        const route = response.routes?.[0]
        if (!route) {
          onRouteError('No driving route found between these locations.')
          return
        }

        const created = route.createPolylines({
          polylineOptions: {
            map,
            strokeColor: '#be123c',
            strokeOpacity: 0.9,
            strokeWeight: 5,
          },
        })
        polylinesRef.current = created

        if (route.viewport) {
          map.fitBounds(route.viewport, 48)
        }

        const durationSeconds =
          typeof route.durationMillis === 'number' && Number.isFinite(route.durationMillis)
            ? Math.round(route.durationMillis / 1000)
            : undefined

        onRouteReady({
          profileId,
          profileName,
          distanceMeters: route.distanceMeters || 0,
          durationSeconds,
        })
      })
      .catch((err: unknown) => {
        if (cancelled) return
        if (isGmpQuotaError(err)) {
          triggerGmpQuotaExceeded()
        }
        onRouteError('Unable to compute driving route right now.')
      })

    return () => {
      cancelled = true
      for (const line of polylinesRef.current) {
        line.setMap(null)
      }
      polylinesRef.current = []
    }
  }, [map, routesLib, origin, destination, profileId, profileName, onRouteReady, onRouteError])

  return null
}

function ProfileMarkerItem({
  profile,
  position,
  distanceInfo,
  isSelected,
  onSelect,
  onCloseInfo,
  onShowRoute,
  onStartChat,
}: {
  profile: Profile
  position: LatLngPoint
  distanceInfo?: RouteDistanceInfo
  isSelected: boolean
  onSelect: () => void
  onCloseInfo: () => void
  onShowRoute: () => void
  onStartChat: () => void
}) {
  const [markerRef, marker] = useAdvancedMarkerRef()

  return (
    <>
      <AdvancedMarker
        ref={markerRef}
        position={position}
        title={`${profile.full_name}, ${profile.age} (${profile.village})`}
        onClick={onSelect}
      >
        <Pin
          background={isSelected ? '#d97706' : '#be123c'}
          borderColor={isSelected ? '#78350f' : '#881337'}
          glyphColor="#ffffff"
          scale={isSelected ? 1.2 : 1.0}
        />
      </AdvancedMarker>

      {isSelected && marker && (
        <InfoWindow anchor={marker} maxWidth={260} onCloseClick={onCloseInfo}>
          <div className="p-1 space-y-2.5 text-gray-800 min-w-[210px]">
            <div className="flex items-center gap-2.5">
              <ProfileAvatar
                src={profile.photo_url}
                name={profile.full_name}
                className="w-11 h-11 rounded-full shrink-0 border border-rose-200"
                textSizeClass="text-xs"
              />
              <div className="min-w-0">
                <div className="font-bold text-sm text-gray-900 truncate">
                  {profile.full_name}, {profile.age}
                </div>
                <div className="text-[11px] text-rose-700 font-medium truncate">
                  {profile.village}, {profile.municipality}
                </div>
              </div>
            </div>

            {distanceInfo && (
              <div className="bg-rose-50 text-rose-900 rounded-lg px-2.5 py-1.5 text-xs font-semibold flex items-center gap-1.5">
                <Compass className="w-3.5 h-3.5 text-rose-700 shrink-0" />
                <span>
                  {formatDistanceKm(distanceInfo.distanceMeters)}
                  {distanceInfo.durationSeconds
                    ? ` • ${formatTravelDuration(distanceInfo.durationSeconds)}`
                    : ' (approx.)'}
                </span>
              </div>
            )}

            <div className="flex gap-1.5 pt-0.5">
              <button
                type="button"
                onClick={onShowRoute}
                className="flex-1 bg-amber-500 hover:bg-amber-600 text-gray-900 font-bold text-[11px] py-1.5 px-2 rounded-lg flex items-center justify-center gap-1"
              >
                <RouteIcon className="w-3 h-3" /> Route
              </button>
              <button
                type="button"
                onClick={onStartChat}
                className="flex-1 bg-rose-700 hover:bg-rose-800 text-white font-bold text-[11px] py-1.5 px-2 rounded-lg flex items-center justify-center gap-1"
              >
                <MessageCircle className="w-3 h-3" /> Chat
              </button>
            </div>
          </div>
        </InfoWindow>
      )}
    </>
  )
}

export function DistanceMapPanel({
  mapsEnabled,
  profiles,
  origin,
  profileCoords,
  distances,
  loadingDistances,
  locatingGps,
  locationError,
  maxDistanceKm,
  sortByDistance,
  focusedProfileId,
  onMaxDistanceChange,
  onSortByDistanceChange,
  onRequestGps,
  onSelectCustomOrigin,
  onClearOriginOverride,
  onFocusHandled,
  onRouteComputed,
  onStartChat,
}: DistanceMapPanelProps) {
  const placesLib = useMapsLibrary('places')

  const [showMap, setShowMap] = useState(true)
  const [selectedProfileId, setSelectedProfileId] = useState<string | null>(null)
  const [routeTarget, setRouteTarget] = useState<{
    profileId: string
    profileName: string
    destination: LatLngPoint
  } | null>(null)
  const [routeSummary, setRouteSummary] = useState<ActiveRouteSummary | null>(null)
  const [routeError, setRouteError] = useState('')

  // Places Autocomplete state (modern AutocompleteSuggestion + sessionToken)
  const [placeInput, setPlaceInput] = useState('')
  const [suggestions, setSuggestions] = useState<PlaceSuggestionItem[]>([])
  const [searchingPlaces, setSearchingPlaces] = useState(false)
  const sessionTokenRef = useRef<google.maps.places.AutocompleteSessionToken | null>(null)

  useEffect(() => {
    if (!focusedProfileId) return
    setShowMap(true)
    setSelectedProfileId(focusedProfileId)
    const coords = profileCoords[focusedProfileId]
    const targetProfile = profiles.find((p) => p.id === focusedProfileId)
    if (coords && targetProfile && origin) {
      setRouteError('')
      setRouteTarget({
        profileId: targetProfile.id,
        profileName: targetProfile.full_name,
        destination: coords,
      })
    }
    onFocusHandled()
  }, [focusedProfileId, profileCoords, profiles, origin, onFocusHandled])

  // Fetch Places autocomplete suggestions cleanly using session tokens
  useEffect(() => {
    if (!placesLib || !placeInput.trim() || placeInput.trim().length < 2) {
      setSuggestions([])
      return
    }

    const timer = setTimeout(async () => {
      setSearchingPlaces(true)
      try {
        if (!sessionTokenRef.current) {
          sessionTokenRef.current = new placesLib.AutocompleteSessionToken()
        }
        const { suggestions: raw } =
          await placesLib.AutocompleteSuggestion.fetchAutocompleteSuggestions({
            input: placeInput.trim(),
            includedRegionCodes: ['za'],
            region: 'za',
            sessionToken: sessionTokenRef.current,
          })

        const items: PlaceSuggestionItem[] = []
        for (const item of raw || []) {
          const pred = item.placePrediction
          if (!pred) continue
          items.push({
            id: pred.placeId,
            mainText: pred.mainText?.text || pred.text?.text || '',
            secondaryText: pred.secondaryText?.text || '',
            prediction: pred,
          })
        }
        setSuggestions(items.slice(0, 5))
      } catch (err: unknown) {
        if (isGmpQuotaError(err)) {
          triggerGmpQuotaExceeded()
        }
        setSuggestions([])
      } finally {
        setSearchingPlaces(false)
      }
    }, 280)

    return () => clearTimeout(timer)
  }, [placesLib, placeInput])

  const handlePickSuggestion = async (item: PlaceSuggestionItem) => {
    try {
      const place = item.prediction.toPlace()
      await place.fetchFields({
        fields: ['location', 'formattedAddress', 'displayName'],
      })
      sessionTokenRef.current = null
      if (place.location) {
        onSelectCustomOrigin(
          { lat: place.location.lat(), lng: place.location.lng() },
          item.mainText || place.displayName || place.formattedAddress || 'Selected Location'
        )
        setPlaceInput('')
        setSuggestions([])
        setRouteTarget(null)
        setRouteSummary(null)
      }
    } catch (err: unknown) {
      if (isGmpQuotaError(err)) {
        triggerGmpQuotaExceeded()
      }
    }
  }

  // Spread overlapping pins cleanly when multiple singles share a village coordinate
  const markerPositions = useMemo(() => {
    const groups: Record<string, string[]> = {}
    for (const p of profiles) {
      const c = profileCoords[p.id]
      if (!c) continue
      const key = `${c.lat.toFixed(4)},${c.lng.toFixed(4)}`
      if (!groups[key]) groups[key] = []
      groups[key].push(p.id)
    }

    const result: Record<string, LatLngPoint> = {}
    for (const p of profiles) {
      const c = profileCoords[p.id]
      if (!c) continue
      const key = `${c.lat.toFixed(4)},${c.lng.toFixed(4)}`
      const list = groups[key] || [p.id]
      const idx = list.indexOf(p.id)
      result[p.id] = getSpreadPosition(c, idx, list.length)
    }
    return result
  }, [profiles, profileCoords])

  const handleRouteReady = useCallback(
    (summary: ActiveRouteSummary) => {
      setRouteSummary(summary)
      setRouteError('')
      onRouteComputed(summary.profileId, {
        distanceMeters: summary.distanceMeters,
        durationSeconds: summary.durationSeconds,
        source: 'routes_api',
      })
    },
    [onRouteComputed]
  )

  const handleRouteError = useCallback((msg: string) => {
    setRouteError(msg)
  }, [])

  if (!mapsEnabled) {
    return null
  }

  const focusedCoords = selectedProfileId ? profileCoords[selectedProfileId] || null : null

  return (
    <div className="bg-white rounded-2xl p-5 shadow-md border border-rose-100 mb-8 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-bold text-gray-900 flex items-center gap-2">
            <Compass className="w-4 h-4 text-rose-600" /> Discover Distance with Google Maps
          </h2>
          <p className="text-xs text-gray-500 mt-0.5">
            {origin ? (
              <>
                Measuring road distances from{' '}
                <strong className="text-gray-800">{origin.label}</strong>
                {loadingDistances ? ' • calculating...' : ''}
              </>
            ) : (
              'Resolving Mopani District locations...'
            )}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={onRequestGps}
            disabled={locatingGps}
            className="bg-rose-700 hover:bg-rose-800 disabled:opacity-60 text-white text-xs font-semibold px-3.5 py-2 rounded-xl shadow-xs transition flex items-center gap-1.5"
          >
            <LocateFixed className="w-3.5 h-3.5" />
            {locatingGps ? 'Locating...' : 'Use My GPS'}
          </button>

          {origin && (origin.mode === 'gps' || origin.mode === 'custom') && (
            <button
              type="button"
              onClick={() => {
                onClearOriginOverride()
                setRouteTarget(null)
                setRouteSummary(null)
              }}
              className="bg-gray-100 hover:bg-gray-200 text-gray-700 text-xs font-semibold px-3 py-2 rounded-xl transition flex items-center gap-1"
            >
              <X className="w-3.5 h-3.5" /> Clear Location
            </button>
          )}

          <button
            type="button"
            onClick={() => setShowMap((prev) => !prev)}
            className="bg-amber-50 hover:bg-amber-100 text-amber-900 border border-amber-200 text-xs font-semibold px-3.5 py-2 rounded-xl transition flex items-center gap-1.5"
          >
            <MapIcon className="w-3.5 h-3.5" />
            {showMap ? 'Hide Map' : 'Show Google Map'}
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <div className="relative">
          <Search className="absolute left-3 top-3 w-4 h-4 text-gray-400" />
          <input
            type="text"
            placeholder="Set starting town in South Africa..."
            value={placeInput}
            onChange={(e) => setPlaceInput(e.target.value)}
            className="w-full pl-9 pr-3 py-2 bg-gray-50 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-rose-500"
          />
          {(suggestions.length > 0 || searchingPlaces) && (
            <div className="absolute left-0 right-0 top-full mt-1 bg-white border border-gray-200 rounded-xl shadow-lg z-30 overflow-hidden">
              {searchingPlaces && suggestions.length === 0 ? (
                <div className="px-3 py-2 text-xs text-gray-500">Searching South Africa...</div>
              ) : (
                suggestions.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => handlePickSuggestion(item)}
                    className="w-full text-left px-3 py-2 hover:bg-rose-50 transition border-b last:border-b-0 border-gray-100"
                  >
                    <div className="text-xs font-semibold text-gray-900">{item.mainText}</div>
                    {item.secondaryText && (
                      <div className="text-[11px] text-gray-500">{item.secondaryText}</div>
                    )}
                  </button>
                ))
              )}
            </div>
          )}
        </div>

        <select
          value={maxDistanceKm === null ? '' : String(maxDistanceKm)}
          onChange={(e) =>
            onMaxDistanceChange(e.target.value ? Number(e.target.value) : null)
          }
          className="w-full py-2 px-3 bg-gray-50 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-rose-500"
        >
          <option value="">Any Distance</option>
          <option value="15">Within 15 km</option>
          <option value="30">Within 30 km</option>
          <option value="50">Within 50 km</option>
          <option value="100">Within 100 km</option>
          <option value="150">Within 150 km</option>
        </select>

        <label className="flex items-center gap-2.5 px-3 py-2 bg-gray-50 border border-gray-200 rounded-xl text-sm text-gray-700 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={sortByDistance}
            onChange={(e) => onSortByDistanceChange(e.target.checked)}
            className="w-4 h-4 accent-rose-600 rounded"
          />
          <Navigation className="w-3.5 h-3.5 text-rose-600" />
          <span className="text-xs font-semibold">Sort Nearest Singles First</span>
        </label>
      </div>

      {locationError && (
        <div className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2">
          {locationError}
        </div>
      )}

      {routeSummary && (
        <div className="bg-rose-50 border border-rose-200 rounded-xl px-4 py-2.5 flex flex-wrap items-center justify-between gap-2 text-xs">
          <div className="flex items-center gap-2 text-rose-900 font-semibold">
            <RouteIcon className="w-4 h-4 text-rose-700" />
            <span>
              Driving route to <strong>{routeSummary.profileName}</strong>:{' '}
              {formatDistanceKm(routeSummary.distanceMeters)}
              {routeSummary.durationSeconds
                ? ` (${formatTravelDuration(routeSummary.durationSeconds)})`
                : ''}
            </span>
          </div>
          <button
            type="button"
            onClick={() => {
              setRouteTarget(null)
              setRouteSummary(null)
            }}
            className="text-rose-700 hover:underline font-semibold"
          >
            Clear Route
          </button>
        </div>
      )}

      {routeError && (
        <div className="text-xs text-red-700 bg-red-50 border border-red-200 rounded-xl px-3 py-2">
          {routeError}
        </div>
      )}

      {showMap && origin && (
        <div className="w-full h-[380px] sm:h-[420px] rounded-2xl overflow-hidden border border-rose-200 shadow-inner bg-gray-100">
          <GoogleMap
            mapId="DEMO_MAP_ID"
            defaultCenter={origin.coords}
            defaultZoom={9}
            gestureHandling="greedy"
            internalUsageAttributionIds={['gmp_mcp_codeassist_v1_aistudio']}
            style={{ width: '100%', height: '100%' }}
          >
            <MapViewportController origin={origin} focusedCoords={focusedCoords} />

            <AdvancedMarker position={origin.coords} title={origin.label}>
              <Pin background="#f59e0b" borderColor="#92400e" glyphColor="#111827" scale={1.15} />
            </AdvancedMarker>

            {profiles.map((p) => {
              const pos = markerPositions[p.id]
              if (!pos) return null
              return (
                <ProfileMarkerItem
                  key={p.id}
                  profile={p}
                  position={pos}
                  distanceInfo={distances[p.id]}
                  isSelected={selectedProfileId === p.id}
                  onSelect={() => setSelectedProfileId(p.id)}
                  onCloseInfo={() => setSelectedProfileId(null)}
                  onShowRoute={() => {
                    const exactDest = profileCoords[p.id]
                    if (!exactDest) return
                    setRouteError('')
                    setRouteTarget({
                      profileId: p.id,
                      profileName: p.full_name,
                      destination: exactDest,
                    })
                  }}
                  onStartChat={() => onStartChat(p.id)}
                />
              )
            })}

            {routeTarget && (
              <RouteOverlayController
                origin={origin.coords}
                destination={routeTarget.destination}
                profileId={routeTarget.profileId}
                profileName={routeTarget.profileName}
                onRouteReady={handleRouteReady}
                onRouteError={handleRouteError}
              />
            )}
          </GoogleMap>
        </div>
      )}

      <p className="text-[11px] text-gray-400 flex items-center gap-1.5">
        <MapPin className="w-3 h-3 shrink-0" />
        Distances are calculated between Mopani towns/villages (or your optional GPS point, which stays in your current session and can be cleared anytime).
      </p>
    </div>
  )
}
