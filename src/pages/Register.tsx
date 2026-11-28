import React, { useCallback, useEffect, useState } from 'react'
import { ImageCropperModal } from '@/components/ImageCropperModal'
import { BackButton } from '@/components/BackButton'
import { SupabaseDiagnosticAlert } from '@/components/SupabaseDiagnosticAlert'
import { RestoreProfileModal } from '@/components/RestoreProfileModal'
import {
  getLatestVerifiedEmailSession,
  getVerifiedAuthToken,
  sendEmailVerificationOtp,
  verifyEmailOtpCode,
} from '@/lib/supabase'
import {
  uploadDataUrlToSupabase,
  uploadProfilePhotoBlob,
} from '@/lib/supabase/storage'
import {
  Profile,
  addMyProfile,
  generateProfileId,
  getMyProfiles,
  saveProfileToSupabase,
} from '@/utils/profileStorage'
import {
  AlertCircle,
  ArrowLeft,
  Camera,
  CheckCircle2,
  Database,
  MailCheck,
  RefreshCw,
  ShieldCheck,
  UserPlus,
  KeyRound,
} from 'lucide-react'
import { MOPANI_VILLAGES } from '@/data/mopaniLocations'

const VILLAGES = MOPANI_VILLAGES

const PENDING_DRAFT_KEY = 'mopani_pending_registration_draft'

const initialFormState = {
  full_name: '',
  age: 25,
  gender: 'Female',
  municipality: 'Greater Tzaneen',
  village: 'Nkowankowa',
  language: 'Sepedi',
  intention: 'Marriage',
  bio: '',
  whatsapp: '',
  email: '',
  email_notifications: true,
  photo_url: '',
  consent_popia: false,
}

type RegistrationFormState = typeof initialFormState

function savePendingDraft(form: RegistrationFormState): void {
  try {
    sessionStorage.setItem(PENDING_DRAFT_KEY, JSON.stringify(form))
  } catch {
    // ignore storage quota errors
  }
}

