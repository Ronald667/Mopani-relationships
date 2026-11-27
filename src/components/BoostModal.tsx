import React, { useEffect, useState } from 'react'
import {
  AlertCircle,
  CheckCircle2,
  Coins,
  CreditCard,
  ExternalLink,
  Gift,
  Lock,
  Sparkles,
  TrendingUp,
  X,
  Zap,
} from 'lucide-react'
import {
  BoostConfig,
  BoostStatusResponse,
  Profile,
  activateBoostWithPoints,
  claimDailyBoostBonus,
  confirmBoostCheckout,
  createBoostCheckout,
  fetchBoostConfig,
  fetchBoostStatus,
  getBoostRemainingLabel,
  getMyProfiles,
  saveProfileToSupabase,
} from '@/utils/profileStorage'

interface BoostModalProps {
  isOpen: boolean
  profile: Profile | null
  onClose: () => void
  onBoosted: (updatedProfile: Profile, message: string) => void
}

export function BoostModal({ isOpen, profile, onClose, onBoosted }: BoostModalProps) {
  const [config, setConfig] = useState<BoostConfig>({
    durationHours: 24,
    pointsCost: 50,
    dailyBonusPoints: 25,
    startingPoints: 100,
    priceZarCents: 2900,
    currency: 'ZAR',
    gateways: { paystack: false, stripe: false, sandbox: true },
  })
  const [status, setStatus] = useState<BoostStatusResponse | null>(null)
  const [loading, setLoading] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [claimingBonus, setClaimingBonus] = useState(false)
  const [tab, setTab] = useState<'points' | 'gateway'>('points')
  const [sandboxMethod, setSandboxMethod] = useState<'card' | 'eft' | 'snapscan'>('card')
  const [selectedGateway, setSelectedGateway] = useState<'stripe' | 'paystack' | 'sandbox'>('sandbox')
  const [errorMsg, setErrorMsg] = useState('')
  const [successMsg, setSuccessMsg] = useState('')
  const [pendingRedirect, setPendingRedirect] = useState<{
    gateway: 'stripe' | 'paystack'
    reference: string
    checkoutUrl: string
  } | null>(null)

  useEffect(() => {
    if (!isOpen || !profile) return
    let active = true
    setErrorMsg('')
    setSuccessMsg('')
    setPendingRedirect(null)
    setLoading(true)

    void Promise.all([fetchBoostConfig(), fetchBoostStatus(profile.id)]).then(
      async ([cfg, st]) => {
        if (!active) return
        setConfig(cfg)
        if (!st.ok && /profile not found/i.test(st.error || '')) {
          const synced = await saveProfileToSupabase(profile)
          if (!active) return
          if (synced.syncedToSupabase) {
            const retried = await fetchBoostStatus(profile.id)
            if (!active) return
            setStatus(retried)
          } else {
            setStatus(st)
          }
        } else {
          setStatus(st)
        }
        if (cfg.gateways.paystack) {
          setSelectedGateway('paystack')
        } else if (cfg.gateways.stripe) {
          setSelectedGateway('stripe')
        } else {
          setSelectedGateway('sandbox')
        }
        setLoading(false)
      }
    )

    return () => {
      active = false
    }
  }, [isOpen, profile?.id])

  if (!isOpen || !profile) return null

  const currentPoints = status?.boostPoints ?? profile.boost_points ?? config.startingPoints
  const currentBoostedUntil = status?.boostedUntil ?? profile.boosted_until ?? null
  const remainingLabel = getBoostRemainingLabel(currentBoostedUntil)
  const hasEnoughPoints = currentPoints >= config.pointsCost
  const priceDisplay = `R${(config.priceZarCents / 100).toFixed(2)}`

  const resolveUpdatedProfile = (res: BoostStatusResponse): Profile => {
    const stored = getMyProfiles().find((p) => p.id === profile.id)
    return {
      ...(stored || profile),
      boosted_until: res.boostedUntil,
      boost_points: res.boostPoints,
    }
  }

  const handleClaimDailyBonus = async () => {
    if (claimingBonus) return
    setErrorMsg('')
    setSuccessMsg('')
    setClaimingBonus(true)
    try {
      let res = await claimDailyBoostBonus(profile.id, profile.email)
      if (!res.ok && /profile not found/i.test(res.error || '')) {
        const synced = await saveProfileToSupabase(profile)
        if (synced.syncedToSupabase) {
          res = await claimDailyBoostBonus(profile.id, profile.email)
        }
      }
      if (!res.ok) {
        setErrorMsg(res.error || 'Could not claim daily points bonus.')
        return
      }
      setStatus(res)
      setSuccessMsg(`Added +${res.pointsAdded || config.dailyBonusPoints} Boost Points to your balance.`)
    } finally {
      setClaimingBonus(false)
    }
  }

  const handleBoostWithPoints = async () => {
    if (submitting || !hasEnoughPoints) return
    setErrorMsg('')
    setSuccessMsg('')
    setSubmitting(true)
    try {
      let res = await activateBoostWithPoints(profile.id, profile.email)
      if (!res.ok && /profile not found/i.test(res.error || '')) {
        const synced = await saveProfileToSupabase(profile)
        if (synced.syncedToSupabase) {
          res = await activateBoostWithPoints(profile.id, profile.email)
        }
      }
      if (!res.ok) {
        setErrorMsg(res.error || 'Unable to activate boost with points.')
        return
      }
      setStatus(res)
      const msg = `${profile.full_name} is now boosted at the top of Discover for ${config.durationHours} hours!`
      onBoosted(resolveUpdatedProfile(res), msg)
    } finally {
      setSubmitting(false)
    }
  }

  const handleVerifyPendingGateway = async () => {
    if (!pendingRedirect || submitting) return
    setErrorMsg('')
    setSuccessMsg('')
    setSubmitting(true)
    try {
      const confirmed = await confirmBoostCheckout({
        profileId: profile.id,
        gateway: pendingRedirect.gateway,
        reference: pendingRedirect.reference,
      })
      if (!confirmed.ok) {
        setErrorMsg(confirmed.error || 'Payment is not completed on Paystack yet. Complete checkout in the new tab first, then click Verify.')
        return
      }
      setPendingRedirect(null)
      setStatus(confirmed)
      const msg = `Payment verified (${priceDisplay})! Your profile is highlighted at the top of Discover for ${config.durationHours} hours.`
      onBoosted(resolveUpdatedProfile(confirmed), msg)
    } finally {
      setSubmitting(false)
    }
  }

  const handleGatewayCheckout = async (e: React.FormEvent) => {
    e.preventDefault()
    if (submitting) return
    setErrorMsg('')
    setSuccessMsg('')
    setPendingRedirect(null)
    setSubmitting(true)
    try {
      let checkout = await createBoostCheckout({
        profileId: profile.id,
        gateway: selectedGateway,
        paymentMethod: sandboxMethod,
        email: profile.email,
      })
      if (!checkout.ok && /profile not found/i.test(checkout.error || '')) {
        const synced = await saveProfileToSupabase(profile)
        if (synced.syncedToSupabase) {
          checkout = await createBoostCheckout({
            profileId: profile.id,
            gateway: selectedGateway,
            paymentMethod: sandboxMethod,
            email: profile.email,
          })
        }
      }
      if (!checkout.ok || !checkout.reference) {
        setErrorMsg(checkout.error || 'Could not start payment checkout.')
        return
      }

      if (
        checkout.mode === 'redirect' &&
        checkout.checkoutUrl &&
        checkout.checkoutUrl.startsWith('https://')
      ) {
        const isInIframe = typeof window !== 'undefined' && window.self !== window.top
        if (isInIframe && (checkout.gateway === 'paystack' || checkout.gateway === 'stripe')) {
          setPendingRedirect({
            gateway: checkout.gateway,
            reference: checkout.reference,
            checkoutUrl: checkout.checkoutUrl,
          })
          return
        }
        window.location.assign(checkout.checkoutUrl)
        return
      }

      const confirmed = await confirmBoostCheckout({
        profileId: profile.id,
        gateway: checkout.gateway || 'sandbox',
        reference: checkout.reference,
        checkoutToken: checkout.checkoutToken,
      })
      if (!confirmed.ok) {
        setErrorMsg(confirmed.error || 'Payment confirmation failed.')
        return
      }

      setStatus(confirmed)
      const msg = `Payment verified (${priceDisplay})! Your profile is highlighted at the top of Discover for ${config.durationHours} hours.`
      onBoosted(resolveUpdatedProfile(confirmed), msg)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/65 p-4 backdrop-blur-xs">
      <div className="bg-white rounded-3xl max-w-md w-full p-6 sm:p-7 shadow-2xl border border-rose-100 space-y-5 max-h-[92vh] overflow-y-auto">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <div className="w-10 h-10 rounded-full bg-amber-100 text-amber-700 flex items-center justify-center shrink-0">
              <Zap className="w-5 h-5 fill-amber-500 text-amber-600" />
            </div>
            <div>
              <h3 className="text-lg font-bold text-gray-900">Boost Your Profile</h3>
              <p className="text-xs text-gray-500">
                Top of Mopani Discover feed for {config.durationHours} hours
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close boost modal"
            className="min-h-[44px] min-w-[44px] flex items-center justify-center text-gray-400 hover:text-gray-700 rounded-xl hover:bg-gray-100 transition"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="bg-gradient-to-r from-amber-50 via-rose-50/70 to-amber-50 border border-amber-200 rounded-2xl p-4 space-y-2">
          <div className="flex items-center justify-between text-xs font-bold text-gray-900">
            <span className="flex items-center gap-1.5">
              <TrendingUp className="w-4 h-4 text-rose-700" />
              {remainingLabel ? 'Boost Currently Active' : 'Spotlight Visibility'}
            </span>
            {remainingLabel && (
              <span className="text-emerald-700 font-mono tabular-nums">{remainingLabel}</span>
            )}
          </div>
          <p className="text-xs text-gray-600 leading-relaxed">
            {remainingLabel
              ? 'Boosting again adds another 24 hours onto your remaining spotlight time so your profile stays pinned first.'
              : 'Get featured first on Discover across Mopani District for 24 hours with a spotlight highlight.'}
          </p>
        </div>

        <div className="flex gap-1 p-1 bg-gray-100 rounded-xl text-xs font-bold">
          <button
            type="button"
            onClick={() => {
              setTab('points')
              setErrorMsg('')
            }}
            className={`flex-1 min-h-[44px] py-2 px-3 rounded-lg transition flex items-center justify-center gap-1.5 whitespace-nowrap ${
              tab === 'points' ? 'bg-white text-gray-900 shadow-xs' : 'text-gray-600 hover:text-gray-900'
            }`}
          >
            <Coins className="w-4 h-4 text-amber-600" />
            <span>Boost Points ({config.pointsCost} pts)</span>
          </button>
          <button
            type="button"
            onClick={() => {
              setTab('gateway')
              setErrorMsg('')
            }}
            className={`flex-1 min-h-[44px] py-2 px-3 rounded-lg transition flex items-center justify-center gap-1.5 whitespace-nowrap ${
              tab === 'gateway' ? 'bg-white text-gray-900 shadow-xs' : 'text-gray-600 hover:text-gray-900'
            }`}
          >
            <CreditCard className="w-4 h-4 text-rose-700" />
            <span>Payment Gateway ({priceDisplay})</span>
          </button>
        </div>

        {errorMsg && (
          <div className="bg-red-50 border border-red-200 text-red-700 px-3.5 py-2.5 rounded-xl text-xs font-semibold flex items-start gap-2">
            <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
            <span>{errorMsg}</span>
          </div>
        )}

        {successMsg && (
          <div className="bg-emerald-50 border border-emerald-200 text-emerald-800 px-3.5 py-2.5 rounded-xl text-xs font-semibold flex items-start gap-2">
            <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" />
            <span>{successMsg}</span>
          </div>
        )}

        {loading ? (
          <div className="py-8 text-center text-xs text-gray-500">Loading boost balance...</div>
        ) : tab === 'points' ? (
          <div className="space-y-4">
            <div className="bg-gray-50 border border-gray-200 rounded-2xl p-4 flex items-center justify-between gap-3">
              <div>
                <p className="text-xs text-gray-500 font-medium">Available Points Balance</p>
                <p className="text-2xl font-black text-gray-900 tabular-nums mt-0.5">
                  {currentPoints} <span className="text-sm font-semibold text-gray-500">pts</span>
                </p>
              </div>
              <div className="text-right">
                <p className="text-xs text-gray-500 font-medium">24h Boost Cost</p>
                <p className="text-base font-bold text-rose-700 tabular-nums mt-0.5">
                  {config.pointsCost} pts
                </p>
              </div>
            </div>

            <div className="flex items-center justify-between gap-3 bg-amber-50/70 border border-amber-200/80 rounded-2xl px-4 py-3">
              <div className="text-xs text-gray-700">
                <span className="font-bold text-gray-900">Daily Member Bonus</span>
                <p className="text-[11px] text-gray-600">
                  Claim +{config.dailyBonusPoints} free points every 24 hours
                </p>
              </div>
              <button
                type="button"
                disabled={claimingBonus || status?.canClaimDailyBonus === false}
                onClick={handleClaimDailyBonus}
                className="min-h-[40px] px-3.5 py-2 rounded-xl bg-amber-500 hover:bg-amber-600 disabled:opacity-50 text-gray-900 text-xs font-bold transition flex items-center gap-1.5 whitespace-nowrap shrink-0"
              >
                <Gift className="w-3.5 h-3.5" />
                {claimingBonus
                  ? 'Claiming...'
                  : status?.canClaimDailyBonus === false
                  ? 'Claimed Today'
                  : `Claim +${config.dailyBonusPoints} pts`}
              </button>
            </div>

            <button
              type="button"
              disabled={submitting || !hasEnoughPoints}
              onClick={handleBoostWithPoints}
              className="w-full min-h-[48px] bg-rose-700 hover:bg-rose-800 disabled:opacity-55 text-white font-bold px-4 py-3 rounded-xl shadow-md transition flex items-center justify-center gap-2 text-sm"
            >
              <Sparkles className="w-4 h-4 text-amber-300" />
              {submitting
                ? 'Activating 24h Boost...'
                : hasEnoughPoints
                ? `Boost for ${config.durationHours} Hours (${config.pointsCost} Pts)`
                : `Need ${config.pointsCost - currentPoints} More Points`}
            </button>
          </div>
        ) : (
          <form onSubmit={handleGatewayCheckout} className="space-y-4">
            <div className="bg-gray-50 border border-gray-200 rounded-2xl p-4 flex items-center justify-between">
              <div>
                <p className="text-xs font-bold text-gray-900">24-Hour Discover Spotlight</p>
                <p className="text-[11px] text-gray-500 mt-0.5">
                  One-time boost · No recurring subscription
                </p>
              </div>
              <p className="text-xl font-black text-gray-900 tabular-nums">{priceDisplay}</p>
            </div>

            {(config.gateways.paystack || config.gateways.stripe) && (
              <div className="space-y-2">
                <label className="block text-xs font-bold text-gray-700">Select Payment Gateway</label>
                <div className="grid grid-cols-1 gap-2">
                  {config.gateways.paystack && (
                    <button
                      type="button"
                      onClick={() => setSelectedGateway('paystack')}
                      className={`min-h-[44px] px-3.5 py-2.5 rounded-xl border text-left text-xs font-semibold flex items-center justify-between transition ${
                        selectedGateway === 'paystack'
                          ? 'border-rose-600 bg-rose-50 text-rose-900'
                          : 'border-gray-200 hover:border-gray-300 text-gray-700'
                      }`}
                    >
                      <span>Paystack (SA Card / Instant EFT / SnapScan)</span>
                      <span className="text-[11px] font-bold text-emerald-700">Live</span>
                    </button>
                  )}
                  {config.gateways.stripe && (
                    <button
                      type="button"
                      onClick={() => setSelectedGateway('stripe')}
                      className={`min-h-[44px] px-3.5 py-2.5 rounded-xl border text-left text-xs font-semibold flex items-center justify-between transition ${
                        selectedGateway === 'stripe'
                          ? 'border-rose-600 bg-rose-50 text-rose-900'
                          : 'border-gray-200 hover:border-gray-300 text-gray-700'
                      }`}
                    >
                      <span>Stripe Checkout (Card / Apple Pay / Google Pay)</span>
                      <span className="text-[11px] font-bold text-emerald-700">Live</span>
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => setSelectedGateway('sandbox')}
                    className={`min-h-[44px] px-3.5 py-2.5 rounded-xl border text-left text-xs font-semibold flex items-center justify-between transition ${
                      selectedGateway === 'sandbox'
                        ? 'border-rose-600 bg-rose-50 text-rose-900'
                        : 'border-gray-200 hover:border-gray-300 text-gray-700'
                    }`}
                  >
                    <span>Test Gateway Checkout (Sandbox Mode)</span>
                    <span className="text-[11px] font-semibold text-gray-500">Demo</span>
                  </button>
                </div>
              </div>
            )}

            {selectedGateway === 'sandbox' && (
              <div className="space-y-2.5">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-gray-700">Sandbox Payment Method</span>
                  <span className="text-[11px] font-semibold text-amber-700">
                    Test Mode · No Real Charge
                  </span>
                </div>
                <div className="grid grid-cols-1 gap-2">
                  {[
                    {
                      id: 'card' as const,
                      title: 'Test Card •••• 4242',
                      subtitle: 'Instant sandbox card authorization',
                    },
                    {
                      id: 'eft' as const,
                      title: 'Instant EFT (FNB / Capitec / Standard Bank)',
                      subtitle: 'Simulated South African bank transfer',
                    },
                    {
                      id: 'snapscan' as const,
                      title: 'SnapScan / Mobile QR',
                      subtitle: 'Simulated instant mobile wallet payment',
                    },
                  ].map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => setSandboxMethod(item.id)}
                      className={`min-h-[44px] px-3.5 py-2.5 rounded-xl border text-left transition flex items-center justify-between gap-2 ${
                        sandboxMethod === item.id
                          ? 'border-rose-600 bg-rose-50/70'
                          : 'border-gray-200 hover:border-gray-300 bg-white'
                      }`}
                    >
                      <div>
                        <p className="text-xs font-bold text-gray-900">{item.title}</p>
                        <p className="text-[11px] text-gray-500">{item.subtitle}</p>
                      </div>
                      <span
                        className={`w-4 h-4 rounded-full border-2 shrink-0 ${
                          sandboxMethod === item.id
                            ? 'border-rose-700 bg-rose-700'
                            : 'border-gray-300'
                        }`}
                      />
                    </button>
                  ))}
                </div>
              </div>
            )}

            {pendingRedirect ? (
              <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4 space-y-3">
                <p className="text-xs font-bold text-gray-900">
                  1. Open {pendingRedirect.gateway === 'paystack' ? 'Paystack' : 'Stripe'} to complete payment ({priceDisplay})
                </p>
                <a
                  href={pendingRedirect.checkoutUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="w-full min-h-[46px] bg-gray-900 hover:bg-black text-white font-bold px-4 py-3 rounded-xl shadow-md transition flex items-center justify-center gap-2 text-sm"
                >
                  <ExternalLink className="w-4 h-4 text-amber-400" />
                  <span>
                    Open {pendingRedirect.gateway === 'paystack' ? 'Paystack' : 'Stripe'} Payment Page
                  </span>
                </a>
                <p className="text-[11px] text-gray-600">
                  2. After completing payment in the new tab, click below to activate your 24h Boost here:
                </p>
                <div className="flex gap-2">
                  <button
                    type="button"
                    disabled={submitting}
                    onClick={handleVerifyPendingGateway}
                    className="flex-1 min-h-[44px] bg-rose-700 hover:bg-rose-800 disabled:opacity-60 text-white font-bold px-4 py-2.5 rounded-xl text-xs transition flex items-center justify-center gap-1.5"
                  >
                    <CheckCircle2 className="w-4 h-4" />
                    {submitting ? 'Verifying...' : 'Verify & Activate Boost'}
                  </button>
                  <button
                    type="button"
                    onClick={() => setPendingRedirect(null)}
                    className="min-h-[44px] px-3 py-2 rounded-xl border border-gray-300 bg-white text-gray-700 text-xs font-semibold hover:bg-gray-50"
                  >
                    Back
                  </button>
                </div>
              </div>
            ) : (
              <button
                type="submit"
                disabled={submitting}
                className="w-full min-h-[48px] bg-gray-900 hover:bg-black disabled:opacity-60 text-white font-bold px-4 py-3 rounded-xl shadow-md transition flex items-center justify-center gap-2 text-sm"
              >
                <Lock className="w-4 h-4 text-amber-400" />
                {submitting
                  ? 'Processing Checkout...'
                  : selectedGateway === 'sandbox'
                  ? `Complete Test Payment (${priceDisplay})`
                  : `Continue to ${selectedGateway === 'paystack' ? 'Paystack' : 'Stripe'} (${priceDisplay})`}
              </button>
            )}
          </form>
        )}
      </div>
    </div>
  )
}
