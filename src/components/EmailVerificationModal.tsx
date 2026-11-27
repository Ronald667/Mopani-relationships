import React, { useEffect, useState } from 'react'
import {
  AlertCircle,
  CheckCircle2,
  MailCheck,
  RefreshCw,
  ShieldCheck,
  X,
} from 'lucide-react'
import { sendEmailVerificationOtp, verifyEmailOtpCode } from '@/lib/supabase'
import { Profile, saveProfileToSupabase, updateMyProfile } from '@/utils/profileStorage'

interface EmailVerificationModalProps {
  isOpen: boolean
  profile: Profile | null
  title?: string
  description?: string
  onClose: () => void
  onVerified: (updatedProfile: Profile) => void
}

export function EmailVerificationModal({
  isOpen,
  profile,
  title = 'Verify Your Email to Connect',
  description = 'Confirm your email address with Supabase Auth so other members know your contact details are authentic before chatting or connecting.',
  onClose,
  onVerified,
}: EmailVerificationModalProps) {
  const [email, setEmail] = useState('')
  const [otpCode, setOtpCode] = useState('')
  const [codeSent, setCodeSent] = useState(false)
  const [sendingCode, setSendingCode] = useState(false)
  const [verifying, setVerifying] = useState(false)
  const [cooldown, setCooldown] = useState(0)
  const [errorMsg, setErrorMsg] = useState('')
  const [infoMsg, setInfoMsg] = useState('')

  useEffect(() => {
    if (!isOpen) return
    setEmail((profile?.email || '').trim())
    setOtpCode('')
    setCodeSent(false)
    setErrorMsg('')
    setInfoMsg('')
  }, [isOpen, profile?.id, profile?.email])

  useEffect(() => {
    if (cooldown <= 0) return
    const timer = window.setInterval(() => {
      setCooldown((prev) => (prev <= 1 ? 0 : prev - 1))
    }, 1000)
    return () => window.clearInterval(timer)
  }, [cooldown])

  if (!isOpen || !profile) return null

  const handleSendCode = async (e?: React.FormEvent) => {
    if (e) e.preventDefault()
    setErrorMsg('')
    setInfoMsg('')

    const cleanEmail = email.trim().toLowerCase()
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
      setErrorMsg('Please enter a valid email address.')
      return
    }

    setSendingCode(true)
    try {
      const res = await sendEmailVerificationOtp(cleanEmail)
      if (!res.ok) {
        setErrorMsg(res.error || 'Could not send verification email.')
        return
      }
      setCodeSent(true)
      setCooldown(60)
      setInfoMsg(`Verification email sent to ${cleanEmail}. Check your inbox and spam folder.`)
    } finally {
      setSendingCode(false)
    }
  }

  const handleVerifyCode = async (e: React.FormEvent) => {
    e.preventDefault()
    setErrorMsg('')
    setInfoMsg('')

    const cleanEmail = email.trim().toLowerCase()
    if (!otpCode.trim()) {
      setErrorMsg('Please enter the verification code from your email.')
      return
    }

    setVerifying(true)
    try {
      const verifyRes = await verifyEmailOtpCode(cleanEmail, otpCode)
      if (!verifyRes.ok || !verifyRes.accessToken || !verifyRes.user) {
        setErrorMsg(verifyRes.error || 'Invalid or expired verification code.')
        return
      }

      const nextProfile: Profile = {
        ...profile,
        email: verifyRes.user.email,
        email_verified: true,
        auth_user_id: verifyRes.user.id,
      }

      const { profile: savedProfile, syncedToSupabase, error: saveError } =
        await saveProfileToSupabase(nextProfile, { authToken: verifyRes.accessToken })

      if (!syncedToSupabase && saveError) {
        setErrorMsg(`Email verified, but saving profile failed: ${saveError}`)
        return
      }

      const finalProfile: Profile = {
        ...savedProfile,
        email: verifyRes.user.email,
        email_verified: true,
        auth_user_id: verifyRes.user.id,
      }
      updateMyProfile(finalProfile)
      onVerified(finalProfile)
    } finally {
      setVerifying(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-xs">
      <div className="bg-white rounded-3xl max-w-md w-full p-6 sm:p-7 shadow-2xl border border-rose-100 space-y-5">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <div className="w-10 h-10 rounded-full bg-rose-50 text-rose-700 flex items-center justify-center shrink-0">
              <MailCheck className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-lg font-bold text-gray-900">{title}</h3>
              <p className="text-xs text-gray-500">Profile: {profile.full_name}</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close email verification"
            className="min-h-[44px] min-w-[44px] flex items-center justify-center text-gray-400 hover:text-gray-700 rounded-xl hover:bg-gray-100 transition"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <p className="text-xs sm:text-sm text-gray-600 leading-relaxed">{description}</p>

        {errorMsg && (
          <div className="bg-red-50 border border-red-200 text-red-700 px-3.5 py-2.5 rounded-xl text-xs font-semibold flex items-start gap-2">
            <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
            <span>{errorMsg}</span>
          </div>
        )}

        {infoMsg && (
          <div className="bg-emerald-50 border border-emerald-200 text-emerald-800 px-3.5 py-2.5 rounded-xl text-xs font-semibold flex items-start gap-2">
            <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" />
            <span>{infoMsg}</span>
          </div>
        )}

        {!codeSent ? (
          <form onSubmit={handleSendCode} className="space-y-4">
            <div>
              <label className="block text-xs font-bold text-gray-700 mb-1.5">
                Email Address *
              </label>
              <input
                required
                type="email"
                placeholder="e.g. you@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full min-h-[44px] border border-gray-300 rounded-xl px-3.5 py-2.5 text-sm focus:ring-2 focus:ring-rose-500 focus:outline-none"
              />
            </div>

            <div className="flex gap-2.5">
              <button
                type="button"
                onClick={onClose}
                className="min-h-[44px] px-4 py-2.5 rounded-xl bg-gray-100 hover:bg-gray-200 text-gray-700 font-semibold text-sm transition"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={sendingCode}
                className="flex-1 min-h-[44px] bg-rose-700 hover:bg-rose-800 disabled:opacity-60 text-white font-semibold px-4 py-2.5 rounded-xl text-sm shadow-sm transition flex items-center justify-center gap-2"
              >
                <ShieldCheck className="w-4 h-4" />
                {sendingCode ? 'Sending Code...' : 'Send Verification Code'}
              </button>
            </div>
          </form>
        ) : (
          <form onSubmit={handleVerifyCode} className="space-y-4">
            <div className="flex items-center justify-between text-xs text-gray-600 border-b border-gray-100 pb-2.5">
              <span>
                Sent to <strong className="text-gray-900">{email.trim().toLowerCase()}</strong>
              </span>
              <button
                type="button"
                onClick={() => {
                  setCodeSent(false)
                  setOtpCode('')
                  setErrorMsg('')
                  setInfoMsg('')
                }}
                className="text-rose-700 font-semibold hover:underline"
              >
                Change email
              </button>
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
                className="w-full min-h-[48px] border border-gray-300 rounded-xl px-4 py-2.5 text-center text-lg font-mono tabular-nums tracking-widest focus:ring-2 focus:ring-rose-500 focus:outline-none"
              />
            </div>

            <div className="flex items-center justify-between text-xs">
              <button
                type="button"
                disabled={cooldown > 0 || sendingCode}
                onClick={() => void handleSendCode()}
                className="text-rose-700 hover:underline disabled:text-gray-400 disabled:no-underline font-semibold flex items-center gap-1 tabular-nums"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${sendingCode ? 'animate-spin' : ''}`} />
                {cooldown > 0 ? `Resend in ${cooldown}s` : 'Resend Code'}
              </button>
            </div>

            <button
              type="submit"
              disabled={verifying || !otpCode.trim()}
              className="w-full min-h-[44px] bg-rose-700 hover:bg-rose-800 disabled:opacity-60 text-white font-bold py-2.5 rounded-xl text-sm shadow-md transition flex items-center justify-center gap-2"
            >
              <CheckCircle2 className="w-4 h-4" />
              {verifying ? 'Verifying & Unlocking...' : 'Verify Email & Continue'}
            </button>
          </form>
        )}
      </div>
    </div>
  )
}