function loadPendingDraft(): RegistrationFormState | null {
  try {
    const raw = sessionStorage.getItem(PENDING_DRAFT_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<RegistrationFormState>
    if (!parsed || typeof parsed !== 'object') return null
    return { ...initialFormState, ...parsed }
  } catch {
    return null
  }
}

function clearPendingDraft(): void {
  try {
    sessionStorage.removeItem(PENDING_DRAFT_KEY)
  } catch {
    // ignore
  }
}

export function Register({
  onComplete,
  onGoMyProfile,
  onBack,
  authLinkStatus,
}: {
  onComplete: () => void
  onGoMyProfile: () => void
  onBack: () => void
  authLinkStatus?: { verified: boolean; email?: string; error?: string } | null
}) {
  const [form, setForm] = useState<RegistrationFormState>(() => loadPendingDraft() || initialFormState)
  const [photoBlob, setPhotoBlob] = useState<Blob | null>(null)
  const [existingProfile, setExistingProfile] = useState<Profile | null>(
    () => getMyProfiles()[0] || null
  )
  const [cropperOpen, setCropperOpen] = useState(false)

  const [step, setStep] = useState<'details' | 'verify' | 'complete'>('details')
  const [otpCode, setOtpCode] = useState('')
  const [cooldown, setCooldown] = useState(0)
  const [sendingOtp, setSendingOtp] = useState(false)
  const [submitting, setSubmitting] = useState(false)

  const [errorMsg, setErrorMsg] = useState('')
  const [infoMsg, setInfoMsg] = useState('')
  const [syncNotice, setSyncNotice] = useState('')
  const [showDiagnostics, setShowDiagnostics] = useState(false)
  const [restoreModalOpen, setRestoreModalOpen] = useState(false)

  useEffect(() => {
    if (cooldown <= 0) return
    const timer = window.setInterval(() => {
      setCooldown((prev) => (prev <= 1 ? 0 : prev - 1))
    }, 1000)
    return () => window.clearInterval(timer)
  }, [cooldown])

  const publishVerifiedProfile = useCallback(
    async (
      sourceForm: RegistrationFormState,
      sourceBlob: Blob | null,
      authToken: string,
      authUserId: string,
      verifiedEmail: string
    ) => {
      setSubmitting(true)
      setErrorMsg('')
      setSyncNotice('')
      try {
        const profileId = generateProfileId()

        const uploadResult = sourceBlob
          ? await uploadProfilePhotoBlob(sourceBlob, profileId)
          : await uploadDataUrlToSupabase(sourceForm.photo_url, 'profiles', `${profileId}.jpg`)

        const resolvedPhotoUrl = uploadResult.url || sourceForm.photo_url

        const payload: Profile = {
          id: profileId,
          full_name: sourceForm.full_name.trim(),
          age: sourceForm.age,
          gender: sourceForm.gender,
          municipality: sourceForm.municipality,
          village: sourceForm.village,
          language: sourceForm.language,
          intention: sourceForm.intention,
          bio: sourceForm.bio.trim(),
          whatsapp: sourceForm.whatsapp.trim(),
          email: verifiedEmail.trim().toLowerCase(),
          email_verified: true,
          auth_user_id: authUserId,
          email_notifications: sourceForm.email_notifications,
          photo_url: resolvedPhotoUrl,
          consent_popia: sourceForm.consent_popia,
          is_approved: true,
          is_banned: false,
          created_at: new Date().toISOString(),
        }

        const { profile: savedProfile, syncedToSupabase, error: dbError } =
          await saveProfileToSupabase(payload, { authToken })

        if (!syncedToSupabase) {
          setErrorMsg(dbError || 'Could not publish your verified profile right now. Please try again.')
          return
        }

        if (!uploadResult.storedInSupabase && uploadResult.error) {
          setSyncNotice(`Profile published, with photo storage notice: ${uploadResult.error}`)
        }

        clearPendingDraft()
        const finalProfile: Profile = {
          ...savedProfile,
          email: verifiedEmail.trim().toLowerCase(),
          email_verified: true,
          auth_user_id: authUserId,
        }
        const updatedList = addMyProfile(finalProfile)
        setExistingProfile(updatedList[0] || finalProfile)
        setStep('complete')
      } catch (err: unknown) {
        setErrorMsg(
          'Submission error: ' + (err instanceof Error ? err.message : 'Unable to save profile')
        )
      } finally {
        setSubmitting(false)
      }
    },
    []
  )

  useEffect(() => {
    if (!authLinkStatus) return
    if (authLinkStatus.error) {
      setErrorMsg(authLinkStatus.error)
      return
    }
    if (authLinkStatus.verified && authLinkStatus.email) {
      const session = getLatestVerifiedEmailSession()
      const draft = loadPendingDraft()
      if (
        session &&
        draft &&
        draft.full_name.trim() &&
        draft.bio.trim() &&
        draft.whatsapp.trim() &&
        draft.photo_url &&
        draft.consent_popia &&
        draft.email.trim().toLowerCase() === authLinkStatus.email.toLowerCase()
      ) {
        setForm(draft)
        void publishVerifiedProfile(
          draft,
          null,
          session.accessToken,
          session.authUserId,
          session.email
        )
      } else {
        setForm((prev) => ({ ...prev, email: authLinkStatus.email || prev.email }))
        setInfoMsg(
          `Email ${authLinkStatus.email} is confirmed! Complete your profile details below to publish.`
        )
      }
    }
  }, [authLinkStatus, publishVerifiedProfile])

  const handleCropComplete = (croppedBase64: string, blob?: Blob) => {
    setForm((prev) => ({ ...prev, photo_url: croppedBase64 }))
    setPhotoBlob(blob || null)
    setErrorMsg('')
  }

  const validateDetailsStep = (): string | null => {
    if (form.age < 18) return 'You must be 18+ to register.'
    if (!form.consent_popia) return 'POPIA consent is required.'
    if (!form.photo_url) return 'Please upload and crop a profile photo.'
    const cleanEmail = form.email.trim().toLowerCase()
    if (!cleanEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
      return 'Please enter a valid email address for Supabase verification.'
    }
    return null
  }

  const handleContinueToVerification = async (e: React.FormEvent) => {
    e.preventDefault()
    setErrorMsg('')
    setInfoMsg('')

    const validationError = validateDetailsStep()
    if (validationError) {
      setErrorMsg(validationError)
      return
    }

    const cleanEmail = form.email.trim().toLowerCase()
    savePendingDraft({ ...form, email: cleanEmail })

    // If this email was already verified in the current session via confirmation link
    const existingToken = getVerifiedAuthToken(cleanEmail)
    const latestSession = getLatestVerifiedEmailSession()
    if (existingToken && latestSession?.email === cleanEmail) {
      await publishVerifiedProfile(
        { ...form, email: cleanEmail },
        photoBlob,
        existingToken,
        latestSession.authUserId,
        cleanEmail
      )
      return
    }

    setSendingOtp(true)
    try {
      const otpRes = await sendEmailVerificationOtp(cleanEmail)
      if (!otpRes.ok) {
        setErrorMsg(otpRes.error || 'Could not send verification email.')
        return
      }
      setCooldown(60)
      setOtpCode('')
      setInfoMsg(
        `We sent a verification code and confirmation link to ${cleanEmail}. Check your inbox or spam folder.`
      )
      setStep('verify')
    } finally {
      setSendingOtp(false)
    }
  }

  const handleResendCode = async () => {
    if (cooldown > 0 || sendingOtp) return
    setErrorMsg('')
    setInfoMsg('')
    const cleanEmail = form.email.trim().toLowerCase()
    setSendingOtp(true)
    try {
      const otpRes = await sendEmailVerificationOtp(cleanEmail)
      if (!otpRes.ok) {
        setErrorMsg(otpRes.error || 'Could not resend verification email.')
        return
      }
      setCooldown(60)
      setInfoMsg(`A fresh verification email has been sent to ${cleanEmail}.`)
    } finally {
      setSendingOtp(false)
    }
  }

  const handleVerifyOtpAndPublish = async (e: React.FormEvent) => {
    e.preventDefault()
    setErrorMsg('')

    const cleanEmail = form.email.trim().toLowerCase()
    if (!otpCode.trim()) {
      setErrorMsg('Please enter the verification code from your email.')
      return
    }

    setSubmitting(true)
    try {
      const verifyRes = await verifyEmailOtpCode(cleanEmail, otpCode)
      if (!verifyRes.ok || !verifyRes.accessToken || !verifyRes.user) {
        setErrorMsg(verifyRes.error || 'Invalid or expired verification code.')
        setSubmitting(false)
        return
      }

      await publishVerifiedProfile(
        { ...form, email: verifyRes.user.email },
        photoBlob,
        verifyRes.accessToken,
        verifyRes.user.id,
        verifyRes.user.email
      )
    } catch (err: unknown) {
      setErrorMsg(err instanceof Error ? err.message : 'Unable to verify email code.')
      setSubmitting(false)
    }
  }

  if (step === 'complete') {
    return (
      <div className="max-w-xl mx-auto px-4 py-16 text-center">
        <BackButton onClick={onBack} label="Back to Discover" />
        <div className="bg-white rounded-3xl p-8 md:p-12 shadow-xl border border-rose-100 space-y-6">
          <div className="w-16 h-16 bg-emerald-100 text-emerald-700 rounded-full flex items-center justify-center mx-auto">
            <CheckCircle2 className="w-10 h-10" />
          </div>
          <h2 className="text-2xl font-black text-gray-900">Email Verified &amp; Profile Live</h2>
          <p className="text-sm text-gray-600 leading-relaxed">
            Your email ({form.email.trim().toLowerCase()}) has been verified through Supabase Auth and your profile is active. You can request selfie verification from My Profile anytime, and connect privately with other Mopani Singles members.
          </p>
          {syncNotice && (
            <div className="space-y-4 text-left">
              <div className="bg-amber-50 border border-amber-200 text-amber-800 text-xs rounded-2xl p-3">
                {syncNotice}
              </div>
              <SupabaseDiagnosticAlert mode="panel" />
            </div>
          )}
          <div className="pt-4 flex flex-wrap gap-3 justify-center">
            <button
              onClick={onGoMyProfile}
              className="min-h-[44px] bg-rose-700 hover:bg-rose-800 text-white font-semibold px-6 py-3 rounded-2xl shadow-md transition text-sm"
            >
              View My Profile
            </button>
            <button
              onClick={onComplete}
              className="min-h-[44px] bg-gray-100 hover:bg-gray-200 text-gray-700 font-semibold px-5 py-3 rounded-2xl transition text-sm"
            >
              Go to Discover
            </button>
          </div>
        </div>
      </div>
    )
  }

  if (existingProfile) {
    return (
      <div className="max-w-xl mx-auto px-4 py-16 text-center">
        <BackButton onClick={onBack} label="Back to Discover" />
        <div className="bg-white rounded-3xl p-8 md:p-10 shadow-xl border border-rose-100 space-y-5">
          <div className="w-14 h-14 bg-rose-100 text-rose-700 rounded-full flex items-center justify-center mx-auto">
            <ShieldCheck className="w-7 h-7" />
          </div>
          <h2 className="text-2xl font-black text-gray-900">One Profile Per User</h2>
          <p className="text-sm text-gray-600 leading-relaxed">
            You already have an active profile for <strong className="text-gray-900">{existingProfile.full_name}</strong> ({existingProfile.village}, {existingProfile.municipality}). Each member is limited to one profile to keep the community authentic.
          </p>
          <div className="pt-2 flex flex-wrap gap-3 justify-center">
            <button
              type="button"
              onClick={onGoMyProfile}
              className="min-h-[44px] bg-rose-700 hover:bg-rose-800 text-white font-bold px-6 py-3 rounded-2xl shadow-md transition text-sm"
            >
              Manage My Profile
            </button>
            <button
              type="button"
              onClick={onBack}
              className="min-h-[44px] bg-gray-100 hover:bg-gray-200 text-gray-700 font-semibold px-5 py-3 rounded-2xl transition text-sm"
            >
              Back to Discover
            </button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="max-w-2xl mx-auto px-4 py-8">
      <BackButton onClick={onBack} label="Back to Discover" />

      <div className="bg-white rounded-3xl p-6 sm:p-10 shadow-xl border border-rose-100">
        <div className="text-center mb-6">
          <div className="inline-flex items-center gap-2 text-rose-700 text-xs font-semibold mb-2">
            <ShieldCheck className="w-4 h-4" />
            <span>18+ Verified Community</span>
            <span aria-hidden="true">·</span>
            <span>One Profile Per User</span>
          </div>
          <h1 className="text-2xl sm:text-3xl font-black text-gray-900">
            Create Your Mopani Singles Profile
          </h1>
          <p className="text-xs sm:text-sm text-gray-500 mt-1">
            {step === 'details'
              ? 'Complete your profile and verify your email address before connecting with others.'
              : 'Enter the verification code sent to your email to publish your profile.'}
          </p>

          <div className="mt-5 flex items-center justify-center gap-6 border-b border-gray-100 pb-3 text-xs font-semibold">
            <span
              className={`pb-2 border-b-2 transition ${
                step === 'details'
                  ? 'border-rose-700 text-rose-800'
                  : 'border-transparent text-emerald-700'
              }`}
            >
              01. Profile &amp; Contact Details
            </span>
            <span
              className={`pb-2 border-b-2 transition ${
                step === 'verify'
                  ? 'border-rose-700 text-rose-800'
                  : 'border-transparent text-gray-400'
              }`}
            >
              02. Verify Email
            </span>
          </div>

          <div className="mt-3 flex flex-wrap items-center justify-center gap-4">
            <button
              type="button"
              onClick={() => setRestoreModalOpen(true)}
              className="inline-flex items-center gap-1.5 text-xs font-bold text-rose-700 hover:text-rose-900 underline transition"
            >
              <KeyRound className="w-3.5 h-3.5" /> Already have a profile? Sign in with Email
            </button>
            <button
              type="button"
              onClick={() => setShowDiagnostics((prev) => !prev)}
              className="inline-flex items-center gap-1.5 text-xs font-semibold text-gray-600 hover:text-rose-700 underline transition"
            >
              <Database className="w-3.5 h-3.5" />
              {showDiagnostics ? 'Hide Supabase Connection Check' : 'Check Supabase Connection'}
            </button>
          </div>
        </div>

        {showDiagnostics && (
          <div className="mb-6">
            <SupabaseDiagnosticAlert mode="panel" />
          </div>
        )}

        {errorMsg && (
          <div className="mb-5 bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-xl text-xs font-semibold flex items-start gap-2">
            <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
            <span>{errorMsg}</span>
          </div>
        )}

        {infoMsg && (
          <div className="mb-5 bg-emerald-50 border border-emerald-200 text-emerald-800 px-4 py-3 rounded-xl text-xs font-semibold flex items-start gap-2">
            <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" />
            <span>{infoMsg}</span>
          </div>
        )}

        {step === 'verify' ? (
          <form onSubmit={handleVerifyOtpAndPublish} className="space-y-6">
            <div className="bg-rose-50/50 border border-rose-100 rounded-2xl p-5 text-center space-y-2">
              <div className="w-12 h-12 rounded-full bg-rose-100 text-rose-700 flex items-center justify-center mx-auto">
                <MailCheck className="w-6 h-6" />
              </div>
              <h2 className="text-lg font-bold text-gray-900">Check Your Email Inbox</h2>
              <p className="text-xs sm:text-sm text-gray-600">
                Verification email sent to{' '}
                <strong className="text-gray-900">{form.email.trim().toLowerCase()}</strong>.
                Enter the verification code below or open the confirmation link in that email.
              </p>
            </div>

            <div>
              <label className="block text-xs font-bold text-gray-700 mb-1.5">
                Verification Code *
              </label>
              <input
                required
                type="text"
                inputMode="numeric"
                autoComplete="one-time-code"
                placeholder="Enter 6-digit code"
                value={otpCode}
                onChange={(e) => setOtpCode(e.target.value.replace(/[^0-9a-zA-Z]/g, '').slice(0, 12))}
                className="w-full min-h-[52px] border border-gray-300 rounded-xl px-4 py-3 text-center text-xl font-mono tabular-nums tracking-widest focus:ring-2 focus:ring-rose-500 focus:outline-none"
              />
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3 text-xs">
              <button
                type="button"
                onClick={() => {
                  setStep('details')
                  setErrorMsg('')
                  setInfoMsg('')
                }}
                className="min-h-[44px] inline-flex items-center gap-1.5 text-gray-600 hover:text-gray-900 font-semibold"
              >
                <ArrowLeft className="w-4 h-4" /> Edit Details or Email
              </button>

              <button
                type="button"
                disabled={cooldown > 0 || sendingOtp}
                onClick={() => void handleResendCode()}
                className="min-h-[44px] inline-flex items-center gap-1.5 text-rose-700 hover:underline disabled:text-gray-400 disabled:no-underline font-semibold tabular-nums"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${sendingOtp ? 'animate-spin' : ''}`} />
                {cooldown > 0 ? `Resend in ${cooldown}s` : 'Resend Verification Email'}
              </button>
            </div>

            <button
              type="submit"
              disabled={submitting || !otpCode.trim()}
              className="w-full min-h-[48px] bg-rose-700 hover:bg-rose-800 disabled:opacity-60 text-white font-bold py-3.5 rounded-2xl shadow-lg transition flex items-center justify-center gap-2 text-sm"
            >
              <CheckCircle2 className="w-4 h-4" />
              {submitting ? 'Verifying & Publishing Profile...' : 'Verify Email & Publish Profile'}
            </button>
          </form>
        ) : (
          <form onSubmit={handleContinueToVerification} className="space-y-5">
            <div className="flex flex-col items-center justify-center bg-rose-50/50 border-2 border-dashed border-rose-200 rounded-2xl p-6 text-center">
              {form.photo_url ? (
                <div className="relative mb-3">
                  <img
                    src={form.photo_url}
                    alt="Profile Preview"
                    className="w-28 h-28 rounded-full object-cover border-4 border-rose-600 shadow-md"
                  />
                  <button
                    type="button"
                    onClick={() => setCropperOpen(true)}
                    className="absolute bottom-0 right-0 bg-gray-900 text-white p-1.5 rounded-full shadow-md text-xs hover:bg-black"
                  >
                    <Camera className="w-3.5 h-3.5" />
                  </button>
                </div>
              ) : (
                <div
                  onClick={() => setCropperOpen(true)}
                  className="w-24 h-24 rounded-full bg-rose-100 flex items-center justify-center text-rose-700 mb-3 cursor-pointer hover:bg-rose-200 transition shadow-inner"
                >
                  <Camera className="w-8 h-8" />
                </div>
              )}
              <p className="text-sm font-bold text-gray-800">Profile Picture (Required)</p>
              <p className="text-xs text-gray-500 mb-3">
                Cropped square (max 500×500 px) and uploaded to Supabase &apos;profiles&apos; bucket
              </p>
              <button
                type="button"
                onClick={() => setCropperOpen(true)}
                className="min-h-[44px] bg-rose-700 hover:bg-rose-800 text-white text-xs font-semibold px-4 py-2 rounded-xl shadow-sm transition flex items-center gap-1.5"
              >
                <Camera className="w-3.5 h-3.5" /> {form.photo_url ? 'Change & Crop Photo' : 'Upload & Crop Photo'}
              </button>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-bold text-gray-700 mb-1">Full Name / First Name *</label>
                <input
                  required
                  type="text"
                  placeholder="e.g. Thabo Mabaso"
                  value={form.full_name}
                  onChange={(e) => setForm({ ...form, full_name: e.target.value })}
                  className="w-full min-h-[44px] border border-gray-300 rounded-xl p-3 text-sm focus:ring-2 focus:ring-rose-500 focus:outline-none"
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-gray-700 mb-1">Age (18+) *</label>
                <select
                  required
                  value={form.age}
                  onChange={(e) => setForm({ ...form, age: parseInt(e.target.value, 10) || 25 })}
                  className="w-full min-h-[44px] border border-gray-300 rounded-xl p-3 text-sm focus:ring-2 focus:ring-rose-500 focus:outline-none bg-white"
                >
                  {Array.from({ length: 53 }, (_, i) => i + 18).map((ageNum) => (
                    <option key={ageNum} value={ageNum}>{ageNum} Years Old</option>
                  ))}
                </select>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-bold text-gray-700 mb-1">Gender *</label>
                <select
                  required
                  value={form.gender}
                  onChange={(e) => setForm({ ...form, gender: e.target.value })}
                  className="w-full min-h-[44px] border border-gray-300 rounded-xl p-3 text-sm focus:ring-2 focus:ring-rose-500 focus:outline-none bg-white"
                >
                  <option value="Male">Male</option>
                  <option value="Female">Female</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-bold text-gray-700 mb-1">Relationship Intention *</label>
                <select
                  required
                  value={form.intention}
                  onChange={(e) => setForm({ ...form, intention: e.target.value })}
                  className="w-full min-h-[44px] border border-gray-300 rounded-xl p-3 text-sm focus:ring-2 focus:ring-rose-500 focus:outline-none bg-white"
                >
                  <option value="Marriage">Marriage</option>
                  <option value="Dating">Dating</option>
                  <option value="Friendship">Friendship</option>
                </select>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-bold text-gray-700 mb-1">Municipality *</label>
                <select
                  required
                  value={form.municipality}
                  onChange={(e) => {
                    const mun = e.target.value
                    const firstVil = VILLAGES[mun]?.[0] || ''
                    setForm({ ...form, municipality: mun, village: firstVil })
                  }}
                  className="w-full min-h-[44px] border border-gray-300 rounded-xl p-3 text-sm focus:ring-2 focus:ring-rose-500 focus:outline-none bg-white"
                >
                  {Object.keys(VILLAGES).map((m) => (
                    <option key={m} value={m}>{m}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-bold text-gray-700 mb-1">Village / Town *</label>
                <select
                  required
                  value={form.village}
                  onChange={(e) => setForm({ ...form, village: e.target.value })}
                  className="w-full min-h-[44px] border border-gray-300 rounded-xl p-3 text-sm focus:ring-2 focus:ring-rose-500 focus:outline-none bg-white"
                >
                  {VILLAGES[form.municipality]?.map((v) => (
                    <option key={v} value={v}>{v}</option>
                  ))}
                </select>
              </div>
            </div>

            <div>
              <label className="block text-xs font-bold text-gray-700 mb-1">Language *</label>
              <select
                required
                value={form.language}
                onChange={(e) => setForm({ ...form, language: e.target.value })}
                className="w-full min-h-[44px] border border-gray-300 rounded-xl p-3 text-sm focus:ring-2 focus:ring-rose-500 focus:outline-none bg-white"
              >
                <option value="Sepedi">Sepedi</option>
                <option value="Xitsonga">Xitsonga</option>
                <option value="Tshivenda">Tshivenda</option>
                <option value="English">English</option>
              </select>
            </div>

            <div>
              <div className="flex justify-between items-center mb-1">
                <label className="block text-xs font-bold text-gray-700">Bio (Max 200 characters) *</label>
                <span className={`text-xs tabular-nums ${form.bio.length > 200 ? 'text-red-500 font-bold' : 'text-gray-400'}`}>
                  {form.bio.length}/200
                </span>
              </div>
              <textarea
                required
                maxLength={200}
                rows={3}
                placeholder="Tell us about yourself... No nude content, no phone numbers in bio."
                value={form.bio}
                onChange={(e) => setForm({ ...form, bio: e.target.value })}
                className="w-full border border-gray-300 rounded-xl p-3 text-sm focus:ring-2 focus:ring-rose-500 focus:outline-none"
              />
            </div>

            <div>
              <label className="block text-xs font-bold text-gray-700 mb-1">WhatsApp Number (Private, used for direct chat button only) *</label>
              <input
                required
                type="text"
                placeholder="e.g. 27821234567 or 0821234567"
                value={form.whatsapp}
                onChange={(e) => setForm({ ...form, whatsapp: e.target.value })}
                className="w-full min-h-[44px] border border-gray-300 rounded-xl p-3 text-sm focus:ring-2 focus:ring-rose-500 focus:outline-none"
              />
              <p className="text-[11px] text-gray-500 mt-1">Your WhatsApp number is kept private and secure. It is only opened when someone connects with you.</p>
            </div>

            <div>
              <label className="block text-xs font-bold text-gray-700 mb-1">
                Email Address (Required for Supabase Auth Verification &amp; Message Alerts) *
              </label>
              <input
                required
                type="email"
                placeholder="e.g. you@example.com"
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
                className="w-full min-h-[44px] border border-gray-300 rounded-xl p-3 text-sm focus:ring-2 focus:ring-rose-500 focus:outline-none"
              />
              <p className="text-[11px] text-gray-500 mt-1">
                We will send a Supabase Auth verification code to confirm your contact details before publishing.
              </p>
              <label className="mt-2 flex items-center gap-2 text-xs text-gray-600 cursor-pointer">
                <input
                  type="checkbox"
                  checked={form.email_notifications}
                  onChange={(e) => setForm({ ...form, email_notifications: e.target.checked })}
                  className="w-4 h-4 text-rose-600 rounded accent-rose-600"
                />
                <span>Send me an email alert whenever I receive a new private chat message</span>
              </label>
            </div>

            <div className="bg-rose-50/70 p-4 rounded-2xl border border-rose-200 flex items-start gap-3">
              <input
                required
                type="checkbox"
                id="popia"
                checked={form.consent_popia}
                onChange={(e) => setForm({ ...form, consent_popia: e.target.checked })}
                className="mt-1 w-4 h-4 text-rose-600 rounded accent-rose-600"
              />
              <label htmlFor="popia" className="text-xs text-gray-700 leading-relaxed cursor-pointer">
                <strong className="text-gray-900 font-bold">POPIA &amp; Safety Consent:</strong> I confirm I am 18+, consent to the processing of my personal info under POPIA, agree to no nude/inappropriate content, and understand I can request deletion anytime.
              </label>
            </div>

            <button
              type="submit"
              disabled={sendingOtp || submitting}
              className="w-full min-h-[48px] bg-rose-700 hover:bg-rose-800 text-white font-bold py-3.5 rounded-2xl shadow-lg transition flex items-center justify-center gap-2 text-sm disabled:opacity-60"
            >
              <UserPlus className="w-4 h-4" />
              {sendingOtp
                ? 'Sending Verification Email...'
                : submitting
                ? 'Publishing Verified Profile...'
                : 'Continue & Verify Email'}
            </button>
          </form>
        )}
      </div>

      <ImageCropperModal
        isOpen={cropperOpen}
        onClose={() => setCropperOpen(false)}
        onCropComplete={handleCropComplete}
      />

      <RestoreProfileModal
        isOpen={restoreModalOpen}
        initialEmail={form.email}
        onClose={() => setRestoreModalOpen(false)}
        onRestored={(restoredProfile) => {
          setExistingProfile(restoredProfile)
          setRestoreModalOpen(false)
          onGoMyProfile()
        }}
        onNeedsRegistration={(verifiedEmail) => {
          setForm((prev) => ({ ...prev, email: verifiedEmail }))
          setInfoMsg(
            `Email ${verifiedEmail} is verified! Complete your profile details below to publish.`
          )
          setRestoreModalOpen(false)
        }}
      />
    </div>
  )
}
