import React, { useState, useEffect } from 'react'
import { supabase } from '@/lib/supabase'
import {
  deleteStorageFileByUrl,
  uploadDataUrlToSupabase,
  uploadProfilePhotoBlob,
} from '@/lib/supabase/storage'
import { ImageCropperModal } from '@/components/ImageCropperModal'
import { BackButton } from '@/components/BackButton'
import { ProfileAvatar } from '@/components/ProfileAvatar'
import {
  Profile,
  deleteMyProfile,
  getActiveProfileId,
  getMyProfiles,
  saveProfileToSupabase,
  setActiveProfileId,
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
  PlusCircle,
  MessageCircle,
} from 'lucide-react'

const VILLAGES: Record<string, string[]> = {
  "Maruleng": ["Lorraine", "Sekororo", "Trichardtsdal", "The Oaks", "Hoedspruit", "Makhutsi"],
  "Greater Tzaneen": ["Tzaneen", "Lenyenye", "Letsitele", "Maake", "Nkowankowa"],
  "Greater Letaba": ["Modjadjiskloof", "Ga-Kgapane", "Mokwakwaila"],
  "Ba-Phalaborwa": ["Phalaborwa", "Namakgale", "Lulekani", "Gravalotte"],
  "Greater Giyani": ["Giyani", "Dzumeri", "Nkomo"]
}

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
  const [activeProfileIdState, setActiveProfileIdState] = useState<string>('')
  const [selectedId, setSelectedId] = useState<string>('')
  const [isEditing, setIsEditing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [uploadingPhoto, setUploadingPhoto] = useState(false)
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  const [cropperOpen, setCropperOpen] = useState(false)
  const [pendingPhotoBlob, setPendingPhotoBlob] = useState<Blob | null>(null)
  const [formData, setFormData] = useState<Profile | null>(null)
  const [feedback, setFeedback] = useState('')

  useEffect(() => {
    const load = async () => {
      const localList = getMyProfiles()
      const currentActive = getActiveProfileId()
      setProfiles(localList)
      setActiveProfileIdState(currentActive)
      if (localList.length > 0) {
        const chosen = localList.find((p) => p.id === currentActive) || localList[0]
        setSelectedId(chosen.id)
        setFormData(chosen)
      }

      const synced = await syncMyProfilesStatus()
      if (synced.length > 0) {
        setProfiles(synced)
        const activeNow = getActiveProfileId()
        setActiveProfileIdState(activeNow)
        const updatedChosen = synced.find((p) => p.id === (currentActive || synced[0].id)) || synced[0]
        setFormData(updatedChosen)
      }
    }
    load()
  }, [])

  const selectedProfile = profiles.find((p) => p.id === selectedId) || profiles[0] || null

  const handleSelectProfile = (profile: Profile) => {
    setSelectedId(profile.id)
    setFormData(profile)
    setPendingPhotoBlob(null)
    setIsEditing(false)
    setConfirmingDelete(false)
    setFeedback('')
  }

  const handleSetAsActive = (id: string) => {
    setActiveProfileId(id)
    setActiveProfileIdState(id)
    setFeedback('Active profile updated for private messaging and smart matching.')
  }

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

      const { data: updatedRow, error: updateErr } = await supabase
        .from('profiles')
        .update({ photo_url: nextPhotoUrl })
        .eq('id', selectedProfile.id)
        .select()
        .maybeSingle()

      let syncedProfile = (updatedRow as Profile) || nextProfile
      if (updateErr || !updatedRow) {
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

      const nextProfile: Profile = {
        ...formData,
        photo_url: nextPhotoUrl,
      }

      const { profile: syncedProfile } = await saveProfileToSupabase(nextProfile)
      const updated = updateMyProfile(syncedProfile)
      setProfiles(updated)
      setFormData(syncedProfile)
      setPendingPhotoBlob(null)
      setIsEditing(false)
      setFeedback('Profile updated and synced!')
    } finally {
      setSaving(false)
    }
  }

  const handleDeleteSelected = async () => {
    if (!selectedProfile) return
    try {
      await deleteStorageFileByUrl(selectedProfile.photo_url)
      await supabase.from('profiles').delete().eq('id', selectedProfile.id)
    } catch {
      // local removal still proceeds
    }

    const next = deleteMyProfile(selectedProfile.id)
    setProfiles(next)
    const nextActive = getActiveProfileId()
    setActiveProfileIdState(nextActive)
    setConfirmingDelete(false)
    setIsEditing(false)

    if (next.length > 0) {
      const nextSelected = next.find((p) => p.id === nextActive) || next[0]
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
          <h2 className="text-2xl font-black text-gray-900">No Profiles Created Yet</h2>
          <p className="text-xs text-gray-500">
            Create one or more Mopani Singles profiles to browse matches and send private messages.
          </p>
          <button
            onClick={onGoRegister}
            className="w-full bg-rose-700 hover:bg-rose-800 text-white font-bold py-3 rounded-2xl shadow-md transition text-sm"
          >
            Create Your Profile Now
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="max-w-3xl mx-auto px-4 py-10 space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <BackButton onClick={onBack} label="Back to Discover" />
        <button
          onClick={onGoRegister}
          className="bg-rose-700 hover:bg-rose-800 text-white text-xs font-bold px-4 py-2.5 rounded-xl shadow-sm transition flex items-center gap-1.5"
        >
          <PlusCircle className="w-4 h-4" /> Create New Profile
        </button>
      </div>

      <div className="bg-white rounded-2xl p-4 border border-rose-100 shadow-sm">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-xs font-bold uppercase tracking-wider text-gray-500">
            Your Created Profiles ({profiles.length})
          </h2>
          <button
            onClick={onOpenChat}
            className="text-xs font-semibold text-rose-700 hover:text-rose-800 flex items-center gap-1"
          >
            <MessageCircle className="w-3.5 h-3.5" /> Open Private Messages
          </button>
        </div>

        <div className="flex flex-wrap gap-2.5">
          {profiles.map((p) => {
            const isSelected = p.id === selectedProfile.id
            const isActiveChat = p.id === activeProfileIdState
            return (
              <button
                key={p.id}
                type="button"
                onClick={() => handleSelectProfile(p)}
                className={`flex items-center gap-2.5 px-3 py-2 rounded-xl border text-left transition ${
                  isSelected
                    ? 'border-rose-600 bg-rose-50/80 shadow-xs'
                    : 'border-gray-200 bg-white hover:bg-gray-50'
                }`}
              >
                <ProfileAvatar
                  src={p.photo_url}
                  name={p.full_name}
                  className="w-9 h-9 rounded-full shrink-0"
                  textSizeClass="text-xs"
                />
                <div>
                  <div className="text-xs font-bold text-gray-900 flex items-center gap-1.5">
                    <span>{p.full_name}</span>
                    {isActiveChat && (
                      <span className="bg-rose-700 text-white text-[10px] px-1.5 py-0.5 rounded-md font-semibold">
                        Active
                      </span>
                    )}
                  </div>
                  <div className="text-[11px] text-gray-500">
                    {p.age} yrs • {p.village}
                  </div>
                </div>
              </button>
            )
          })}
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
          <div className="flex flex-wrap justify-between items-start gap-3">
            <div className="inline-flex items-center gap-2 bg-rose-950/60 backdrop-blur-md px-3 py-1 rounded-full text-xs font-medium text-rose-200 border border-rose-500/30">
              <ShieldCheck className="w-3.5 h-3.5 text-rose-400" />
              {selectedProfile.id === activeProfileIdState ? 'Active Chat & Match Profile' : 'Saved Profile'}
            </div>

            <div className="flex flex-wrap gap-2">
              {selectedProfile.id !== activeProfileIdState && !isEditing && (
                <button
                  onClick={() => handleSetAsActive(selectedProfile.id)}
                  className="bg-amber-500 hover:bg-amber-600 text-gray-900 font-bold px-3.5 py-2 rounded-xl text-xs transition"
                >
                  Set as Active Profile
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
                  className="bg-white/25 hover:bg-white/35 text-white font-semibold px-4 py-2 rounded-xl text-xs backdrop-blur-md transition flex items-center gap-1.5"
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
            <span
              className={`text-xs font-bold px-3 py-1.5 rounded-full ${
                selectedProfile.is_banned
                  ? 'bg-red-100 text-red-800'
                  : selectedProfile.is_approved
                  ? 'bg-emerald-100 text-emerald-800'
                  : 'bg-amber-100 text-amber-800'
              }`}
            >
              {selectedProfile.is_banned
                ? 'Banned'
                : selectedProfile.is_approved
                ? 'Approved & Live'
                : 'Pending Safety Review'}
            </span>
          </div>

          {!isEditing ? (
            <div className="space-y-6">
              <div>
                <h1 className="text-2xl font-black text-gray-900">
                  {selectedProfile.full_name}, {selectedProfile.age}
                </h1>
                <p className="text-xs text-rose-600 font-semibold flex items-center gap-1 mt-1">
                  <MapPin className="w-3.5 h-3.5" /> {selectedProfile.village}, {selectedProfile.municipality} • {selectedProfile.language}
                </p>
              </div>

              <div className="flex flex-wrap gap-2">
                <span className="bg-rose-50 text-rose-700 text-xs font-bold px-3 py-1 rounded-xl">
                  Intention: {selectedProfile.intention}
                </span>
                <span className="bg-gray-100 text-gray-700 text-xs font-semibold px-3 py-1 rounded-xl">
                  Gender: {selectedProfile.gender}
                </span>
              </div>

              <div className="bg-gray-50 p-4 rounded-2xl border border-gray-100">
                <h3 className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-1">My Bio</h3>
                <p className="text-sm text-gray-800 leading-relaxed">"{selectedProfile.bio}"</p>
              </div>

              <div className="bg-rose-50/60 p-4 rounded-2xl border border-rose-100 flex flex-wrap items-center justify-between gap-3">
                <div className="space-y-1.5">
                  <div>
                    <h3 className="text-xs font-bold text-rose-900">Private WhatsApp Number</h3>
                    <p className="text-xs text-gray-600 font-mono mt-0.5">{selectedProfile.whatsapp}</p>
                  </div>
                  <div>
                    <h3 className="text-xs font-bold text-rose-900">Private Message Email Alerts</h3>
                    <p className="text-xs text-gray-600 mt-0.5">
                      {selectedProfile.email
                        ? `${selectedProfile.email} • ${
                            selectedProfile.email_notifications === false ? 'Alerts paused' : 'Alerts enabled'
                          }`
                        : 'Not set (edit profile to add email alerts)'}
                    </p>
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
    </div>
  )
}
