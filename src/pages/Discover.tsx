import { useState, useEffect, useCallback } from 'react'
import { supabase } from '@/lib/supabase'
import { ReportModal } from '@/components/ReportModal'
import { ProfileAvatar } from '@/components/ProfileAvatar'
import { Logo } from '@/components/Logo'
import {
  Profile,
  fetchApprovedProfiles,
  getActiveProfileId,
  normalizePhone,
} from '@/utils/profileStorage'
import { MapPin, MessageCircle, ShieldCheck, Heart, Sparkles, Filter, Search, Lock, RefreshCw } from 'lucide-react'

const VILLAGES: Record<string, string[]> = {
  "Maruleng": ["Lorraine", "Sekororo", "Trichardtsdal", "The Oaks", "Hoedspruit", "Makhutsi"],
  "Greater Tzaneen": ["Tzaneen", "Lenyenye", "Letsitele", "Maake", "Nkowankowa"],
  "Greater Letaba": ["Modjadjiskloof", "Ga-Kgapane", "Mokwakwaila"],
  "Ba-Phalaborwa": ["Phalaborwa", "Namakgale", "Lulekani", "Gravalotte"],
  "Greater Giyani": ["Giyani", "Dzumeri", "Nkomo"]
}

export function Discover({
  onGoRegister,
  onStartChat,
}: {
  onGoRegister: () => void
  onStartChat: (profileId: string) => void
}) {
  const [profiles, setProfiles] = useState<Profile[]>([])
  const [loading, setLoading] = useState(true)
  const [activeProfileId] = useState(() => getActiveProfileId())
  const [selectedMunicipality, setSelectedMunicipality] = useState('')
  const [selectedVillage, setSelectedVillage] = useState('')
  const [selectedIntention, setSelectedIntention] = useState('')
  const [selectedGender, setSelectedGender] = useState('')
  const [searchQuery, setSearchQuery] = useState('')

  const [reportModalOpen, setReportModalOpen] = useState(false)
  const [reportingProfile, setReportingProfile] = useState<{ id: string; name: string } | null>(null)

  const fetchProfiles = useCallback(async () => {
    setLoading(true)
    try {
      const approved = await fetchApprovedProfiles()
      setProfiles(approved)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchProfiles()

    const channel = supabase
      .channel('public:profiles-discover')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'profiles' },
        () => {
          fetchProfiles()
        }
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [fetchProfiles])

  const filteredProfiles = profiles.filter((p) => {
    if (selectedMunicipality && p.municipality !== selectedMunicipality) return false
    if (selectedVillage && p.village !== selectedVillage) return false
    if (selectedIntention && p.intention !== selectedIntention) return false
    if (selectedGender && p.gender !== selectedGender) return false
    if (searchQuery) {
      const q = searchQuery.toLowerCase()
      const matchName = p.full_name?.toLowerCase().includes(q)
      const matchBio = p.bio?.toLowerCase().includes(q)
      const matchVillage = p.village?.toLowerCase().includes(q)
      if (!matchName && !matchBio && !matchVillage) return false
    }
    return true
  })

  const openWhatsApp = (whatsappNumber: string, name: string) => {
    const cleanNum = normalizePhone(whatsappNumber)
    if (!cleanNum) return
    const message = encodeURIComponent(`Hi ${name}, I saw your profile on Mopani Singles-v2. I would love to connect!`)
    window.open(`https://wa.me/${cleanNum}?text=${message}`, '_blank')
  }

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <div className="relative bg-gradient-to-r from-rose-900 via-rose-800 to-amber-700 rounded-3xl p-8 md:p-12 text-white shadow-xl mb-10 overflow-hidden flex flex-col md:flex-row items-center justify-between gap-8">
        <div className="absolute right-0 top-0 w-96 h-96 bg-white/10 rounded-full blur-3xl pointer-events-none" />
        <div className="relative z-10 max-w-2xl">
          <div className="inline-flex items-center gap-2 bg-rose-950/60 backdrop-blur-md px-3 py-1 rounded-full text-xs font-medium text-rose-200 mb-4 border border-rose-500/30">
            <Sparkles className="w-3.5 h-3.5 text-amber-400" /> Verified Mopani District Singles
          </div>
          <h1 className="text-3xl md:text-5xl font-black tracking-tight mb-4">
            Find Your Special Someone in Mopani
          </h1>
          <p className="text-rose-100 text-sm md:text-base mb-6 leading-relaxed">
            Connecting real singles across Maruleng, Greater Tzaneen, Greater Letaba, Ba-Phalaborwa, and Greater Giyani with real-time private chat and file sharing.
          </p>
          <div className="flex flex-wrap gap-4">
            <button
              onClick={onGoRegister}
              className="bg-amber-500 hover:bg-amber-600 text-gray-900 font-bold px-6 py-3 rounded-2xl shadow-lg transition flex items-center gap-2 text-sm"
            >
              <Heart className="w-4 h-4 fill-gray-900" /> Create Profile Free
            </button>
          </div>
        </div>

        <div className="relative z-10 hidden md:flex items-center justify-center shrink-0">
          <div className="p-3 rounded-[2.25rem] bg-white/10 backdrop-blur-md border border-amber-200/30 shadow-2xl">
            <Logo className="w-40 h-40" />
          </div>
        </div>
      </div>

      <div className="bg-white rounded-2xl p-5 shadow-md border border-rose-100 mb-8 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-bold text-gray-900 flex items-center gap-2">
            <Filter className="w-4 h-4 text-rose-600" /> Filter Singles ({filteredProfiles.length})
          </h2>
          <div className="flex items-center gap-3">
            {(selectedMunicipality || selectedVillage || selectedIntention || selectedGender || searchQuery) && (
              <button
                onClick={() => {
                  setSelectedMunicipality('')
                  setSelectedVillage('')
                  setSelectedIntention('')
                  setSelectedGender('')
                  setSearchQuery('')
                }}
                className="text-xs text-rose-700 hover:underline font-semibold"
              >
                Reset Filters
              </button>
            )}
            <button
              onClick={fetchProfiles}
              disabled={loading}
              className="text-xs text-gray-600 hover:text-rose-700 font-semibold flex items-center gap-1"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} /> Refresh
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
          <div className="relative">
            <Search className="absolute left-3 top-3 w-4 h-4 text-gray-400" />
            <input
              type="text"
              placeholder="Search name, bio..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-9 pr-3 py-2 bg-gray-50 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-rose-500"
            />
          </div>

          <select
            value={selectedMunicipality}
            onChange={(e) => {
              setSelectedMunicipality(e.target.value)
              setSelectedVillage('')
            }}
            className="w-full py-2 px-3 bg-gray-50 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-rose-500"
          >
            <option value="">All Municipalities</option>
            {Object.keys(VILLAGES).map((m) => (
              <option key={m} value={m}>{m}</option>
            ))}
          </select>

          <select
            value={selectedVillage}
            onChange={(e) => setSelectedVillage(e.target.value)}
            disabled={!selectedMunicipality}
            className="w-full py-2 px-3 bg-gray-50 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-rose-500 disabled:opacity-50"
          >
            <option value="">All Villages / Towns</option>
            {selectedMunicipality &&
              VILLAGES[selectedMunicipality]?.map((v) => (
                <option key={v} value={v}>{v}</option>
              ))}
          </select>

          <select
            value={selectedIntention}
            onChange={(e) => setSelectedIntention(e.target.value)}
            className="w-full py-2 px-3 bg-gray-50 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-rose-500"
          >
            <option value="">All Intentions</option>
            <option value="Marriage">Marriage</option>
            <option value="Dating">Dating</option>
            <option value="Friendship">Friendship</option>
          </select>

          <select
            value={selectedGender}
            onChange={(e) => setSelectedGender(e.target.value)}
            className="w-full py-2 px-3 bg-gray-50 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-rose-500"
          >
            <option value="">All Genders</option>
            <option value="Male">Male</option>
            <option value="Female">Female</option>
          </select>
        </div>
      </div>

      {loading ? (
        <div className="text-center py-20 text-gray-500">Loading verified Mopani singles...</div>
      ) : filteredProfiles.length === 0 ? (
        <div className="bg-white rounded-2xl p-12 text-center border border-gray-200 shadow-sm">
          <Heart className="w-12 h-12 text-gray-300 mx-auto mb-3" />
          <h3 className="text-lg font-bold text-gray-800 mb-1">
            {profiles.length === 0 ? 'No profiles registered yet' : 'No matching profiles found'}
          </h3>
          <p className="text-sm text-gray-500 mb-4 max-w-md mx-auto">
            {profiles.length === 0
              ? 'Be the first to register a real profile in Mopani District to connect and chat with other users.'
              : 'Try adjusting your filters or create a new profile in this area.'}
          </p>
          <button
            onClick={onGoRegister}
            className="bg-rose-700 hover:bg-rose-800 text-white px-5 py-2.5 rounded-xl text-sm font-semibold shadow-md transition"
          >
            Create Profile Now
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
          {filteredProfiles.map((p) => {
            const isActiveSelf = p.id === activeProfileId
            return (
              <div
                key={p.id}
                className="bg-white rounded-2xl overflow-hidden border border-rose-100 shadow-md hover:shadow-xl transition-all duration-300 flex flex-col group"
              >
                <div className="relative h-64 w-full bg-gray-200 overflow-hidden">
                  <ProfileAvatar
                    src={p.photo_url}
                    name={p.full_name}
                    className="w-full h-full group-hover:scale-105 transition duration-500"
                    textSizeClass="text-4xl"
                  />
                  <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-transparent" />

                  <div className="absolute top-3 left-3 flex gap-2">
                    <span className="bg-black/50 backdrop-blur-md text-white text-xs px-2.5 py-1 rounded-full font-medium flex items-center gap-1">
                      <ShieldCheck className="w-3.5 h-3.5 text-rose-400" /> Verified 18+
                    </span>
                  </div>

                  <div className="absolute top-3 right-3">
                    <span className="bg-rose-700/90 backdrop-blur-md text-white text-xs px-2.5 py-1 rounded-full font-bold">
                      {p.intention || 'Dating'}
                    </span>
                  </div>

                  <div className="absolute bottom-3 left-3 right-3 text-white">
                    <h3 className="text-xl font-bold flex items-center gap-2">
                      {p.full_name}, {p.age}
                    </h3>
                    <p className="text-xs text-rose-200 flex items-center gap-1 mt-0.5">
                      <MapPin className="w-3.5 h-3.5" /> {p.village}, {p.municipality}
                    </p>
                  </div>
                </div>

                <div className="p-5 flex-1 flex flex-col justify-between space-y-4">
                  <div>
                    <div className="flex items-center gap-2 mb-2 text-xs text-gray-500 font-medium">
                      <span className="bg-gray-100 px-2 py-0.5 rounded">Language: {p.language || 'Sepedi'}</span>
                      <span className="bg-rose-50 text-rose-700 px-2 py-0.5 rounded font-semibold">
                        {p.gender}
                      </span>
                    </div>
                    <p className="text-sm text-gray-700 line-clamp-3 leading-relaxed">
                      "{p.bio}"
                    </p>
                  </div>

                  <div className="pt-2 border-t border-gray-100 space-y-2">
                    {!isActiveSelf ? (
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => onStartChat(p.id)}
                          className="flex-1 bg-rose-700 hover:bg-rose-800 text-white font-semibold py-2.5 px-3 rounded-xl shadow-md transition flex items-center justify-center gap-1.5 text-xs"
                        >
                          <Lock className="w-3.5 h-3.5" /> Private Chat
                        </button>
                        {p.whatsapp && (
                          <button
                            onClick={() => openWhatsApp(p.whatsapp, p.full_name)}
                            className="bg-rose-50 hover:bg-rose-100 text-rose-800 font-semibold py-2.5 px-3 rounded-xl transition flex items-center justify-center gap-1 text-xs"
                          >
                            <MessageCircle className="w-3.5 h-3.5" /> WhatsApp
                          </button>
                        )}
                      </div>
                    ) : (
                      <div className="text-center text-xs font-semibold text-rose-700 bg-rose-50 py-2 rounded-xl">
                        Your Active Profile
                      </div>
                    )}

                    <div className="flex justify-end">
                      <button
                        onClick={() => {
                          setReportingProfile({ id: p.id, name: p.full_name })
                          setReportModalOpen(true)
                        }}
                        className="text-xs text-gray-400 hover:text-red-600 underline transition"
                      >
                        Report
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {reportingProfile && (
        <ReportModal
          isOpen={reportModalOpen}
          onClose={() => {
            setReportModalOpen(false)
            setReportingProfile(null)
          }}
          reportedId={reportingProfile.id}
          reportedName={reportingProfile.name}
        />
      )}
    </div>
  )
}
