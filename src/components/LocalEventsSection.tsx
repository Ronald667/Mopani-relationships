import { useCallback, useEffect, useState } from 'react'
import { CalendarDays, Clock, MapPin, RefreshCw, Sparkles } from 'lucide-react'
import { hasDirectClientSupabase, supabase } from '@/lib/supabase'

export interface LocalEvent {
  id: string
  title: string
  municipality: string
  venue: string
  event_date: string
  description: string
  category: string
  host_name: string
  is_published: boolean
  created_at?: string
}

const MUNICIPALITY_FILTERS = [
  'All Mopani',
  'Greater Tzaneen',
  'Maruleng',
  'Ba-Phalaborwa',
  'Greater Letaba',
  'Greater Giyani',
] as const

function formatEventDateParts(isoDate: string): {
  month: string
  day: string
  weekdayTime: string
  fullDate: string
} {
  const parsed = new Date(isoDate)
  if (Number.isNaN(parsed.getTime())) {
    return {
      month: 'TBD',
      day: '--',
      weekdayTime: 'Time TBD',
      fullDate: 'Date to be confirmed',
    }
  }

  const month = parsed
    .toLocaleDateString('en-ZA', { month: 'short' })
    .toUpperCase()
  const day = String(parsed.getDate()).padStart(2, '0')
  const weekday = parsed.toLocaleDateString('en-ZA', { weekday: 'short' })
  const time = parsed.toLocaleTimeString('en-ZA', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  })
  const fullDate = parsed.toLocaleDateString('en-ZA', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  })

  return {
    month,
    day,
    weekdayTime: `${weekday} · ${time}`,
    fullDate,
  }
}

