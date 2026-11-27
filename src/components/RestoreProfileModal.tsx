import React, { useEffect, useState } from 'react'
import { AlertCircle, CheckCircle2, KeyRound, MailCheck, RefreshCw, UserPlus, X } from 'lucide-react'
import { sendEmailVerificationOtp, verifyEmailOtpCode } from '@/lib/supabase'
import { Profile, restoreProfileByAuthToken } from '@/utils/profileStorage'

export const PENDING_RESTORE_SESSION_KEY = 'mopani_pending_restore_signin'

interface RestoreProfileModalProps {
  isOpen: boolean
  initialEmail?: string
  onClose: () => void
  onRestored: (profile: Profile) => void
  onNeedsRegistration: (verifiedEmail: string) => void
}

export function RestoreProfileModal({
  isOpen,
  initialEmail = '',
  onClose,
  onRestored,
  onNeedsRegistration,
}: RestoreProfileModalProps) {
  const [step, setStep] = useState<'email' | 'otp' | 'missing'>('email')
  const [email, setEmail] = useState(initialEmail)
  const [otpCode, setOtpCode] = useState('')
  const [cooldown, setCooldown] = useState(0)
  const [sending, setSending] = useState(false)
  const [verifying, setVerifying] = useState(false)
  const [errorMsg, setErrorMsg] = useState('')
  const [infoMsg, setInfoMsg] = useState('')
  const [verifiedEmptyEmail, setVerifiedEmptyEmail] = useState('')

  useEffect(() => {
    if (!isOpen) return
    setStep('email')
    setEmail(initialEmail)
    setOtpCode('')
    setErrorMsg('')
    setInfoMsg('')
    setVerifiedEmptyEmail('')
  }, [isOpen, initialEmail])

  useEffect(() => {
    if (cooldown <= 0) return
    const timer = window.setInterval(() => {
      setCooldown((prev) => (prev <= 1 ? 0 : prev - 1))
    }, 1000)
    return () => window.clearInterval(timer)
  }, [cooldown])

  if (!isOpen) return null

  const handleSendCode = async (e?: React.FormEvent) => {
    if (e) e.preventDefault()
    if (sending) return
    setErrorMsg('')
    setInfoMsg('')

    const cleanEmail = email.trim().toLowerCase()
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
      setErrorMsg('Please enter the email address linked to your profile.')
      return
    }

    try {
      sessionStorage.setItem(PENDING_RESTORE_SESSION_KEY, '1')
    } catch {
      // ignore storage errors
    }

    setSending(true)
    try {
      const res = await sendEmailVerificationOtp(cleanEmail)
      if (!res.ok) {
        setErrorMsg(res.error || 'Could not send sign-in code.')
        return
      }
      setCooldown(60)
      setOtpCode('')
      setStep('otp')
      setInfoMsg(`We sent a sign-in code and link to ${cleanEmail}. Check your inbox or spam folder.`)
    } finally {
      setSending(false)
    }
  }

  const handleVerifyAndRestore = async (e: React.FormEvent) => {
    e.preventDefault()
    if (verifying) return
    setErrorMsg('')

    const cleanEmail = email.trim().toLowerCase()
    if (!otpCode.trim()) {
      setErrorMsg('Please enter the verification code from your email.')
      return
    }

    setVerifying(true)
    try {
      const otpRes = await verifyEmailOtpCode(cleanEmail, otpCode)
      if (!otpRes.ok || !otpRes.accessToken) {
        setErrorMsg(otpRes.error || 'Invalid or expired code. Please request a new code.')
        return
      }

      const restored = await restoreProfileByAuthToken(otpRes.accessToken)
      try {
        sessionStorage.removeItem(PENDING_RESTORE_SESSION_KEY)
      } catch {
        // ignore
      }

      if (!restored.ok) {
        setErrorMsg(restored.error || 'Could not restore your profile.')
        return
      }

      if (!restored.profile) {
        setVerifiedEmptyEmail(restored.email || cleanEmail)
        setStep('missing')
        return
      }

      onRestored(restored.profile)
    } finally {
      setVerifying(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/65 p-4 backdrop-blur-xs">
      <div className="bg-white rounded-3xl max-w-md w-full p-6 sm:p-7 shadow-2xl border border-rose-100 space-y-5">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <div className="w-10 h-10 rounded-full bg-rose-50 text-rose-700 flex items-center justify-center shrink-0">
              <KeyRound className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-lg font-bold text-gray-900">Sign In &amp; Restore Profile</h3>
              <p className="text-xs text-gray-500">Access your Mopani Singles profile on any device</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close sign-in modal"
            className="min-h-[44px] min-w-[44px] flex items-center justify-center text-gray-400 hover:text-gray-700 rounded-xl hover:bg-gray-100 transition"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {errorMsg && (
          <div className="bg-red-50 border border-red-200 text-red-700 px-3.5 py-2.5 rounded-xl text-xs font-semibold flex items-start gap-2">
            <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
            <span>{errorMsg}</span>
          </div>
        )}

        {infoMsg && step !== 'missing' && (
          <div className="bg-emerald-50 border border-emerald-200 text-emerald-800 px-3.5 py-2.5 rounded-xl text-xs font-semibold flex items-start gap-2">
            <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" />
            <span>{infoMsg}</span>
          </div>
        )}

        {step === 'email' && (
          <form onSubmit={handleSendCode} className="space-y-4">
            <p className="text-xs sm:text-sm text-gray-600 leading-relaxed">
              Enter the email address you verified when registering. We will send a one-time code to restore your profile, Boost points, and private chats on this device.
            </p>
            <div>
              <label className="block text-xs font-semibold text-gray-700 mb-1">
                Registered Email Address
              </label>
              <input
                required
                type="email"
                placeholder="you@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full min-h-[44px] border border-gray-300 rounded-xl px-3.5 py-2.5 text-sm focus:ring-2 focus:ring-rose-500 focus:outline-none"
              />
            </div>
            <button
              type="submit"
              disabled={sending}
              className="w-full min-h-[46px] bg-rose-700 hover:bg-rose-800 disabled:opacity-60 text-white font-bold px-4 py-3 rounded-xl shadow-md transition flex items-center justify-center gap-2 text-sm"
            >
              <MailCheck className="w-4 h-4" />
              {sending ? 'Sending Code...' : 'Send Sign-In Code'}
            </button>
          </form>
        )}

        {step === 'otp' && (
          <form onSubmit={handleVerifyAndRestore} className="space-y-4">
            <div>
              <label className="block text-xs font-semibold text-gray-700 mb-1">
                Verification Code
              </label>
              <input
                required
                type="text"
                inputMode="numeric"
                autoComplete="one-time-code"
                placeholder="Enter code from email"
                value={otpCode}
                onChange={(e) => setOtpCode(e.target.value.replace(/[^0-9a-zA-Z]/g, '').slice(0, 12))}
                className="w-full min-h-[48px] border border-gray-300 rounded-xl px-3.5 py-2.5 text-center text-lg font-mono tracking-widest focus:ring-2 focus:ring-rose-500 focus:outline-none"
              />
            </div>

            <button
              type="submit"
              disabled={verifying || !otpCode.trim()}
              className="w-full min-h-[46px] bg-rose-700 hover:bg-rose-800 disabled:opacity-60 text-white font-bold px-4 py-3 rounded-xl shadow-md transition text-sm"
            >
              {verifying ? 'Restoring Profile...' : 'Verify & Restore Profile'}
            </button>

            <div className="flex items-center justify-between text-xs pt-1">
              <button
                type="button"
                onClick={() => {
                  setStep('email')
                  setErrorMsg('')
                  setInfoMsg('')
                }}
                className="text-gray-600 hover:text-gray-900 underline"
              >
                Use different email
              </button>
              <button
                type="button"
                disabled={cooldown > 0 || sending}
                onClick={() => void handleSendCode()}
                className="text-rose-700 font-semibold disabled:opacity-50 flex items-center gap-1"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${sending ? 'animate-spin' : ''}`} />
                {cooldown > 0 ? `Resend in ${cooldown}s` : 'Resend Code'}
              </button>
            </div>
          </form>
        )}

        {step === 'missing' && (
          <div className="space-y-4">
            <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4 text-xs sm:text-sm text-amber-950 leading-relaxed">
              Your email <strong>{verifiedEmptyEmail}</strong> is verified, and no existing profile is linked to it yet. You can create your profile now without re-verifying your email.
            </div>
            <button
              type="button"
              onClick={() => onNeedsRegistration(verifiedEmptyEmail)}
              className="w-full min-h-[46px] bg-rose-700 hover:bg-rose-800 text-white font-bold px-4 py-3 rounded-xl shadow-md transition flex items-center justify-center gap-2 text-sm"
            >
              <UserPlus className="w-4 h-4" />
              Create Profile with {verifiedEmptyEmail}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
