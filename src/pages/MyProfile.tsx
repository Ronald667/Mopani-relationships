import React, { useState, useEffect } from 'react'
import { hasDirectClientSupabase, supabase } from '@/lib/supabase'
import {
  deleteStorageFileByUrl,
  uploadDataUrlToSupabase,
  uploadProfilePhotoBlob,
} from '@/lib/supabase/storage'
import { ImageCropperModal } from '@/components/ImageCropperModal'
import { BackButton } from '@/components/BackButton'
import { ProfileAvatar } from '@/components/ProfileAvatar'
import { EmailVerificationModal } from '@/components/EmailVerificationModal'
import { SelfieVerificationModal } from '@/components/SelfieVerificationModal'
import { BoostModal } from '@/components/BoostModal'
import { RestoreProfileModal } from '@/components/RestoreProfileModal'
import {
  Profile,
  deleteMyProfile,
  deleteProfileOnSupabase,
  getActiveProfileId,
  getBoostRemainingLabel,
  getMyProfiles,
  getProfileVerificationStatus,
  isProfileBoosted,
  isProfileEmailVerified,
  isProfileIdentityVerified,
  saveProfileToSupabase,
  syncMyProfilesStatus,
  updateMyProfile,
} from '@/utils/profileStorage'
import {
  User,
  Edit3,
  ShieldCheck,
  MapPin,
  Camera,
  Check,
  Trash2,
  MessageCircle,
  MailCheck,
  BadgeCheck,
  Clock,
  AlertCircle,
  Zap,
  Coins,
  KeyRound,
} from 'lucide-react'
import { MOPANI_VILLAGES } from '@/data/mopaniLocations'

const VILLAGES = MOPANI_VILLAGES