export function LocalEventsSection() {
  const [events, setEvents] = useState<LocalEvent[]>([])
  const [selectedMunicipality, setSelectedMunicipality] = useState<string>('All Mopani')
  const [loading, setLoading] = useState(true)
  const [tableMissing, setTableMissing] = useState(false)
  const [errorMessage, setErrorMessage] = useState('')

  const loadEvents = useCallback(async (municipalityFilter: string) => {
    setLoading(true)
    setErrorMessage('')
    const activeMunicipality =
      municipalityFilter && municipalityFilter !== 'All Mopani' ? municipalityFilter : ''

    try {
      const qs = activeMunicipality
        ? `?municipality=${encodeURIComponent(activeMunicipality)}`
        : ''
      const res = await fetch(`/api/events${qs}`)
      if (res.ok) {
        const json = (await res.json().catch(() => ({}))) as {
          ok?: boolean
          events?: LocalEvent[]
          tableMissing?: boolean
          error?: string
        }
        if (json.ok) {
          setEvents(json.events || [])
          setTableMissing(Boolean(json.tableMissing))
          return
        }
      }

      if (hasDirectClientSupabase()) {
        let query = supabase
          .from('events')
          .select(
            'id, title, municipality, venue, event_date, description, category, host_name, is_published, created_at'
          )
          .eq('is_published', true)
          .order('event_date', { ascending: true })
          .limit(50)

        if (activeMunicipality) {
          query = query.eq('municipality', activeMunicipality)
        }

        const { data, error } = await query
        if (error) {
          if (
            error.code === '42P01' ||
            error.code === 'PGRST205' ||
            /relation .*events.* does not exist|schema cache/i.test(error.message || '')
          ) {
            setEvents([])
            setTableMissing(true)
            return
          }
          setErrorMessage(error.message)
          setEvents([])
          return
        }
        setEvents((data || []) as LocalEvent[])
        setTableMissing(false)
        return
      }

      setErrorMessage('Could not load local events right now.')
    } catch (err: unknown) {
      setErrorMessage(
        err instanceof Error ? err.message : 'Unable to reach events service.'
      )
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void loadEvents(selectedMunicipality)
  }, [loadEvents, selectedMunicipality])

  return (
    <section
      aria-labelledby="local-events-heading"
      className="mt-14 pt-10 border-t border-rose-100"
    >
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4 mb-6">
        <div className="space-y-1">
          <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-rose-700">
            <CalendarDays className="w-4 h-4 text-amber-500" />
            <span>Mopani District Meet-Ups</span>
          </div>
          <h2
            id="local-events-heading"
            className="text-2xl sm:text-3xl font-extrabold text-gray-900 tracking-tight"
          >
            Local Singles Events
          </h2>
          <p className="text-sm text-gray-600 max-w-2xl">
            Safe, public community gatherings across Tzaneen, Hoedspruit, Phalaborwa, Letaba, and Giyani.
          </p>
        </div>

        <button
          type="button"
          onClick={() => void loadEvents(selectedMunicipality)}
          disabled={loading}
          className="self-start sm:self-auto min-h-[40px] px-4 py-2 rounded-xl border border-rose-200 bg-white hover:bg-rose-50 text-rose-800 text-xs font-semibold flex items-center gap-1.5 transition whitespace-nowrap disabled:opacity-60"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
          Refresh Events
        </button>
      </div>

      <div className="flex items-center gap-2 overflow-x-auto pb-2 mb-6">
        {MUNICIPALITY_FILTERS.map((mun) => {
          const active = selectedMunicipality === mun
          return (
            <button
              key={mun}
              type="button"
              onClick={() => setSelectedMunicipality(mun)}
              className={`min-h-[40px] px-4 py-2 rounded-xl text-xs font-semibold transition whitespace-nowrap ${
                active
                  ? 'bg-rose-700 text-white shadow-sm'
                  : 'bg-white border border-gray-200 text-gray-700 hover:bg-rose-50 hover:border-rose-200'
              }`}
            >
              {mun}
            </button>
          )
        })}
      </div>

      {loading ? (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
          {[1, 2, 3].map((n) => (
            <div
              key={n}
              className="bg-white rounded-2xl border border-gray-200 p-5 space-y-3 animate-pulse"
            >
              <div className="h-4 bg-gray-100 rounded w-1/3" />
              <div className="h-6 bg-gray-200 rounded w-4/5" />
              <div className="h-4 bg-gray-100 rounded w-2/3" />
              <div className="h-12 bg-gray-100 rounded w-full" />
            </div>
          ))}
        </div>
      ) : tableMissing ? (
        <div className="bg-amber-50 border border-amber-200 rounded-2xl p-6 text-left space-y-2">
          <div className="flex items-center gap-2 text-amber-950 font-bold text-sm">
            <Sparkles className="w-4 h-4 text-amber-600 shrink-0" />
            <span>Supabase Events Table Setup Required</span>
          </div>
          <p className="text-xs sm:text-sm text-amber-900 leading-relaxed">
            Run the updated <code className="font-mono bg-amber-100 px-1.5 py-0.5 rounded">supabase.sql</code> script in your Supabase SQL Editor to create and seed the <code className="font-mono bg-amber-100 px-1.5 py-0.5 rounded">public.events</code> table for Mopani meet-ups.
          </p>
        </div>
      ) : errorMessage ? (
        <div className="bg-rose-50 border border-rose-200 rounded-2xl p-6 text-sm text-rose-800">
          {errorMessage}
        </div>
      ) : events.length === 0 ? (
        <div className="bg-white rounded-2xl border border-gray-200 p-10 text-center space-y-2">
          <CalendarDays className="w-10 h-10 text-rose-300 mx-auto" />
          <h3 className="text-base font-bold text-gray-900">
            No upcoming meet-ups listed
            {selectedMunicipality !== 'All Mopani' ? ` in ${selectedMunicipality}` : ''}
          </h3>
          <p className="text-xs sm:text-sm text-gray-500">
            Check another Mopani municipality above or revisit soon for new community gatherings.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
          {events.map((ev) => {
            const dt = formatEventDateParts(ev.event_date)
            return (
              <article
                key={ev.id}
                className="bg-white rounded-2xl border border-rose-100 shadow-sm hover:shadow-md transition p-5 flex flex-col justify-between space-y-4"
              >
                <div className="space-y-3">
                  <div className="flex items-start gap-3.5">
                    <div className="shrink-0 w-14 rounded-xl bg-rose-50 border border-rose-100 py-2 text-center tabular-nums">
                      <div className="text-[10px] font-bold tracking-wider text-rose-700">
                        {dt.month}
                      </div>
                      <div className="text-xl font-black text-gray-900 leading-tight">
                        {dt.day}
                      </div>
                    </div>

                    <div className="min-w-0 flex-1 space-y-1">
                      <div className="text-xs font-semibold text-rose-700 truncate">
                        {ev.category || 'Community Meet-Up'} · {ev.host_name || 'Mopani Singles'}
                      </div>
                      <h3 className="text-base font-bold text-gray-900 leading-snug">
                        {ev.title}
                      </h3>
                    </div>
                  </div>

                  {ev.description && (
                    <p className="text-sm text-gray-600 leading-relaxed line-clamp-3">
                      {ev.description}
                    </p>
                  )}
                </div>

                <div className="pt-3 border-t border-gray-100 space-y-1.5 text-xs text-gray-600">
                  <div className="flex items-start gap-1.5">
                    <MapPin className="w-3.5 h-3.5 text-rose-600 shrink-0 mt-0.5" />
                    <span>
                      <strong className="font-semibold text-gray-900">{ev.venue}</strong> ·{' '}
                      {ev.municipality}
                    </span>
                  </div>
                  <div className="flex items-center gap-1.5 tabular-nums text-gray-500">
                    <Clock className="w-3.5 h-3.5 text-amber-500 shrink-0" />
                    <span>
                      {dt.fullDate} · {dt.weekdayTime}
                    </span>
                  </div>
                </div>
              </article>
            )
          })}
        </div>
      )}
    </section>
  )
}
