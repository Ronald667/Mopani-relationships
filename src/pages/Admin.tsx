import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { BackButton } from '@/components/BackButton'
import { ProfileAvatar } from '@/components/ProfileAvatar'
import {
  getLocalProfiles,
  updateProfileModerationStatus,
} from '@/utils/profileStorage'
import { ShieldCheck, Check, Ban, AlertTriangle, Users, Lock } from 'lucide-react'

export function Admin({ onBack }: { onBack: () => void }) {
  const [pendingList, setPendingList] = useState<any[]>([])
  const [allActiveList, setAllActiveList] = useState<any[]>([])
  const [reportsList, setReportsList] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [activeTab, setActiveTab] = useState<'all' | 'pending' | 'reports'>('all')
  const [emailInput, setEmailInput] = useState('')
  const [authError, setAuthError] = useState('')
  const [statusMessage, setStatusMessage] = useState('')
  const [isAuthenticated, setIsAuthenticated] = useState(() => {
    return localStorage.getItem('mopani_admin_email') === 'phasharonny@gmail.com'
  })

  useEffect(() => {
    if (isAuthenticated) {
      loadAdminData()
    }
  }, [isAuthenticated])

  const loadAdminData = async () => {
    setLoading(true)
    try {
      const { data } = await supabase
        .from('profiles')
        .select('*')
        .eq('is_banned', false)
        .order('created_at', { ascending: false })

      const remoteProfiles = data || []
      const localProfiles = getLocalProfiles().filter((p) => !p.is_banned)
      const mergedMap = new Map<string, any>()
      for (const p of remoteProfiles) mergedMap.set(p.id, p)
      for (const lp of localProfiles) {
        if (!mergedMap.has(lp.id)) mergedMap.set(lp.id, lp)
      }

      const combined = Array.from(mergedMap.values())
      setAllActiveList(combined.filter((p) => p.is_approved))
      setPendingList(combined.filter((p) => !p.is_approved))

      const { data: repData } = await supabase
        .from('reports')
        .select('*')
        .order('created_at', { ascending: false })
      const localReports = JSON.parse(localStorage.getItem('mopani_reports') || '[]')
      setReportsList([...(repData || []), ...localReports])
    } catch (err) {
      console.warn('Error loading admin data, using local storage fallback:', err)
      const localProfiles = getLocalProfiles().filter((p) => !p.is_banned)
      setAllActiveList(localProfiles.filter((p) => p.is_approved))
      setPendingList(localProfiles.filter((p) => !p.is_approved))
      setReportsList(JSON.parse(localStorage.getItem('mopani_reports') || '[]'))
    } finally {
      setLoading(false)
    }
  }

  const approveProfile = async (id: string) => {
    try {
      await supabase.from('profiles').update({ is_approved: true }).eq('id', id)
      updateProfileModerationStatus(id, { is_approved: true })
      const moved = pendingList.find((p) => p.id === id)
      setPendingList((prev) => prev.filter((p) => p.id !== id))
      if (moved) {
        setAllActiveList((prev) => [{ ...moved, is_approved: true }, ...prev])
      }
      setStatusMessage('Profile approved and now live in Discover and Matches.')
    } catch (err: any) {
      setStatusMessage('Error approving: ' + err.message)
    }
  }

  const banProfile = async (id: string) => {
    try {
      await supabase.from('profiles').update({ is_banned: true }).eq('id', id)
      updateProfileModerationStatus(id, { is_banned: true })
      setPendingList((prev) => prev.filter((p) => p.id !== id))
      setAllActiveList((prev) => prev.filter((p) => p.id !== id))
      setStatusMessage('Profile banned and hidden from all users.')
    } catch (err: any) {
      setStatusMessage('Error banning: ' + err.message)
    }
  }

  if (!isAuthenticated) {
    return (
      <div className="max-w-md mx-auto px-4 py-20">
        <BackButton onClick={onBack} label="Back to Discover" />
        <div className="bg-white rounded-3xl p-8 shadow-xl border border-rose-100 text-center space-y-5">
          <div className="w-14 h-14 bg-rose-900 text-white rounded-2xl flex items-center justify-center mx-auto shadow-md">
            <Lock className="w-8 h-8 text-amber-400" />
          </div>
          <h2 className="text-2xl font-black text-gray-900">Restricted Admin Access</h2>
          <p className="text-xs text-gray-500">
            This admin page is strictly protected. Please verify your authorized administrator email address to continue.
          </p>
          <form
            onSubmit={(e) => {
              e.preventDefault()
              setAuthError('')
              if (emailInput.trim().toLowerCase() === 'phasharonny@gmail.com') {
                localStorage.setItem('mopani_admin_email', 'phasharonny@gmail.com')
                setIsAuthenticated(true)
              } else {
                setAuthError('Access Denied: Only phasharonny@gmail.com can access the admin page.')
              }
            }}
            className="space-y-4 pt-2"
          >
            {authError && (
              <div className="bg-red-50 border border-red-200 text-red-700 text-xs font-semibold px-3 py-2 rounded-xl">
                {authError}
              </div>
            )}
            <input
              type="email"
              placeholder="Enter your admin email"
              value={emailInput}
              onChange={(e) => setEmailInput(e.target.value)}
              className="w-full border border-gray-300 rounded-xl p-3 text-center text-sm focus:ring-2 focus:ring-rose-500 focus:outline-none"
            />
            <button
              type="submit"
              className="w-full bg-rose-700 hover:bg-rose-800 text-white font-bold py-3 rounded-xl shadow-md transition text-sm"
            >
              Verify & Enter Admin
            </button>
          </form>
        </div>
      </div>
    )
  }

  const displayedProfiles = activeTab === 'pending' ? pendingList : allActiveList

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <BackButton onClick={onBack} label="Back to Discover" />

      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-8">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <span className="bg-emerald-100 text-emerald-800 text-[10px] font-bold px-2.5 py-0.5 rounded-full">
              Authenticated as phasharonny@gmail.com
            </span>
            <button
              onClick={() => {
                localStorage.removeItem('mopani_admin_email')
                setIsAuthenticated(false)
              }}
              className="text-[10px] text-gray-400 hover:text-red-600 underline"
            >
              Lock Admin
            </button>
          </div>
          <h1 className="text-2xl sm:text-3xl font-black text-gray-900 flex items-center gap-2">
            <ShieldCheck className="w-7 h-7 text-rose-600" /> Admin Safety & Moderation
          </h1>
          <p className="text-xs sm:text-sm text-gray-500">Moderate live member profiles, pending items, and community reports.</p>
        </div>
        <div className="flex flex-wrap gap-2 bg-white p-1.5 rounded-2xl border border-gray-200 shadow-xs">
          <button
            onClick={() => setActiveTab('all')}
            className={`px-4 py-2 rounded-xl text-xs font-bold transition flex items-center gap-1.5 ${
              activeTab === 'all' ? 'bg-rose-700 text-white shadow-sm' : 'text-gray-600 hover:bg-gray-100'
            }`}
          >
            <Users className="w-4 h-4" /> Live Members ({allActiveList.length})
          </button>
          <button
            onClick={() => setActiveTab('pending')}
            className={`px-4 py-2 rounded-xl text-xs font-bold transition flex items-center gap-1.5 ${
              activeTab === 'pending' ? 'bg-rose-700 text-white shadow-sm' : 'text-gray-600 hover:bg-gray-100'
            }`}
          >
            <Users className="w-4 h-4" /> Pending ({pendingList.length})
          </button>
          <button
            onClick={() => setActiveTab('reports')}
            className={`px-4 py-2 rounded-xl text-xs font-bold transition flex items-center gap-1.5 ${
              activeTab === 'reports' ? 'bg-amber-600 text-white shadow-sm' : 'text-gray-600 hover:bg-gray-100'
            }`}
          >
            <AlertTriangle className="w-4 h-4" /> Reports ({reportsList.length})
          </button>
        </div>
      </div>

      {statusMessage && (
        <div className="mb-6 bg-rose-50 border border-rose-200 text-rose-800 text-xs font-semibold px-4 py-3 rounded-2xl flex items-center justify-between">
          <span>{statusMessage}</span>
          <button onClick={() => setStatusMessage('')} className="underline text-rose-600">
            Dismiss
          </button>
        </div>
      )}

      {loading ? (
        <div className="text-center py-16 text-gray-500">Loading moderation queue...</div>
      ) : activeTab === 'pending' || activeTab === 'all' ? (
        displayedProfiles.length === 0 ? (
          <div className="bg-white rounded-2xl p-12 text-center border border-gray-200 shadow-sm">
            <Check className="w-12 h-12 text-rose-600 mx-auto mb-3" />
            <h3 className="text-lg font-bold text-gray-800">All caught up!</h3>
            <p className="text-sm text-gray-500">
              {activeTab === 'pending'
                ? 'No pending profiles waiting for approval.'
                : 'No active member profiles found.'}
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {displayedProfiles.map((p) => (
              <div key={p.id} className="bg-white rounded-2xl overflow-hidden border border-gray-200 shadow-md flex flex-col">
                <div className="relative h-56 bg-gray-100">
                  <ProfileAvatar
                    src={p.photo_url}
                    name={p.full_name}
                    className="w-full h-full"
                    textSizeClass="text-3xl"
                  />
                  <div
                    className={`absolute top-3 right-3 text-xs font-bold px-2.5 py-1 rounded-full ${
                      p.is_approved ? 'bg-emerald-600 text-white' : 'bg-amber-500 text-gray-900'
                    }`}
                  >
                    {p.is_approved ? 'Live Profile' : 'Pending Review'}
                  </div>
                </div>
                <div className="p-5 flex-1 flex flex-col justify-between space-y-4">
                  <div>
                    <h3 className="text-lg font-bold text-gray-900">{p.full_name}, {p.age}</h3>
                    <p className="text-xs text-gray-500 mb-2">{p.village}, {p.municipality} • {p.gender} • {p.intention}</p>
                    <p className="text-xs font-mono text-rose-700 bg-rose-50 px-2 py-1 rounded mb-2">WhatsApp: {p.whatsapp}</p>
                    <p className="text-sm text-gray-700 bg-gray-50 p-3 rounded-xl border border-gray-100 italic">"{p.bio}"</p>
                  </div>
                  <div className="flex gap-2 pt-2 border-t border-gray-100">
                    {!p.is_approved && (
                      <button
                        onClick={() => approveProfile(p.id)}
                        className="flex-1 bg-rose-600 hover:bg-rose-700 text-white font-semibold py-2.5 rounded-xl text-xs transition flex items-center justify-center gap-1.5 shadow-sm"
                      >
                        <Check className="w-4 h-4" /> Approve
                      </button>
                    )}
                    <button
                      onClick={() => banProfile(p.id)}
                      className="flex-1 bg-red-600 hover:bg-red-700 text-white font-semibold py-2.5 rounded-xl text-xs transition flex items-center justify-center gap-1.5 shadow-sm"
                    >
                      <Ban className="w-4 h-4" /> Ban User
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )
      ) : (
        reportsList.length === 0 ? (
          <div className="bg-white rounded-2xl p-12 text-center border border-gray-200 shadow-sm">
            <Check className="w-12 h-12 text-rose-600 mx-auto mb-3" />
            <h3 className="text-lg font-bold text-gray-800">No Reports</h3>
            <p className="text-sm text-gray-500">No community safety reports submitted.</p>
          </div>
        ) : (
          <div className="space-y-4">
            {reportsList.map((r, i) => (
              <div key={i} className="bg-white rounded-2xl p-5 border border-amber-200 shadow-sm flex items-start justify-between gap-4">
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <span className="bg-amber-100 text-amber-800 text-xs font-bold px-2.5 py-0.5 rounded-full flex items-center gap-1">
                      <AlertTriangle className="w-3.5 h-3.5" /> Reported ID: {r.reported_id}
                    </span>
                    <span className="text-xs text-gray-400">{new Date(r.created_at || Date.now()).toLocaleString()}</span>
                  </div>
                  <p className="text-sm text-gray-800 font-medium mt-2">Reason: "{r.reason}"</p>
                </div>
                <button
                  onClick={() => banProfile(r.reported_id)}
                  className="bg-red-600 text-white px-4 py-2 rounded-xl text-xs font-semibold hover:bg-red-700 transition shadow-sm whitespace-nowrap"
                >
                  Ban Reported User
                </button>
              </div>
            ))}
          </div>
        )
      )}
    </div>
  )
}
