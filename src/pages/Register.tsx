import React, { useState } from 'react'
import { supabase } from '@/lib/supabase'
import { ImageCropperModal } from '@/components/ImageCropperModal'
import { BackButton } from '@/components/BackButton'
import {
  Profile,
  addMyProfile,
  generateProfileId,
  getMyProfiles,
} from '@/utils/profileStorage'
import { UserPlus, ShieldCheck, Camera, CheckCircle2, AlertCircle } from 'lucide-react'

const VILLAGES: Record<string, string[]> = {
  "Maruleng": ["Lorraine", "Sekororo", "Trichardtsdal", "The Oaks", "Hoedspruit", "Makhutsi"],
  "Greater Tzaneen": ["Tzaneen", "Lenyenye", "Letsitele", "Maake", "Nkowankowa"],
  "Greater Letaba": ["Modjadjiskloof", "Ga-Kgapane", "Mokwakwaila"],
  "Ba-Phalaborwa": ["Phalaborwa", "Namakgale", "Lulekani", "Gravalotte"],
  "Greater Giyani": ["Giyani", "Dzumeri", "Nkomo"]
}

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
  photo_url: '',
  consent_popia: false,
}

export function Register({
  onComplete,
  onGoMyProfile,
  onBack,
}: {
  onComplete: () => void
  onGoMyProfile: () => void
  onBack: () => void
}) {
  const [form, setForm] = useState(initialFormState)
  const [existingCount, setExistingCount] = useState(() => getMyProfiles().length)
  const [cropperOpen, setCropperOpen] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [errorMsg, setErrorMsg] = useState('')
  const [successSubmitted, setSuccessSubmitted] = useState(false)

  const handleCropComplete = (croppedBase64: string) => {
    setForm((prev) => ({ ...prev, photo_url: croppedBase64 }))
    setErrorMsg('')
  }

  const handleCreateAnother = () => {
    setForm(initialFormState)
    setErrorMsg('')
    setSuccessSubmitted(false)
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setErrorMsg('')

    if (form.age < 18) {
      setErrorMsg('You must be 18+ to register.')
      return
    }
    if (!form.consent_popia) {
      setErrorMsg('POPIA consent is required.')
      return
    }
    if (!form.photo_url) {
      setErrorMsg('Please upload and crop a profile photo.')
      return
    }

    setSubmitting(true)
    try {
      const payload: Profile = {
        id: generateProfileId(),
        full_name: form.full_name.trim(),
        age: form.age,
        gender: form.gender,
        municipality: form.municipality,
        village: form.village,
        language: form.language,
        intention: form.intention,
        bio: form.bio.trim(),
        whatsapp: form.whatsapp.trim(),
        photo_url: form.photo_url,
        consent_popia: form.consent_popia,
        is_approved: false,
        is_banned: false,
        created_at: new Date().toISOString(),
      }

      let savedProfile: Profile = payload
      const { data, error } = await supabase
        .from('profiles')
        .insert([payload])
        .select()
        .single()

      if (error) {
        console.warn('Supabase insert error (using local storage fallback):', error.message)
      } else if (data) {
        savedProfile = data as Profile
      }

      const updatedList = addMyProfile(savedProfile)
      setExistingCount(updatedList.length)
      setSuccessSubmitted(true)
    } catch (err: any) {
      setErrorMsg('Submission error: ' + (err?.message || 'Unable to save profile'))
    } finally {
      setSubmitting(false)
    }
  }

  if (successSubmitted) {
    return (
      <div className="max-w-xl mx-auto px-4 py-16 text-center">
        <BackButton onClick={onBack} label="Back to Discover" />
        <div className="bg-white rounded-3xl p-8 md:p-12 shadow-xl border border-rose-100 space-y-6">
          <div className="w-16 h-16 bg-rose-100 text-rose-700 rounded-full flex items-center justify-center mx-auto">
            <CheckCircle2 className="w-10 h-10" />
          </div>
          <h2 className="text-2xl font-black text-gray-900">Submitted for Safety Review!</h2>
          <p className="text-sm text-gray-600 leading-relaxed">
            Your profile has been created and set as your active profile ({existingCount} {existingCount === 1 ? 'profile' : 'profiles'} saved on this device). Once approved by the admin safety team, it will appear in Discover & Smart Matches.
          </p>
          <div className="pt-4 flex flex-wrap gap-3 justify-center">
            <button
              onClick={onGoMyProfile}
              className="bg-rose-700 hover:bg-rose-800 text-white font-semibold px-6 py-3 rounded-2xl shadow-md transition text-sm"
            >
              View My Profiles
            </button>
            <button
              onClick={handleCreateAnother}
              className="bg-amber-500 hover:bg-amber-600 text-gray-900 font-semibold px-6 py-3 rounded-2xl shadow-md transition text-sm"
            >
              Create Another Profile
            </button>
            <button
              onClick={onComplete}
              className="bg-gray-100 hover:bg-gray-200 text-gray-700 font-semibold px-5 py-3 rounded-2xl transition text-sm"
            >
              Go to Discover
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
        <div className="text-center mb-8">
          <div className="inline-flex items-center gap-2 bg-rose-50 text-rose-700 px-3 py-1 rounded-full text-xs font-semibold mb-2">
            <ShieldCheck className="w-4 h-4" /> 18+ Verified Community • Multiple Profiles Supported
          </div>
          <h1 className="text-2xl sm:text-3xl font-black text-gray-900">
            {existingCount > 0 ? 'Create Another Mopani Singles Profile' : 'Create Your Mopani Singles Profile'}
          </h1>
          <p className="text-xs sm:text-sm text-gray-500 mt-1">
            {existingCount > 0
              ? `You currently have ${existingCount} ${existingCount === 1 ? 'profile' : 'profiles'}. Add another profile or switch anytime in My Profiles.`
              : 'Connect safely with singles in Maruleng, Tzaneen, Letaba, Phalaborwa, and Giyani.'}
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-5">
          {errorMsg && (
            <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-xl text-xs font-semibold flex items-center gap-2">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{errorMsg}</span>
            </div>
          )}

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
            <p className="text-xs text-gray-500 mb-3">Upload from device gallery or camera and crop your photo</p>
            <button
              type="button"
              onClick={() => setCropperOpen(true)}
              className="bg-rose-700 hover:bg-rose-800 text-white text-xs font-semibold px-4 py-2 rounded-xl shadow-sm transition flex items-center gap-1.5"
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
                className="w-full border border-gray-300 rounded-xl p-3 text-sm focus:ring-2 focus:ring-rose-500 focus:outline-none"
              />
            </div>
            <div>
              <label className="block text-xs font-bold text-gray-700 mb-1">Age (18+) *</label>
              <select
                required
                value={form.age}
                onChange={(e) => setForm({ ...form, age: parseInt(e.target.value, 10) || 25 })}
                className="w-full border border-gray-300 rounded-xl p-3 text-sm focus:ring-2 focus:ring-rose-500 focus:outline-none bg-white"
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
                className="w-full border border-gray-300 rounded-xl p-3 text-sm focus:ring-2 focus:ring-rose-500 focus:outline-none bg-white"
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
                className="w-full border border-gray-300 rounded-xl p-3 text-sm focus:ring-2 focus:ring-rose-500 focus:outline-none bg-white"
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
                className="w-full border border-gray-300 rounded-xl p-3 text-sm focus:ring-2 focus:ring-rose-500 focus:outline-none bg-white"
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
                className="w-full border border-gray-300 rounded-xl p-3 text-sm focus:ring-2 focus:ring-rose-500 focus:outline-none bg-white"
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
              className="w-full border border-gray-300 rounded-xl p-3 text-sm focus:ring-2 focus:ring-rose-500 focus:outline-none bg-white"
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
              <span className={`text-xs ${form.bio.length > 200 ? 'text-red-500 font-bold' : 'text-gray-400'}`}>
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
              className="w-full border border-gray-300 rounded-xl p-3 text-sm focus:ring-2 focus:ring-rose-500 focus:outline-none"
            />
            <p className="text-[11px] text-gray-500 mt-1">Your WhatsApp number is kept private and secure. It is only opened when someone clicks WhatsApp Chat on your card.</p>
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
              <strong className="text-gray-900 font-bold">POPIA & Safety Consent:</strong> I confirm I am 18+, consent to the processing of my personal info under POPIA, agree to no nude/inappropriate content, and understand I can request deletion anytime.
            </label>
          </div>

          <button
            type="submit"
            disabled={submitting}
            className="w-full bg-rose-700 hover:bg-rose-800 text-white font-bold py-3.5 rounded-2xl shadow-lg transition flex items-center justify-center gap-2 text-sm disabled:opacity-60"
          >
            <UserPlus className="w-4 h-4" /> {submitting ? 'Submitting...' : 'Submit Profile For Safety Review'}
          </button>
        </form>
      </div>

      <ImageCropperModal
        isOpen={cropperOpen}
        onClose={() => setCropperOpen(false)}
        onCropComplete={handleCropComplete}
      />
    </div>
  )
}
