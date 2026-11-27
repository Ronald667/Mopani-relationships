import React, { useCallback, useEffect, useState } from 'react'
import { sendEmailVerificationOtp, verifyEmailOtpCode } from '@/lib/supabase'
import { BackButton } from '@/components/BackButton'
import { ProfileAvatar } from '@/components/ProfileAvatar'
import { SupabaseDiagnosticAlert } from '@/components/SupabaseDiagnosticAlert'
import {
  Profile,
  getLocalProfiles,
  isProfileIdentityVerified,
  updateProfileModerationStatus,
} from '@/utils/profileStorage'
import {
  ShieldCheck,
  Check,
  Ban,
  AlertTriangle,
  Users,
  Lock,
  Database,
  BadgeCheck,
  Camera,
  X,
  RefreshCw,
  MailCheck,
  Eye,
  CalendarDays,
  Plus,
  Trash2,
} from 'lucide-react'
import type { LocalEvent } from '@/components/LocalEventsSection'

interface AdminProfileRecord extends Profile {
  signed_selfie_url?: string
  verification_selfie_url?: string
}

interface ReportRecord {
  id?: string
  reported_id: string
  reason: string
  created_at?: string
}

export function Admin({ onBack }: { onBack: () => void }) {
  const [adminToken, setAdminToken] = useState<string>('')
  const [adminEmailLabel, setAdminEmailLabel] = useState<string>('phasharonny@gmail.com')
  const [setupRequired, setSetupRequired] = useState<boolean>(false)
  const [checkingAuthStatus, setCheckingAuthStatus] = useState<boolean>(true)

  const [loginMode, setLoginMode] = useState<'password' | 'otp'>('password')
  const [emailInput, setEmailInput] = useState('phasharonny@gmail.com')
  const [passcodeInput, setPasscodeInput] = useState('')
  const [confirmPasscodeInput, setConfirmPasscodeInput] = useState('')
  const [otpSent, setOtpSent] = useState(false)
  const [otpCode, setOtpCode] = useState('')
  const [authSubmitting, setAuthSubmitting] = useState(false)
  const [authError, setAuthError] = useState('')

  const [verificationQueue, setVerificationQueue] = useState<AdminProfileRecord[]>([])
  const [pendingList, setPendingList] = useState<AdminProfileRecord[]>([])
  const [allActiveList, setAllActiveList] = useState<AdminProfileRecord[]>([])
  const [reportsList, setReportsList] = useState<ReportRecord[]>([])
  const [eventsList, setEventsList] = useState<LocalEvent[]>([])
  const [eventsTableMissing, setEventsTableMissing] = useState(false)
  const [eventForm, setEventForm] = useState({
    title: '',
    municipality: 'Greater Tzaneen',
    venue: '',
    event_date: '',
    category: 'Community Meet-Up',
    host_name: 'Mopani Singles Community',
    description: '',
  })
  const [savingEvent, setSavingEvent] = useState(false)
  const [loading, setLoading] = useState(false)
  const [activeTab, setActiveTab] = useState<
    'verifications' | 'all' | 'pending' | 'reports' | 'events'
  >('verifications')
  const [statusMessage, setStatusMessage] = useState('')
  const [showDiagnostics, setShowDiagnostics] = useState(false)
  const [rejectionNotes, setRejectionNotes] = useState<Record<string, string>>({})
  const [processingId, setProcessingId] = useState<string>('')
  const [lightboxImage, setLightboxImage] = useState<{ url: string; name: string } | null>(null)

  useEffect(() => {
    let active = true
    const checkStatus = async () => {
      try {
        const res = await fetch('/api/admin/auth/status')
        const json = (await res.json().catch(() => ({}))) as {
          ok?: boolean
          adminEmail?: string
          setupRequired?: boolean
        }
        if (!active) return
        if (json.adminEmail) {
          setAdminEmailLabel(json.adminEmail)
          setEmailInput(json.adminEmail)
        }
        setSetupRequired(Boolean(json.setupRequired))
      } catch {
        // ignore offline status check
      } finally {
        if (active) setCheckingAuthStatus(false)
      }
    }
    void checkStatus()
    return () => {
      active = false
    }
  }, [])

  const loadAdminData = useCallback(async (token: string) => {
    if (!token) return
    setLoading(true)
    try {
      const [res, eventsRes] = await Promise.all([
        fetch('/api/admin/profiles', {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        }),
        fetch('/api/admin/events', {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        }).catch(() => null),
      ])
      const json = (await res.json().catch(() => ({}))) as {
        ok?: boolean
        profiles?: AdminProfileRecord[]
        reports?: ReportRecord[]
        error?: string
      }

      if (res.status === 401) {
        setAdminToken('')
        setAuthError(json.error || 'Session expired. Please sign in again.')
        return
      }

      if (!res.ok || !json.ok) {
        setStatusMessage(json.error || 'Could not load moderation queue.')
        return
      }

      if (eventsRes && eventsRes.ok) {
        const eventsJson = (await eventsRes.json().catch(() => ({}))) as {
          ok?: boolean
          events?: LocalEvent[]
          tableMissing?: boolean
        }
        if (eventsJson.ok) {
          setEventsList(eventsJson.events || [])
          setEventsTableMissing(Boolean(eventsJson.tableMissing))
        }
      }

      const remoteProfiles = json.profiles || []
      const localProfiles = getLocalProfiles().filter((p) => !p.is_banned)
      const mergedMap = new Map<string, AdminProfileRecord>()
      for (const p of remoteProfiles) mergedMap.set(p.id, p)
      for (const lp of localProfiles) {
        if (!mergedMap.has(lp.id)) mergedMap.set(lp.id, lp)
      }

      const combined = Array.from(mergedMap.values())
      const pendingVerifications = combined.filter(
        (p) => p.verification_status === 'pending' && !isProfileIdentityVerified(p)
      )
      setVerificationQueue(pendingVerifications)
      setAllActiveList(combined.filter((p) => p.is_approved !== false))
      setPendingList(combined.filter((p) => p.is_approved === false))

      const localReports = JSON.parse(localStorage.getItem('mopani_reports') || '[]') as ReportRecord[]
      setReportsList([...(json.reports || []), ...localReports])

      if (pendingVerifications.length === 0) {
        setActiveTab((prev) => (prev === 'verifications' ? 'all' : prev))
      }
    } catch (err: unknown) {
      setStatusMessage(
        'Error loading admin data: ' + (err instanceof Error ? err.message : 'Unknown error')
      )
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (adminToken) {
      void loadAdminData(adminToken)
    }
  }, [adminToken, loadAdminData])

  const handlePasswordSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setAuthError('')

    const cleanEmail = emailInput.trim().toLowerCase()
    if (cleanEmail !== adminEmailLabel.toLowerCase()) {
      setAuthError(`Access Denied: Only ${adminEmailLabel} can access the admin page.`)
      return
    }

    if (setupRequired) {
      if (passcodeInput.trim().length < 8) {
        setAuthError('Please choose an admin password of at least 8 characters.')
        return
      }
      if (passcodeInput !== confirmPasscodeInput) {
        setAuthError('Passwords do not match.')
        return
      }
      setAuthSubmitting(true)
      try {
        const res = await fetch('/api/admin/auth/setup', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: cleanEmail, passcode: passcodeInput }),
        })
        const json = (await res.json().catch(() => ({}))) as {
          ok?: boolean
          token?: string
          error?: string
        }
        if (!res.ok || !json.ok || !json.token) {
          setAuthError(json.error || 'Could not complete admin password setup.')
          return
        }
        setSetupRequired(false)
        setPasscodeInput('')
        setConfirmPasscodeInput('')
        setAdminToken(json.token)
      } finally {
        setAuthSubmitting(false)
      }
      return
    }

    if (!passcodeInput.trim()) {
      setAuthError('Please enter your admin password.')
      return
    }

    setAuthSubmitting(true)
    try {
      const res = await fetch('/api/admin/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: cleanEmail, passcode: passcodeInput }),
      })
      const json = (await res.json().catch(() => ({}))) as {
        ok?: boolean
        token?: string
        error?: string
      }
      if (!res.ok || !json.ok || !json.token) {
        setAuthError(json.error || 'Invalid admin password.')
        return
      }
      setPasscodeInput('')
      setAdminToken(json.token)
    } finally {
      setAuthSubmitting(false)
    }
  }

  const handleSendAdminOtp = async (e: React.FormEvent) => {
    e.preventDefault()
    setAuthError('')
    const cleanEmail = emailInput.trim().toLowerCase()
    if (cleanEmail !== adminEmailLabel.toLowerCase()) {
      setAuthError(`Access Denied: Only ${adminEmailLabel} can access the admin page.`)
      return
    }
    setAuthSubmitting(true)
    try {
      const res = await sendEmailVerificationOtp(cleanEmail)
      if (!res.ok) {
        setAuthError(res.error || 'Could not send admin OTP.')
        return
      }
      setOtpSent(true)
    } finally {
      setAuthSubmitting(false)
    }
  }

  const handleVerifyAdminOtp = async (e: React.FormEvent) => {
    e.preventDefault()
    setAuthError('')
    const cleanEmail = emailInput.trim().toLowerCase()
    setAuthSubmitting(true)
    try {
      const verifyRes = await verifyEmailOtpCode(cleanEmail, otpCode)
      if (!verifyRes.ok || !verifyRes.accessToken) {
        setAuthError(verifyRes.error || 'Invalid verification code.')
        return
      }
      const loginRes = await fetch('/api/admin/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: cleanEmail,
          supabaseAccessToken: verifyRes.accessToken,
        }),
      })
      const loginJson = (await loginRes.json().catch(() => ({}))) as {
        ok?: boolean
        token?: string
        error?: string
      }
      if (!loginRes.ok || !loginJson.ok || !loginJson.token) {
        setAuthError(loginJson.error || 'Could not authenticate admin session.')
        return
      }
      setOtpCode('')
      setOtpSent(false)
      setAdminToken(loginJson.token)
    } finally {
      setAuthSubmitting(false)
    }
  }

  const handleVerificationDecision = async (
    profileId: string,
    decision: 'approve' | 'reject'
  ) => {
    if (!adminToken || processingId) return
    setProcessingId(profileId)
    setStatusMessage('')
    try {
      const note = rejectionNotes[profileId] || ''
      const res = await fetch('/api/admin/verify-profile', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${adminToken}`,
        },
        body: JSON.stringify({ profileId, decision, note }),
      })
      const json = (await res.json().catch(() => ({}))) as {
        ok?: boolean
        profile?: AdminProfileRecord
        error?: string
      }
      if (!res.ok || !json.ok) {
        setStatusMessage(json.error || 'Unable to update verification status.')
        return
      }

      const approved = decision === 'approve'
      updateProfileModerationStatus(profileId, {
        is_verified: approved,
        verification_status: approved ? 'verified' : 'rejected',
        verification_note: approved ? '' : note,
      })

      setVerificationQueue((prev) => prev.filter((p) => p.id !== profileId))
      setAllActiveList((prev) =>
        prev.map((p) =>
          p.id === profileId
            ? {
                ...p,
                is_verified: approved,
                verification_status: approved ? 'verified' : 'rejected',
              }
            : p
        )
      )
      setStatusMessage(
        approved
          ? 'Profile selfie approved! Member status is now Verified.'
          : 'Verification request declined. Member has been prompted to submit a clearer selfie.'
      )
    } finally {
      setProcessingId('')
    }
  }

  const approveProfileListing = async (id: string) => {
    if (!adminToken || processingId) return
    setProcessingId(id)
    try {
      const res = await fetch('/api/admin/moderate-profile', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${adminToken}`,
        },
        body: JSON.stringify({ profileId: id, action: 'approve_listing' }),
      })
      const json = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string }
      if (!res.ok || !json.ok) {
        setStatusMessage('Error approving: ' + (json.error || 'Request failed'))
        return
      }
      updateProfileModerationStatus(id, { is_approved: true })
      const moved = pendingList.find((p) => p.id === id)
      setPendingList((prev) => prev.filter((p) => p.id !== id))
      if (moved) {
        setAllActiveList((prev) => [{ ...moved, is_approved: true }, ...prev])
      }
      setStatusMessage('Profile approved and now live in Discover and Matches.')
    } finally {
      setProcessingId('')
    }
  }

  const banProfile = async (id: string) => {
    if (!adminToken || processingId) return
    setProcessingId(id)
    try {
      const res = await fetch('/api/admin/moderate-profile', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${adminToken}`,
        },
        body: JSON.stringify({ profileId: id, action: 'ban' }),
      })
      const json = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string }
      if (!res.ok || !json.ok) {
        setStatusMessage('Error banning: ' + (json.error || 'Request failed'))
        return
      }
      updateProfileModerationStatus(id, { is_banned: true })
      setVerificationQueue((prev) => prev.filter((p) => p.id !== id))
      setPendingList((prev) => prev.filter((p) => p.id !== id))
      setAllActiveList((prev) => prev.filter((p) => p.id !== id))
      setStatusMessage('Profile banned and hidden from all users.')
    } finally {
      setProcessingId('')
    }
  }

  const handleCreateEvent = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!adminToken || savingEvent) return
    setSavingEvent(true)
    setStatusMessage('')
    try {
      const res = await fetch('/api/admin/events', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${adminToken}`,
        },
        body: JSON.stringify(eventForm),
      })
      const json = (await res.json().catch(() => ({}))) as {
        ok?: boolean
        event?: LocalEvent
        error?: string
      }
      if (!res.ok || !json.ok || !json.event) {
        setStatusMessage(json.error || 'Could not publish event.')
        return
      }
      setEventsList((prev) =>
        [...prev, json.event!].sort(
          (a, b) => Date.parse(a.event_date) - Date.parse(b.event_date)
        )
      )
      setEventsTableMissing(false)
      setEventForm({
        title: '',
        municipality: 'Greater Tzaneen',
        venue: '',
        event_date: '',
        category: 'Community Meet-Up',
        host_name: 'Mopani Singles Community',
        description: '',
      })
      setStatusMessage('Community event published to Local Singles Events.')
    } finally {
      setSavingEvent(false)
    }
  }

  const handleDeleteEvent = async (eventId: string) => {
    if (!adminToken || processingId) return
    setProcessingId(eventId)
    setStatusMessage('')
    try {
      const res = await fetch(`/api/admin/events/${encodeURIComponent(eventId)}`, {
        method: 'DELETE',
        headers: {
          Authorization: `Bearer ${adminToken}`,
        },
      })
      const json = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string }
      if (!res.ok || !json.ok) {
        setStatusMessage(json.error || 'Could not delete event.')
        return
      }
      setEventsList((prev) => prev.filter((ev) => ev.id !== eventId))
      setStatusMessage('Event removed.')
    } finally {
      setProcessingId('')
    }
  }

  if (!adminToken) {
    return (
      <div className="max-w-md mx-auto px-4 py-16">
        <BackButton onClick={onBack} label="Back to Discover" />
        <div className="bg-white rounded-3xl p-8 shadow-xl border border-rose-100 space-y-5">
          <div className="text-center space-y-3">
            <div className="w-14 h-14 bg-rose-900 text-white rounded-2xl flex items-center justify-center mx-auto shadow-md">
              <Lock className="w-8 h-8 text-amber-400" />
            </div>
            <h2 className="text-2xl font-black text-gray-900">
              {setupRequired ? 'First-Run Admin Setup' : 'Restricted Admin Access'}
            </h2>
            <p className="text-xs text-gray-500">
              {setupRequired
                ? `Set an admin password for ${adminEmailLabel} to secure manual selfie verification and safety moderation.`
                : `Sign in as ${adminEmailLabel} to review selfie verification requests and moderate profiles.`}
            </p>
          </div>

          {!setupRequired && (
            <div className="flex gap-1 p-1 bg-gray-100 rounded-xl text-xs font-semibold">
              <button
                type="button"
                onClick={() => {
                  setLoginMode('password')
                  setAuthError('')
                }}
                className={`flex-1 py-2 rounded-lg transition ${
                  loginMode === 'password' ? 'bg-white text-gray-900 shadow-xs' : 'text-gray-600'
                }`}
              >
                Admin Password
              </button>
              <button
                type="button"
                onClick={() => {
                  setLoginMode('otp')
                  setAuthError('')
                }}
                className={`flex-1 py-2 rounded-lg transition ${
                  loginMode === 'otp' ? 'bg-white text-gray-900 shadow-xs' : 'text-gray-600'
                }`}
              >
                Email OTP
              </button>
            </div>
          )}

          {authError && (
            <div className="bg-red-50 border border-red-200 text-red-700 text-xs font-semibold px-3 py-2 rounded-xl">
              {authError}
            </div>
          )}

          {checkingAuthStatus ? (
            <div className="py-6 text-center text-xs text-gray-500">Checking admin setup...</div>
          ) : loginMode === 'password' || setupRequired ? (
            <form onSubmit={handlePasswordSubmit} className="space-y-3.5">
              <div>
                <label className="block text-xs font-bold text-gray-700 mb-1">Admin Email</label>
                <input
                  required
                  type="email"
                  value={emailInput}
                  onChange={(e) => setEmailInput(e.target.value)}
                  className="w-full min-h-[44px] border border-gray-300 rounded-xl px-3.5 py-2.5 text-sm focus:ring-2 focus:ring-rose-500 focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-gray-700 mb-1">
                  {setupRequired ? 'Choose Admin Password (min 8 chars)' : 'Admin Password'}
                </label>
                <input
                  required
                  type="password"
                  placeholder={setupRequired ? 'Create strong admin password' : 'Enter admin password'}
                  value={passcodeInput}
                  onChange={(e) => setPasscodeInput(e.target.value)}
                  className="w-full min-h-[44px] border border-gray-300 rounded-xl px-3.5 py-2.5 text-sm focus:ring-2 focus:ring-rose-500 focus:outline-none"
                />
              </div>

              {setupRequired && (
                <div>
                  <label className="block text-xs font-bold text-gray-700 mb-1">
                    Confirm Admin Password
                  </label>
                  <input
                    required
                    type="password"
                    placeholder="Repeat admin password"
                    value={confirmPasscodeInput}
                    onChange={(e) => setConfirmPasscodeInput(e.target.value)}
                    className="w-full min-h-[44px] border border-gray-300 rounded-xl px-3.5 py-2.5 text-sm focus:ring-2 focus:ring-rose-500 focus:outline-none"
                  />
                </div>
              )}

              <button
                type="submit"
                disabled={authSubmitting}
                className="w-full min-h-[44px] bg-rose-700 hover:bg-rose-800 disabled:opacity-60 text-white font-bold py-3 rounded-xl shadow-md transition text-sm"
              >
                {authSubmitting
                  ? 'Verifying...'
                  : setupRequired
                  ? 'Claim Admin Password & Enter'
                  : 'Sign In to Admin'}
              </button>
            </form>
          ) : !otpSent ? (
            <form onSubmit={handleSendAdminOtp} className="space-y-3.5">
              <div>
                <label className="block text-xs font-bold text-gray-700 mb-1">Admin Email</label>
                <input
                  required
                  type="email"
                  value={emailInput}
                  onChange={(e) => setEmailInput(e.target.value)}
                  className="w-full min-h-[44px] border border-gray-300 rounded-xl px-3.5 py-2.5 text-sm focus:ring-2 focus:ring-rose-500 focus:outline-none"
                />
              </div>
              <button
                type="submit"
                disabled={authSubmitting}
                className="w-full min-h-[44px] bg-rose-700 hover:bg-rose-800 disabled:opacity-60 text-white font-bold py-3 rounded-xl shadow-md transition text-sm flex items-center justify-center gap-2"
              >
                <MailCheck className="w-4 h-4" />
                {authSubmitting ? 'Sending Code...' : 'Send Admin Login Code'}
              </button>
            </form>
          ) : (
            <form onSubmit={handleVerifyAdminOtp} className="space-y-3.5">
              <div>
                <label className="block text-xs font-bold text-gray-700 mb-1">
                  Enter Email Verification Code
                </label>
                <input
                  required
                  type="text"
                  inputMode="numeric"
                  placeholder="6-digit code"
                  value={otpCode}
                  onChange={(e) => setOtpCode(e.target.value.replace(/[^0-9a-zA-Z]/g, '').slice(0, 12))}
                  className="w-full min-h-[48px] border border-gray-300 rounded-xl px-3.5 py-2.5 text-center text-lg font-mono tracking-widest focus:ring-2 focus:ring-rose-500 focus:outline-none"
                />
              </div>
              <button
                type="submit"
                disabled={authSubmitting || !otpCode.trim()}
                className="w-full min-h-[44px] bg-rose-700 hover:bg-rose-800 disabled:opacity-60 text-white font-bold py-3 rounded-xl shadow-md transition text-sm"
              >
                {authSubmitting ? 'Signing In...' : 'Verify & Enter Admin'}
              </button>
            </form>
          )}
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
          <div className="flex items-center gap-2 mb-1 text-xs text-gray-600">
            <span className="font-semibold text-emerald-700">
              Authenticated as {adminEmailLabel}
            </span>
            <span aria-hidden="true">·</span>
            <button
              onClick={() => {
                setAdminToken('')
              }}
              className="text-gray-500 hover:text-red-600 underline"
            >
              Lock Admin
            </button>
          </div>
          <h1 className="text-2xl sm:text-3xl font-black text-gray-900 flex items-center gap-2">
            <ShieldCheck className="w-7 h-7 text-rose-600" /> Admin Safety &amp; Verification
          </h1>
          <p className="text-xs sm:text-sm text-gray-500">
            Review verification selfies, approve live profiles, and moderate community reports.
          </p>
        </div>

        <div className="flex flex-wrap gap-2 bg-white p-1.5 rounded-2xl border border-gray-200 shadow-xs">
          <button
            onClick={() => setActiveTab('verifications')}
            className={`px-4 py-2 rounded-xl text-xs font-bold transition flex items-center gap-1.5 whitespace-nowrap ${
              activeTab === 'verifications'
                ? 'bg-rose-700 text-white shadow-sm'
                : 'text-gray-700 hover:bg-gray-100'
            }`}
          >
            <Camera className="w-4 h-4" /> Verification Requests ({verificationQueue.length})
          </button>
          <button
            onClick={() => setActiveTab('all')}
            className={`px-4 py-2 rounded-xl text-xs font-bold transition flex items-center gap-1.5 whitespace-nowrap ${
              activeTab === 'all' ? 'bg-rose-700 text-white shadow-sm' : 'text-gray-600 hover:bg-gray-100'
            }`}
          >
            <Users className="w-4 h-4" /> Live Members ({allActiveList.length})
          </button>
          <button
            onClick={() => setActiveTab('pending')}
            className={`px-4 py-2 rounded-xl text-xs font-bold transition flex items-center gap-1.5 whitespace-nowrap ${
              activeTab === 'pending'
                ? 'bg-rose-700 text-white shadow-sm'
                : 'text-gray-600 hover:bg-gray-100'
            }`}
          >
            <Users className="w-4 h-4" /> Pending ({pendingList.length})
          </button>
          <button
            onClick={() => setActiveTab('reports')}
            className={`px-4 py-2 rounded-xl text-xs font-bold transition flex items-center gap-1.5 whitespace-nowrap ${
              activeTab === 'reports'
                ? 'bg-amber-600 text-white shadow-sm'
                : 'text-gray-600 hover:bg-gray-100'
            }`}
          >
            <AlertTriangle className="w-4 h-4" /> Reports ({reportsList.length})
          </button>
          <button
            onClick={() => setActiveTab('events')}
            className={`px-4 py-2 rounded-xl text-xs font-bold transition flex items-center gap-1.5 whitespace-nowrap ${
              activeTab === 'events'
                ? 'bg-rose-700 text-white shadow-sm'
                : 'text-gray-600 hover:bg-gray-100'
            }`}
          >
            <CalendarDays className="w-4 h-4" /> Events ({eventsList.length})
          </button>
          <button
            type="button"
            onClick={() => void loadAdminData(adminToken)}
            disabled={loading}
            className="px-3 py-2 rounded-xl text-xs font-bold text-gray-600 hover:bg-gray-100 transition flex items-center gap-1 whitespace-nowrap"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} /> Refresh
          </button>
          <button
            type="button"
            onClick={() => setShowDiagnostics((prev) => !prev)}
            className={`px-4 py-2 rounded-xl text-xs font-bold transition flex items-center gap-1.5 whitespace-nowrap ${
              showDiagnostics ? 'bg-gray-900 text-white shadow-sm' : 'text-gray-600 hover:bg-gray-100'
            }`}
          >
            <Database className="w-4 h-4" /> Supabase Check
          </button>
        </div>
      </div>

      {showDiagnostics && (
        <div className="mb-6">
          <SupabaseDiagnosticAlert mode="panel" />
        </div>
      )}

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
      ) : activeTab === 'verifications' ? (
        verificationQueue.length === 0 ? (
          <div className="bg-white rounded-2xl p-12 text-center border border-gray-200 shadow-sm">
            <BadgeCheck className="w-12 h-12 text-emerald-600 mx-auto mb-3" />
            <h3 className="text-lg font-bold text-gray-800">No Pending Verification Selfies</h3>
            <p className="text-sm text-gray-500">
              All submitted user selfie verification requests have been reviewed.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {verificationQueue.map((p) => (
              <div
                key={p.id}
                className="bg-white rounded-2xl overflow-hidden border border-rose-200 shadow-md p-5 space-y-4"
              >
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-gray-100 pb-3">
                  <div>
                    <h3 className="text-lg font-bold text-gray-900">
                      {p.full_name}, {p.age}
                    </h3>
                    <p className="text-xs text-gray-500">
                      {p.village}, {p.municipality} · {p.gender} · {p.email || p.whatsapp}
                    </p>
                  </div>
                  <span className="text-xs font-semibold text-amber-700">
                    Requested{' '}
                    {p.verification_requested_at
                      ? new Date(p.verification_requested_at).toLocaleDateString()
                      : 'recently'}
                  </span>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <span className="block text-[11px] font-bold text-gray-500 uppercase tracking-wider">
                      Profile Photo
                    </span>
                    <div className="aspect-square rounded-xl overflow-hidden bg-gray-100 border border-gray-200">
                      <ProfileAvatar
                        src={p.photo_url}
                        name={p.full_name}
                        className="w-full h-full"
                        textSizeClass="text-2xl"
                      />
                    </div>
                  </div>

                  <div className="space-y-1.5">
                    <span className="block text-[11px] font-bold text-rose-700 uppercase tracking-wider">
                      Verification Selfie
                    </span>
                    <div className="relative aspect-square rounded-xl overflow-hidden bg-gray-100 border-2 border-rose-400">
                      {p.signed_selfie_url ? (
                        <>
                          <img
                            src={p.signed_selfie_url}
                            alt={`${p.full_name} verification selfie`}
                            className="w-full h-full object-cover"
                          />
                          <button
                            type="button"
                            onClick={() =>
                              setLightboxImage({
                                url: p.signed_selfie_url!,
                                name: `${p.full_name} — Verification Selfie`,
                              })
                            }
                            className="absolute bottom-2 right-2 bg-black/75 hover:bg-black text-white text-[11px] font-semibold px-2.5 py-1.5 rounded-lg flex items-center gap-1"
                          >
                            <Eye className="w-3.5 h-3.5" /> Zoom
                          </button>
                        </>
                      ) : (
                        <div className="w-full h-full flex items-center justify-center text-xs text-gray-400 px-3 text-center">
                          Selfie image unavailable
                        </div>
                      )}
                    </div>
                  </div>
                </div>

                <div>
                  <input
                    type="text"
                    placeholder="Optional note if declining (e.g. face unclear, please retake)..."
                    value={rejectionNotes[p.id] || ''}
                    onChange={(e) =>
                      setRejectionNotes((prev) => ({ ...prev, [p.id]: e.target.value }))
                    }
                    className="w-full min-h-[40px] border border-gray-200 rounded-xl px-3 py-2 text-xs focus:outline-none focus:ring-2 focus:ring-rose-500"
                  />
                </div>

                <div className="flex flex-wrap gap-2.5 pt-1">
                  <button
                    type="button"
                    disabled={processingId === p.id}
                    onClick={() => void handleVerificationDecision(p.id, 'approve')}
                    className="flex-1 min-h-[44px] bg-emerald-600 hover:bg-emerald-700 disabled:opacity-60 text-white font-bold py-2.5 px-4 rounded-xl text-xs transition flex items-center justify-center gap-1.5 shadow-sm"
                  >
                    <BadgeCheck className="w-4 h-4" /> Approve &amp; Mark Verified
                  </button>
                  <button
                    type="button"
                    disabled={processingId === p.id}
                    onClick={() => void handleVerificationDecision(p.id, 'reject')}
                    className="min-h-[44px] bg-gray-100 hover:bg-red-50 hover:text-red-700 disabled:opacity-60 text-gray-700 font-semibold py-2.5 px-4 rounded-xl text-xs transition flex items-center justify-center gap-1.5"
                  >
                    <X className="w-4 h-4" /> Decline
                  </button>
                </div>
              </div>
            ))}
          </div>
        )
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
            {displayedProfiles.map((p) => {
              const verified = isProfileIdentityVerified(p)
              return (
                <div
                  key={p.id}
                  className="bg-white rounded-2xl overflow-hidden border border-gray-200 shadow-md flex flex-col"
                >
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
                      <h3 className="text-lg font-bold text-gray-900 flex items-center gap-1.5">
                        <span>
                          {p.full_name}, {p.age}
                        </span>
                        {verified && <BadgeCheck className="w-4 h-4 text-emerald-600" />}
                      </h3>
                      <p className="text-xs text-gray-500 mb-2">
                        {p.village}, {p.municipality} · {p.gender} · {p.intention}
                      </p>
                      <p className="text-xs font-semibold mb-2 text-gray-600">
                        Verification:{' '}
                        <span
                          className={
                            verified
                              ? 'text-emerald-700'
                              : p.verification_status === 'pending'
                              ? 'text-amber-700'
                              : 'text-gray-500'
                          }
                        >
                          {verified
                            ? 'Verified'
                            : p.verification_status === 'pending'
                            ? 'Selfie Pending'
                            : p.verification_status === 'rejected'
                            ? 'Declined'
                            : 'Unverified'}
                        </span>
                      </p>
                      <p className="text-xs font-mono text-rose-700 bg-rose-50 px-2 py-1 rounded mb-2">
                        WhatsApp: {p.whatsapp}
                      </p>
                      <p className="text-sm text-gray-700 bg-gray-50 p-3 rounded-xl border border-gray-100 italic">
                        "{p.bio}"
                      </p>
                    </div>
                    <div className="flex gap-2 pt-2 border-t border-gray-100">
                      {!p.is_approved && (
                        <button
                          onClick={() => void approveProfileListing(p.id)}
                          disabled={processingId === p.id}
                          className="flex-1 min-h-[40px] bg-rose-600 hover:bg-rose-700 text-white font-semibold py-2 rounded-xl text-xs transition flex items-center justify-center gap-1.5 shadow-sm"
                        >
                          <Check className="w-4 h-4" /> Approve
                        </button>
                      )}
                      <button
                        onClick={() => void banProfile(p.id)}
                        disabled={processingId === p.id}
                        className="flex-1 min-h-[40px] bg-red-600 hover:bg-red-700 text-white font-semibold py-2 rounded-xl text-xs transition flex items-center justify-center gap-1.5 shadow-sm"
                      >
                        <Ban className="w-4 h-4" /> Ban User
                      </button>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        )
      ) : activeTab === 'events' ? (
        <div className="space-y-6">
          {eventsTableMissing && (
            <div className="bg-amber-50 border border-amber-200 text-amber-900 rounded-2xl p-4 text-xs sm:text-sm">
              The <code className="font-mono bg-amber-100 px-1.5 py-0.5 rounded">public.events</code> table does not exist yet in Supabase. Run the updated <code className="font-mono bg-amber-100 px-1.5 py-0.5 rounded">supabase.sql</code> in Supabase SQL Editor first.
            </div>
          )}

          <form
            onSubmit={handleCreateEvent}
            className="bg-white rounded-2xl border border-gray-200 shadow-sm p-6 space-y-4"
          >
            <h2 className="text-lg font-bold text-gray-900 flex items-center gap-2">
              <Plus className="w-5 h-5 text-rose-600" /> Publish Local Singles Event
            </h2>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              <div>
                <label className="block text-xs font-semibold text-gray-700 mb-1">Event Title</label>
                <input
                  required
                  type="text"
                  placeholder="e.g. Tzaneen Friday Coffee Mixer"
                  value={eventForm.title}
                  onChange={(e) => setEventForm((prev) => ({ ...prev, title: e.target.value }))}
                  className="w-full min-h-[42px] border border-gray-300 rounded-xl px-3 py-2 text-sm focus:ring-2 focus:ring-rose-500 focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-gray-700 mb-1">Municipality</label>
                <select
                  value={eventForm.municipality}
                  onChange={(e) =>
                    setEventForm((prev) => ({ ...prev, municipality: e.target.value }))
                  }
                  className="w-full min-h-[42px] border border-gray-300 rounded-xl px-3 py-2 text-sm bg-white focus:ring-2 focus:ring-rose-500 focus:outline-none"
                >
                  <option value="Greater Tzaneen">Greater Tzaneen</option>
                  <option value="Maruleng">Maruleng</option>
                  <option value="Ba-Phalaborwa">Ba-Phalaborwa</option>
                  <option value="Greater Letaba">Greater Letaba</option>
                  <option value="Greater Giyani">Greater Giyani</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-gray-700 mb-1">Public Venue</label>
                <input
                  required
                  type="text"
                  placeholder="e.g. Tzaneen Lifestyle Centre"
                  value={eventForm.venue}
                  onChange={(e) => setEventForm((prev) => ({ ...prev, venue: e.target.value }))}
                  className="w-full min-h-[42px] border border-gray-300 rounded-xl px-3 py-2 text-sm focus:ring-2 focus:ring-rose-500 focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-gray-700 mb-1">Date &amp; Time</label>
                <input
                  required
                  type="datetime-local"
                  value={eventForm.event_date}
                  onChange={(e) =>
                    setEventForm((prev) => ({ ...prev, event_date: e.target.value }))
                  }
                  className="w-full min-h-[42px] border border-gray-300 rounded-xl px-3 py-2 text-sm focus:ring-2 focus:ring-rose-500 focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-gray-700 mb-1">Category</label>
                <select
                  value={eventForm.category}
                  onChange={(e) =>
                    setEventForm((prev) => ({ ...prev, category: e.target.value }))
                  }
                  className="w-full min-h-[42px] border border-gray-300 rounded-xl px-3 py-2 text-sm bg-white focus:ring-2 focus:ring-rose-500 focus:outline-none"
                >
                  <option value="Community Meet-Up">Community Meet-Up</option>
                  <option value="Coffee Mixer">Coffee Mixer</option>
                  <option value="Brunch Meet-Up">Brunch Meet-Up</option>
                  <option value="Social Evening">Social Evening</option>
                  <option value="Outdoor Walk">Outdoor Walk</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-gray-700 mb-1">Host Name</label>
                <input
                  type="text"
                  placeholder="Mopani Singles Community"
                  value={eventForm.host_name}
                  onChange={(e) =>
                    setEventForm((prev) => ({ ...prev, host_name: e.target.value }))
                  }
                  className="w-full min-h-[42px] border border-gray-300 rounded-xl px-3 py-2 text-sm focus:ring-2 focus:ring-rose-500 focus:outline-none"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold text-gray-700 mb-1">Description</label>
              <textarea
                rows={2}
                placeholder="Short details on dress code, icebreakers, or meeting spot..."
                value={eventForm.description}
                onChange={(e) =>
                  setEventForm((prev) => ({ ...prev, description: e.target.value }))
                }
                className="w-full border border-gray-300 rounded-xl px-3 py-2 text-sm focus:ring-2 focus:ring-rose-500 focus:outline-none"
              />
            </div>

            <button
              type="submit"
              disabled={savingEvent}
              className="min-h-[44px] bg-rose-700 hover:bg-rose-800 disabled:opacity-60 text-white font-bold px-5 py-2.5 rounded-xl text-xs transition shadow-sm flex items-center gap-1.5"
            >
              <CalendarDays className="w-4 h-4" />
              {savingEvent ? 'Publishing...' : 'Publish Event'}
            </button>
          </form>

          {eventsList.length === 0 ? (
            <div className="bg-white rounded-2xl p-10 text-center border border-gray-200">
              <CalendarDays className="w-10 h-10 text-rose-300 mx-auto mb-2" />
              <p className="text-sm font-semibold text-gray-800">No events published yet.</p>
            </div>
          ) : (
            <div className="space-y-3">
              {eventsList.map((ev) => (
                <div
                  key={ev.id}
                  className="bg-white rounded-2xl p-5 border border-gray-200 shadow-xs flex flex-col sm:flex-row sm:items-center justify-between gap-4"
                >
                  <div className="space-y-1">
                    <div className="text-xs font-semibold text-rose-700">
                      {ev.category} · {ev.municipality} ·{' '}
                      <span className="tabular-nums">
                        {new Date(ev.event_date).toLocaleString()}
                      </span>
                    </div>
                    <h3 className="text-base font-bold text-gray-900">{ev.title}</h3>
                    <p className="text-xs text-gray-600">
                      {ev.venue} · Hosted by {ev.host_name}
                    </p>
                    {ev.description && (
                      <p className="text-xs text-gray-500 pt-0.5">{ev.description}</p>
                    )}
                  </div>
                  <button
                    type="button"
                    disabled={processingId === ev.id}
                    onClick={() => void handleDeleteEvent(ev.id)}
                    className="self-start sm:self-center min-h-[40px] px-3.5 py-2 rounded-xl bg-red-50 hover:bg-red-100 text-red-700 text-xs font-semibold flex items-center gap-1.5 transition whitespace-nowrap"
                  >
                    <Trash2 className="w-3.5 h-3.5" /> Remove
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      ) : reportsList.length === 0 ? (
        <div className="bg-white rounded-2xl p-12 text-center border border-gray-200 shadow-sm">
          <Check className="w-12 h-12 text-rose-600 mx-auto mb-3" />
          <h3 className="text-lg font-bold text-gray-800">No Reports</h3>
          <p className="text-sm text-gray-500">No community safety reports submitted.</p>
        </div>
      ) : (
        <div className="space-y-4">
          {reportsList.map((r, i) => (
            <div
              key={i}
              className="bg-white rounded-2xl p-5 border border-amber-200 shadow-sm flex items-start justify-between gap-4"
            >
              <div className="space-y-1">
                <div className="flex items-center gap-2 text-xs">
                  <span className="text-amber-800 font-bold flex items-center gap-1">
                    <AlertTriangle className="w-3.5 h-3.5" /> Reported ID: {r.reported_id}
                  </span>
                  <span aria-hidden="true">·</span>
                  <span className="text-gray-400">
                    {new Date(r.created_at || Date.now()).toLocaleString()}
                  </span>
                </div>
                <p className="text-sm text-gray-800 font-medium mt-2">Reason: "{r.reason}"</p>
              </div>
              <button
                onClick={() => void banProfile(r.reported_id)}
                className="min-h-[40px] bg-red-600 text-white px-4 py-2 rounded-xl text-xs font-semibold hover:bg-red-700 transition shadow-sm whitespace-nowrap"
              >
                Ban Reported User
              </button>
            </div>
          ))}
        </div>
      )}

      {lightboxImage && (
        <div
          onClick={() => setLightboxImage(null)}
          className="fixed inset-0 z-50 bg-black/80 backdrop-blur-xs flex items-center justify-center p-4"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="bg-white rounded-3xl max-w-lg w-full p-4 space-y-3 shadow-2xl"
          >
            <div className="flex items-center justify-between">
              <p className="text-sm font-bold text-gray-900">{lightboxImage.name}</p>
              <button
                type="button"
                onClick={() => setLightboxImage(null)}
                className="min-h-[40px] min-w-[40px] flex items-center justify-center rounded-xl text-gray-500 hover:bg-gray-100"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <img
              src={lightboxImage.url}
              alt={lightboxImage.name}
              className="w-full max-h-[70vh] object-contain rounded-2xl bg-gray-900"
            />
          </div>
        </div>
      )}
    </div>
  )
}