export function MyProfile({
  onGoRegister,
  onOpenChat,
  onBack,
}: {
  onGoRegister: () => void
  onOpenChat: () => void
  onBack: () => void
}) {
  const [profiles, setProfiles] = useState<Profile[]>([])
  const [selectedId, setSelectedId] = useState<string>('')
  const [isEditing, setIsEditing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [uploadingPhoto, setUploadingPhoto] = useState(false)
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  const [cropperOpen, setCropperOpen] = useState(false)
  const [verifyModalOpen, setVerifyModalOpen] = useState(false)
  const [selfieModalOpen, setSelfieModalOpen] = useState(false)
  const [boostModalOpen, setBoostModalOpen] = useState(false)
  const [restoreModalOpen, setRestoreModalOpen] = useState(false)
  const [pendingPhotoBlob, setPendingPhotoBlob] = useState<Blob | null>(null)
  const [formData, setFormData] = useState<Profile | null>(null)
  const [feedback, setFeedback] = useState('')

  useEffect(() => {
    const load = async () => {
      const localList = getMyProfiles()
      const currentActive = getActiveProfileId()
      setProfiles(localList)
      if (localList.length > 0) {
        const chosen = localList.find((p) => p.id === currentActive) || localList[0]
        setSelectedId(chosen.id)
        setFormData(chosen)
      }

      const synced = await syncMyProfilesStatus()
      if (synced.length > 0) {
        setProfiles(synced)
        const activeNow = getActiveProfileId()
        const updatedChosen = synced.find((p) => p.id === (currentActive || activeNow || synced[0].id)) || synced[0]
        setFormData(updatedChosen)
      }
    }
    load()
  }, [])

  const selectedProfile = profiles.find((p) => p.id === selectedId) || profiles[0] || null
  const identityStatus = getProfileVerificationStatus(selectedProfile)
  const isIdentityVerified = isProfileIdentityVerified(selectedProfile)
  const isBoosted = isProfileBoosted(selectedProfile)
  const boostRemaining = getBoostRemainingLabel(selectedProfile?.boosted_until)

  const handleCropComplete = async (croppedBase64: string, blob?: Blob) => {
    if (isEditing && formData) {
      setFormData({ ...formData, photo_url: croppedBase64 })
      setPendingPhotoBlob(blob || null)
      return
    }

    if (!selectedProfile) return

    setUploadingPhoto(true)
    setFeedback('')
    try {
      const oldPhotoUrl = selectedProfile.photo_url
      const uploadRes = blob
        ? await uploadProfilePhotoBlob(blob, selectedProfile.id)
        : await uploadDataUrlToSupabase(croppedBase64, 'profiles', `${selectedProfile.id}.jpg`)

      const nextPhotoUrl = uploadRes.url || croppedBase64

      if (uploadRes.storedInSupabase && oldPhotoUrl && oldPhotoUrl !== nextPhotoUrl) {
        await deleteStorageFileByUrl(oldPhotoUrl)
      }

      const nextProfile: Profile = {
        ...selectedProfile,
        photo_url: nextPhotoUrl,
      }

      let syncedProfile = nextProfile
      if (hasDirectClientSupabase()) {
        const { data: updatedRow, error: updateErr } = await supabase
          .from('profiles')
          .update({ photo_url: nextPhotoUrl })
          .eq('id', selectedProfile.id)
          .select()
          .maybeSingle()

        if (!updateErr && updatedRow) {
          syncedProfile = updatedRow as Profile
        } else {
          const res = await saveProfileToSupabase(nextProfile)
          syncedProfile = res.profile
        }
      } else {
        const res = await saveProfileToSupabase(nextProfile)
        syncedProfile = res.profile
      }

      const updated = updateMyProfile(syncedProfile)
      setProfiles(updated)
      setFormData(syncedProfile)
      setPendingPhotoBlob(null)

      if (uploadRes.storedInSupabase) {
        setFeedback('Profile photo uploaded to Supabase profiles bucket and profile updated!')
      } else {
        setFeedback(
          `Photo cropped and saved locally (${uploadRes.error || 'Supabase profiles bucket not ready yet'}).`
        )
      }
    } finally {
      setUploadingPhoto(false)
    }
  }

  const handleSaveEdit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!formData) return

    setSaving(true)
    try {
      let nextPhotoUrl = formData.photo_url
      const oldPhotoUrl = selectedProfile?.photo_url

      if (pendingPhotoBlob || (nextPhotoUrl && nextPhotoUrl.startsWith('data:'))) {
        const uploadRes = pendingPhotoBlob
          ? await uploadProfilePhotoBlob(pendingPhotoBlob, formData.id)
          : await uploadDataUrlToSupabase(nextPhotoUrl, 'profiles', `${formData.id}.jpg`)

        if (uploadRes.url) {
          nextPhotoUrl = uploadRes.url
        }
        if (uploadRes.storedInSupabase && oldPhotoUrl && oldPhotoUrl !== nextPhotoUrl) {
          await deleteStorageFileByUrl(oldPhotoUrl)
        }
      }

      const emailChanged =
        (formData.email || '').trim().toLowerCase() !==
        (selectedProfile?.email || '').trim().toLowerCase()

      const nextProfile: Profile = {
        ...formData,
        photo_url: nextPhotoUrl,
        email_verified: emailChanged ? false : formData.email_verified,
      }

      const { profile: syncedProfile, syncedToSupabase, error: dbError } =
        await saveProfileToSupabase(nextProfile)
      const updated = updateMyProfile(syncedProfile)
      setProfiles(updated)
      setFormData(syncedProfile)
      setPendingPhotoBlob(null)
      setIsEditing(false)
      if (syncedToSupabase) {
        setFeedback(
          emailChanged
            ? 'Profile updated! Please click Verify Email to confirm your new email address before connecting.'
            : 'Profile updated and synced to Supabase!'
        )
      } else {
        setFeedback(
          `Saved locally on this device, but Supabase sync failed (${dbError || 'check supabase.sql schema'}).`
        )
      }
    } finally {
      setSaving(false)
    }
  }

  const handleDeleteSelected = async () => {
    if (!selectedProfile) return
    try {
      await deleteStorageFileByUrl(selectedProfile.photo_url)
      await deleteProfileOnSupabase(selectedProfile.id)
    } catch {
      // local removal still proceeds
    }

    const next = deleteMyProfile(selectedProfile.id)
    setProfiles(next)
    setConfirmingDelete(false)
    setIsEditing(false)

    if (next.length > 0) {
      const nextSelected = next[0]
      setSelectedId(nextSelected.id)
      setFormData(nextSelected)
      setFeedback('Profile deleted.')
    } else {
      setSelectedId('')
      setFormData(null)
    }
  }

  if (profiles.length === 0 || !selectedProfile) {
    return (
      <div className="max-w-md mx-auto px-4 py-20 text-center">
        <BackButton onClick={onBack} label="Back to Discover" />
        <div className="bg-white rounded-3xl p-8 shadow-xl border border-rose-100 space-y-5">
          <div className="w-16 h-16 bg-rose-100 text-rose-700 rounded-full flex items-center justify-center mx-auto">
            <User className="w-8 h-8" />
          </div>
          <h2 className="text-2xl font-black text-gray-900">No Profile Created Yet</h2>
          <p className="text-xs text-gray-500">
            Create your Mopani Singles profile to browse matches, request selfie verification, and send private messages. One profile is allowed per user.
          </p>
          <div className="space-y-2.5">
            <button
              onClick={onGoRegister}
              className="w-full min-h-[44px] bg-rose-700 hover:bg-rose-800 text-white font-bold py-3 rounded-2xl shadow-md transition text-sm"
            >
              Create Your Profile Now
            </button>
            <button
              type="button"
              onClick={() => setRestoreModalOpen(true)}
              className="w-full min-h-[44px] bg-amber-50 hover:bg-amber-100 border border-amber-200 text-amber-950 font-bold py-3 rounded-2xl transition text-sm flex items-center justify-center gap-2"
            >
              <KeyRound className="w-4 h-4 text-rose-700" />
              Sign In / Restore Existing Profile
            </button>
          </div>
        </div>

        <RestoreProfileModal
          isOpen={restoreModalOpen}
          onClose={() => setRestoreModalOpen(false)}
          onRestored={(restoredProfile) => {
            setProfiles(getMyProfiles())
            setSelectedId(restoredProfile.id)
            setFormData(restoredProfile)
            setRestoreModalOpen(false)
            setFeedback(`Welcome back, ${restoredProfile.full_name}! Your profile is restored on this device.`)
          }}
          onNeedsRegistration={() => {
            setRestoreModalOpen(false)
            onGoRegister()
          }}
        />
      </div>
    )
  }

  return (
    <div className="max-w-3xl mx-auto px-4 py-10 space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <BackButton onClick={onBack} label="Back to Discover" />
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setRestoreModalOpen(true)}
            className="min-h-[44px] bg-white border border-gray-200 hover:bg-gray-50 text-gray-700 text-xs font-semibold px-3.5 py-2 rounded-xl shadow-xs transition flex items-center gap-1.5"
          >
            <KeyRound className="w-3.5 h-3.5 text-rose-700" /> Switch / Restore Account
          </button>
          <button
            onClick={onOpenChat}
            className="min-h-[44px] bg-white border border-rose-200 hover:bg-rose-50 text-rose-700 text-xs font-bold px-4 py-2 rounded-xl shadow-xs transition flex items-center gap-1.5"
          >
            <MessageCircle className="w-4 h-4" /> Open Private Messages
          </button>
        </div>
      </div>

      {feedback && (
        <div className="bg-emerald-50 border border-emerald-200 text-emerald-800 px-4 py-3 rounded-2xl text-xs font-semibold flex items-center gap-2">
          <Check className="w-4 h-4 shrink-0" />
          <span>{feedback}</span>
        </div>
      )}

      <div className="bg-white rounded-3xl shadow-xl border border-rose-100 overflow-hidden">
        <div className="bg-gradient-to-r from-rose-900 via-rose-800 to-amber-700 p-8 text-white relative">
          <div className="flex flex-wrap justify-between items-center gap-3">
            <div className="inline-flex items-center gap-2 text-xs font-semibold text-rose-100">
              {isIdentityVerified ? (
                <>
                  <BadgeCheck className="w-4 h-4 text-emerald-300" />
                  <span>Verified Profile</span>
                </>
              ) : (
                <>
                  <ShieldCheck className="w-4 h-4 text-amber-300" />
                  <span>My Profile</span>
                </>
              )}
              <span aria-hidden="true">·</span>
              <span>One profile per user</span>
            </div>

            <div className="flex flex-wrap gap-2">
              {!isEditing && (
                <button
                  type="button"
                  onClick={() => setBoostModalOpen(true)}
                  className="min-h-[40px] bg-amber-400 hover:bg-amber-300 text-gray-900 font-bold px-4 py-2 rounded-xl text-xs transition flex items-center gap-1.5 shadow-sm whitespace-nowrap shrink-0"
                >
                  <Zap className="w-3.5 h-3.5 fill-gray-900" />
                  {isBoosted ? `Boosted (${boostRemaining})` : 'Boost Profile'}
                </button>
              )}
              {!isEditing && !isIdentityVerified && (
                <button
                  type="button"
                  onClick={() => setSelfieModalOpen(true)}
                  className="min-h-[40px] bg-white/25 hover:bg-white/35 text-white font-semibold px-4 py-2 rounded-xl text-xs backdrop-blur-md transition flex items-center gap-1.5 whitespace-nowrap shrink-0"
                >
                  <Camera className="w-3.5 h-3.5" />
                  {identityStatus === 'pending' ? 'Verification Pending' : 'Request Verification'}
                </button>
              )}
              {!isEditing && (
                <button
                  onClick={() => {
                    setFormData(selectedProfile)
                    setPendingPhotoBlob(null)
                    setIsEditing(true)
                    setFeedback('')
                  }}
                  className="min-h-[40px] bg-white/25 hover:bg-white/35 text-white font-semibold px-4 py-2 rounded-xl text-xs backdrop-blur-md transition flex items-center gap-1.5 whitespace-nowrap shrink-0"
                >
                  <Edit3 className="w-3.5 h-3.5" /> Edit Profile
                </button>
              )}
            </div>
          </div>
        </div>

        <div className="px-6 pb-8 pt-0 relative">
          <div className="-mt-16 mb-4 flex justify-between items-end">
            <div className="relative">
              <ProfileAvatar
                src={selectedProfile.photo_url}
                name={selectedProfile.full_name}
                className="w-32 h-32 rounded-full border-4 border-white shadow-lg bg-white"
                textSizeClass="text-2xl"
              />
              {!isEditing && (
                <button
                  type="button"
                  disabled={uploadingPhoto}
                  onClick={() => setCropperOpen(true)}
                  title="Upload & crop new profile photo"
                  className="absolute bottom-1 right-1 bg-rose-700 hover:bg-rose-800 disabled:opacity-60 text-white p-2 rounded-full border-2 border-white shadow-md transition"
                >
                  <Camera className="w-4 h-4" />
                </button>
              )}
            </div>
            <div className="text-xs font-semibold text-gray-600 flex items-center gap-2">
              <span
                className={
                  selectedProfile.is_banned
                    ? 'text-red-700'
                    : selectedProfile.is_approved
                    ? 'text-emerald-700'
                    : 'text-amber-700'
                }
              >
                {selectedProfile.is_banned
                  ? 'Banned'
                  : selectedProfile.is_approved
                  ? 'Approved & Live'
                  : 'Pending Safety Review'}
              </span>
              <span aria-hidden="true">·</span>
              <span
                className={
                  identityStatus === 'verified'
                    ? 'text-emerald-700'
                    : identityStatus === 'pending'
                    ? 'text-amber-700'
                    : identityStatus === 'rejected'
                    ? 'text-red-700'
                    : 'text-gray-500'
                }
              >
                {identityStatus === 'verified'
                  ? 'Identity Verified'
                  : identityStatus === 'pending'
                  ? 'Selfie Under Review'
                  : identityStatus === 'rejected'
                  ? 'Verification Declined'
                  : 'Not Identity Verified'}
              </span>
            </div>
          </div>

          {!isEditing ? (
            <div className="space-y-6">
              <div>
                <h1 className="text-2xl font-black text-gray-900 flex items-center gap-2 flex-wrap">
                  <span>
                    {selectedProfile.full_name}, {selectedProfile.age}
                  </span>
                  {isIdentityVerified && (
                    <span className="inline-flex items-center gap-1 text-xs font-bold text-emerald-700">
                      <BadgeCheck className="w-5 h-5 text-emerald-600" /> Verified
                    </span>
                  )}
                </h1>
                <p className="text-xs text-rose-600 font-semibold flex items-center gap-1 mt-1">
                  <MapPin className="w-3.5 h-3.5" /> {selectedProfile.village}, {selectedProfile.municipality} · {selectedProfile.language} · {selectedProfile.intention} · {selectedProfile.gender}
                </p>
              </div>

              <div className="bg-gray-50 p-4 rounded-2xl border border-gray-100">
                <h3 className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-1">My Bio</h3>
                <p className="text-sm text-gray-800 leading-relaxed">"{selectedProfile.bio}"</p>
              </div>

              <div className="bg-white p-4 rounded-2xl border border-rose-200 flex flex-wrap items-center justify-between gap-4">
                <div className="space-y-1 max-w-md">
                  <h3 className="text-sm font-bold text-gray-900 flex items-center gap-2">
                    {identityStatus === 'verified' ? (
                      <>
                        <BadgeCheck className="w-4 h-4 text-emerald-600" />
                        <span>Profile Status: Verified</span>
                      </>
                    ) : identityStatus === 'pending' ? (
                      <>
                        <Clock className="w-4 h-4 text-amber-600" />
                        <span>Selfie Verification Pending Admin Review</span>
                      </>
                    ) : identityStatus === 'rejected' ? (
                      <>
                        <AlertCircle className="w-4 h-4 text-red-600" />
                        <span>Verification Request Declined</span>
                      </>
                    ) : (
                      <>
                        <ShieldCheck className="w-4 h-4 text-rose-700" />
                        <span>Identity Verification</span>
                      </>
                    )}
                  </h3>
                  <p className="text-xs text-gray-600 leading-relaxed">
                    {identityStatus === 'verified'
                      ? 'Your selfie was approved by an admin. Other members see your Verified status on Discover and Matches.'
                      : identityStatus === 'pending'
                      ? `Selfie submitted${
                          selectedProfile.verification_requested_at
                            ? ` on ${new Date(selectedProfile.verification_requested_at).toLocaleDateString()}`
                            : ''
                        }. Your status will update to Verified once approved by an admin.`
                      : identityStatus === 'rejected'
                      ? selectedProfile.verification_note ||
                        'Your previous selfie could not be verified. Please upload a clearer selfie.'
                      : 'Upload a quick selfie for manual admin verification to mark your profile status as Verified.'}
                  </p>
                </div>

                {identityStatus === 'verified' ? (
                  <span className="inline-flex items-center gap-1.5 text-xs font-bold text-emerald-700">
                    <BadgeCheck className="w-4 h-4" /> Verified
                  </span>
                ) : (
                  <button
                    type="button"
                    onClick={() => setSelfieModalOpen(true)}
                    className="min-h-[44px] bg-rose-700 hover:bg-rose-800 text-white text-xs sm:text-sm font-bold px-4 py-2.5 rounded-xl shadow-sm transition flex items-center gap-2 whitespace-nowrap shrink-0"
                  >
                    <Camera className="w-4 h-4" />
                    {identityStatus === 'pending' ? 'Upload New Selfie' : 'Request Verification'}
                  </button>
                )}
              </div>

              <div className="bg-amber-50/70 p-4 rounded-2xl border border-amber-200 flex flex-wrap items-center justify-between gap-4">
                <div className="space-y-1 max-w-md">
                  <h3 className="text-sm font-bold text-gray-900 flex items-center gap-2">
                    <Zap className="w-4 h-4 text-amber-600 fill-amber-500" />
                    <span>
                      {isBoosted ? `24h Discover Boost Active (${boostRemaining})` : '24h Profile Boost'}
                    </span>
                  </h3>
                  <p className="text-xs text-gray-600 leading-relaxed flex flex-wrap items-center gap-2">
                    <span>
                      {isBoosted
                        ? 'Your profile is currently highlighted at the top of the Discover feed.'
                        : 'Highlight your profile at the top of the Mopani Discover feed for 24 hours using Boost Points or the Payment Gateway.'}
                    </span>
                  </p>
                  <p className="text-xs font-semibold text-amber-900 flex items-center gap-1.5 tabular-nums pt-0.5">
                    <Coins className="w-3.5 h-3.5 text-amber-700" />
                    <span>
                      Points Balance: {selectedProfile.boost_points ?? 100} pts (50 pts per 24h boost)
                    </span>
                  </p>
                </div>

                <button
                  type="button"
                  onClick={() => setBoostModalOpen(true)}
                  className="min-h-[44px] bg-gray-900 hover:bg-black text-white text-xs sm:text-sm font-bold px-4 py-2.5 rounded-xl shadow-sm transition flex items-center gap-2 whitespace-nowrap shrink-0"
                >
                  <Zap className="w-4 h-4 text-amber-400" />
                  {isBoosted ? 'Extend Boost (+24h)' : 'Boost Profile (24h)'}
                </button>
              </div>

              <div className="bg-rose-50/60 p-4 rounded-2xl border border-rose-100 flex flex-wrap items-center justify-between gap-3">
                <div className="space-y-1.5">
                  <div>
                    <h3 className="text-xs font-bold text-rose-900">Private WhatsApp Number</h3>
                    <p className="text-xs text-gray-600 font-mono mt-0.5">{selectedProfile.whatsapp}</p>
                  </div>
                  <div>
                    <h3 className="text-xs font-bold text-rose-900">Email &amp; Contact Status</h3>
                    <p className="text-xs text-gray-600 mt-0.5">
                      {selectedProfile.email ? (
                        <>
                          <span>{selectedProfile.email}</span>
                          <span aria-hidden="true"> · </span>
                          <span
                            className={
                              isProfileEmailVerified(selectedProfile)
                                ? 'text-emerald-700 font-semibold'
                                : 'text-amber-700 font-semibold'
                            }
                          >
                            {isProfileEmailVerified(selectedProfile)
                              ? 'Email confirmed'
                              : 'Email not verified yet'}
                          </span>
                          <span aria-hidden="true"> · </span>
                          <span>
                            {selectedProfile.email_notifications === false ? 'Alerts paused' : 'Alerts enabled'}
                          </span>
                        </>
                      ) : (
                        'Not set — verify your email to connect with other members'
                      )}
                    </p>
                    {!isProfileEmailVerified(selectedProfile) && (
                      <button
                        type="button"
                        onClick={() => setVerifyModalOpen(true)}
                        className="mt-2 min-h-[44px] inline-flex items-center gap-1.5 bg-rose-700 hover:bg-rose-800 text-white text-xs font-semibold px-3.5 py-2 rounded-lg transition"
                      >
                        <MailCheck className="w-3.5 h-3.5" /> Verify Email Now
                      </button>
                    )}
                  </div>
                </div>

                {!confirmingDelete ? (
                  <button
                    onClick={() => setConfirmingDelete(true)}
                    className="text-xs text-red-600 hover:text-red-700 font-semibold flex items-center gap-1"
                  >
                    <Trash2 className="w-3.5 h-3.5" /> Delete This Profile
                  </button>
                ) : (
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-red-700 font-semibold">Delete permanently?</span>
                    <button
                      onClick={handleDeleteSelected}
                      className="bg-red-600 hover:bg-red-700 text-white text-xs font-bold px-3 py-1.5 rounded-lg"
                    >
                      Yes, Delete
                    </button>
                    <button
                      onClick={() => setConfirmingDelete(false)}
                      className="bg-gray-200 hover:bg-gray-300 text-gray-700 text-xs font-semibold px-3 py-1.5 rounded-lg"
                    >
                      Cancel
                    </button>
                  </div>
                )}
              </div>
            </div>
          ) : formData ? (
            <form onSubmit={handleSaveEdit} className="space-y-4 pt-4">
              <h2 className="text-lg font-bold text-gray-900 mb-2">Edit Profile</h2>

              <div className="flex items-center gap-4">
                <ProfileAvatar
                  src={formData.photo_url}
                  name={formData.full_name}
                  className="w-16 h-16 rounded-full border-2 border-rose-600"
                />
                <button
                  type="button"
                  onClick={() => setCropperOpen(true)}
                  className="bg-rose-700 text-white text-xs font-semibold px-4 py-2 rounded-xl shadow-xs flex items-center gap-1.5"
                >
                  <Camera className="w-3.5 h-3.5" /> Change Photo
                </button>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold text-gray-700 mb-1">Full Name</label>
                  <input
                    required
                    type="text"
                    value={formData.full_name}
                    onChange={(e) => setFormData({ ...formData, full_name: e.target.value })}
                    className="w-full border rounded-xl p-2.5 text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-gray-700 mb-1">Age</label>
                  <select
                    value={formData.age}
                    onChange={(e) => setFormData({ ...formData, age: parseInt(e.target.value, 10) || 25 })}
                    className="w-full border rounded-xl p-2.5 text-sm bg-white"
                  >
                    {Array.from({ length: 53 }, (_, i) => i + 18).map((ageNum) => (
                      <option key={ageNum} value={ageNum}>{ageNum} Years Old</option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold text-gray-700 mb-1">Municipality</label>
                  <select
                    value={formData.municipality}
                    onChange={(e) => {
                      const mun = e.target.value
                      const firstVil = VILLAGES[mun]?.[0] || ''
                      setFormData({ ...formData, municipality: mun, village: firstVil })
                    }}
                    className="w-full border rounded-xl p-2.5 text-sm bg-white"
                  >
                    {Object.keys(VILLAGES).map((m) => (
                      <option key={m} value={m}>{m}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-bold text-gray-700 mb-1">Village</label>
                  <select
                    value={formData.village}
                    onChange={(e) => setFormData({ ...formData, village: e.target.value })}
                    className="w-full border rounded-xl p-2.5 text-sm bg-white"
                  >
                    {formData.village &&
                      !(VILLAGES[formData.municipality] || []).includes(formData.village) && (
                        <option value={formData.village}>{formData.village}</option>
                      )}
                    {VILLAGES[formData.municipality]?.map((v) => (
                      <option key={v} value={v}>{v}</option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold text-gray-700 mb-1">Intention</label>
                  <select
                    value={formData.intention}
                    onChange={(e) => setFormData({ ...formData, intention: e.target.value })}
                    className="w-full border rounded-xl p-2.5 text-sm bg-white"
                  >
                    <option value="Marriage">Marriage</option>
                    <option value="Dating">Dating</option>
                    <option value="Friendship">Friendship</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-bold text-gray-700 mb-1">Language</label>
                  <select
                    value={formData.language}
                    onChange={(e) => setFormData({ ...formData, language: e.target.value })}
                    className="w-full border rounded-xl p-2.5 text-sm bg-white"
                  >
                    <option value="Sepedi">Sepedi</option>
                    <option value="Xitsonga">Xitsonga</option>
                    <option value="Tshivenda">Tshivenda</option>
                    <option value="English">English</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-gray-700 mb-1">WhatsApp Number</label>
                <input
                  required
                  type="text"
                  value={formData.whatsapp}
                  onChange={(e) => setFormData({ ...formData, whatsapp: e.target.value })}
                  className="w-full border rounded-xl p-2.5 text-sm"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-gray-700 mb-1">
                  Private Email for New Message Alerts (Optional)
                </label>
                <input
                  type="email"
                  placeholder="e.g. you@example.com"
                  value={formData.email || ''}
                  onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                  className="w-full border rounded-xl p-2.5 text-sm"
                />
                <label className="mt-2 flex items-center gap-2 text-xs text-gray-600 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={formData.email_notifications !== false}
                    onChange={(e) =>
                      setFormData({ ...formData, email_notifications: e.target.checked })
                    }
                    className="w-4 h-4 text-rose-600 rounded accent-rose-600"
                  />
                  <span>Email me when a user sends me a new private message</span>
                </label>
              </div>

              <div>
                <label className="block text-xs font-bold text-gray-700 mb-1">Bio (max 200 chars)</label>
                <textarea
                  required
                  maxLength={200}
                  rows={3}
                  value={formData.bio}
                  onChange={(e) => setFormData({ ...formData, bio: e.target.value })}
                  className="w-full border rounded-xl p-2.5 text-sm"
                />
              </div>

              <div className="flex gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setIsEditing(false)}
                  className="flex-1 bg-gray-100 hover:bg-gray-200 text-gray-700 font-medium py-2.5 rounded-xl text-sm"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="flex-1 bg-rose-700 hover:bg-rose-800 disabled:opacity-60 text-white font-semibold py-2.5 rounded-xl text-sm shadow-md flex items-center justify-center gap-1.5"
                >
                  <Check className="w-4 h-4" /> {saving ? 'Uploading & Saving...' : 'Save Changes'}
                </button>
              </div>
            </form>
          ) : null}
        </div>
      </div>

      <ImageCropperModal
        isOpen={cropperOpen}
        onClose={() => setCropperOpen(false)}
        onCropComplete={handleCropComplete}
      />

      <EmailVerificationModal
        isOpen={verifyModalOpen}
        profile={selectedProfile}
        onClose={() => setVerifyModalOpen(false)}
        onVerified={(updatedProfile) => {
          setProfiles(getMyProfiles())
          setFormData(updatedProfile)
          setVerifyModalOpen(false)
          setFeedback('Email verified with Supabase Auth! You can now connect and chat with other users.')
        }}
      />

      <SelfieVerificationModal
        isOpen={selfieModalOpen}
        profile={selectedProfile}
        onClose={() => setSelfieModalOpen(false)}
        onSubmitted={(updatedProfile) => {
          setProfiles(getMyProfiles())
          setFormData(updatedProfile)
          setSelfieModalOpen(false)
          setFeedback(
            'Selfie uploaded! Your verification request is now pending manual admin review.'
          )
        }}
      />

      <BoostModal
        isOpen={boostModalOpen}
        profile={selectedProfile}
        onClose={() => setBoostModalOpen(false)}
        onBoosted={(updatedProfile, message) => {
          setProfiles(getMyProfiles())
          setFormData(updatedProfile)
          setBoostModalOpen(false)
          setFeedback(message)
        }}
      />

      <RestoreProfileModal
        isOpen={restoreModalOpen}
        onClose={() => setRestoreModalOpen(false)}
        onRestored={(restoredProfile) => {
          setProfiles(getMyProfiles())
          setSelectedId(restoredProfile.id)
          setFormData(restoredProfile)
          setRestoreModalOpen(false)
          setFeedback(`Welcome back, ${restoredProfile.full_name}! Your profile is restored on this device.`)
        }}
        onNeedsRegistration={() => {
          setRestoreModalOpen(false)
          onGoRegister()
        }}
      />
    </div>
  )
}
