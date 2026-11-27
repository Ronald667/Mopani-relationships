import React, { useEffect, useRef, useState } from 'react'
import {
  AlertCircle,
  Camera,
  CheckCircle2,
  Image as ImageIcon,
  ShieldCheck,
  Upload,
  X,
} from 'lucide-react'
import { Profile, requestProfileVerification } from '@/utils/profileStorage'
import { ProfileAvatar } from '@/components/ProfileAvatar'

interface SelfieVerificationModalProps {
  isOpen: boolean
  profile: Profile | null
  onClose: () => void
  onSubmitted: (updatedProfile: Profile) => void
}

const MAX_SELFIE_DIMENSION = 800

async function resizeSelfieToJpegDataUrl(file: File): Promise<string> {
  const objectUrl = URL.createObjectURL(file)
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image()
      el.onload = () => resolve(el)
      el.onerror = () => reject(new Error('Could not read the selected image file.'))
      el.src = objectUrl
    })

    const maxSide = Math.max(img.width, img.height)
    const scale = maxSide > MAX_SELFIE_DIMENSION ? MAX_SELFIE_DIMENSION / maxSide : 1
    const width = Math.max(1, Math.round(img.width * scale))
    const height = Math.max(1, Math.round(img.height * scale))

    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const ctx = canvas.getContext('2d')
    if (!ctx) {
      throw new Error('Image processing is unavailable in this browser.')
    }
    ctx.drawImage(img, 0, 0, width, height)
    const dataUrl = canvas.toDataURL('image/jpeg', 0.85)
    if (!dataUrl.startsWith('data:image/')) {
      throw new Error('Could not encode selfie image.')
    }
    return dataUrl
  } finally {
    URL.revokeObjectURL(objectUrl)
  }
}

export function SelfieVerificationModal({
  isOpen,
  profile,
  onClose,
  onSubmitted,
}: SelfieVerificationModalProps) {
  const [selfieDataUrl, setSelfieDataUrl] = useState<string>('')
  const [processingFile, setProcessingFile] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [errorMsg, setErrorMsg] = useState('')

  const cameraInputRef = useRef<HTMLInputElement | null>(null)
  const galleryInputRef = useRef<HTMLInputElement | null>(null)

  useEffect(() => {
    if (!isOpen) return
    setSelfieDataUrl('')
    setProcessingFile(false)
    setSubmitting(false)
    setErrorMsg('')
  }, [isOpen, profile?.id])

  if (!isOpen || !profile) return null

  const handleFileSelected = async (e: React.ChangeEvent<HTMLInputElement>) => {
    setErrorMsg('')
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return

    if (!file.type.startsWith('image/')) {
      setErrorMsg('Please select a valid photo (JPG, PNG, or WebP).')
      return
    }
    if (file.size > 20 * 1024 * 1024) {
      setErrorMsg('Image file must be 20 MB or smaller.')
      return
    }

    setProcessingFile(true)
    try {
      const processed = await resizeSelfieToJpegDataUrl(file)
      setSelfieDataUrl(processed)
    } catch (err: unknown) {
      setErrorMsg(err instanceof Error ? err.message : 'Unable to process selfie photo.')
    } finally {
      setProcessingFile(false)
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!selfieDataUrl || submitting) return
    setErrorMsg('')
    setSubmitting(true)
    try {
      const res = await requestProfileVerification(profile.id, selfieDataUrl)
      if (!res.ok || !res.profile) {
        setErrorMsg(res.error || 'Could not submit selfie for verification.')
        return
      }
      onSubmitted(res.profile)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/65 p-4 backdrop-blur-xs">
      <div className="bg-white rounded-3xl max-w-md w-full p-6 sm:p-7 shadow-2xl border border-rose-100 space-y-5 max-h-[92vh] overflow-y-auto">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <div className="w-10 h-10 rounded-full bg-rose-50 text-rose-700 flex items-center justify-center shrink-0">
              <ShieldCheck className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-lg font-bold text-gray-900">Request Profile Verification</h3>
              <p className="text-xs text-gray-500">Manual admin selfie review for {profile.full_name}</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close selfie verification"
            className="min-h-[44px] min-w-[44px] flex items-center justify-center text-gray-400 hover:text-gray-700 rounded-xl hover:bg-gray-100 transition"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <p className="text-xs sm:text-sm text-gray-600 leading-relaxed">
          Upload or take a clear selfie matching your profile photo. Our admin will manually review your selfie and update your profile status to <strong className="text-gray-900">Verified</strong> upon approval. Selfies are private and never displayed publicly.
        </p>

        {errorMsg && (
          <div className="bg-red-50 border border-red-200 text-red-700 px-3.5 py-2.5 rounded-xl text-xs font-semibold flex items-start gap-2">
            <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
            <span>{errorMsg}</span>
          </div>
        )}

        <input
          ref={cameraInputRef}
          type="file"
          accept="image/*"
          capture="user"
          onChange={handleFileSelected}
          className="hidden"
        />
        <input
          ref={galleryInputRef}
          type="file"
          accept="image/*"
          onChange={handleFileSelected}
          className="hidden"
        />

        <form onSubmit={handleSubmit} className="space-y-4">
          {!selfieDataUrl ? (
            <div className="border-2 border-dashed border-rose-200 bg-rose-50/40 rounded-2xl p-6 text-center space-y-4">
              <div className="flex items-center justify-center gap-4">
                <div className="text-center">
                  <ProfileAvatar
                    src={profile.photo_url}
                    name={profile.full_name}
                    className="w-16 h-16 rounded-full border-2 border-white shadow-sm mx-auto"
                    textSizeClass="text-sm"
                  />
                  <span className="block text-[11px] text-gray-500 mt-1">Profile Photo</span>
                </div>
                <span className="text-gray-300 text-lg font-light">+</span>
                <div className="text-center">
                  <div className="w-16 h-16 rounded-full bg-rose-100 text-rose-700 flex items-center justify-center mx-auto border-2 border-white shadow-sm">
                    <Camera className="w-6 h-6" />
                  </div>
                  <span className="block text-[11px] text-gray-500 mt-1">Your Selfie</span>
                </div>
              </div>

              <p className="text-xs text-gray-600">
                Make sure your face is well lit and clearly visible without sunglasses or filters.
              </p>

              <div className="flex flex-col sm:flex-row gap-2.5">
                <button
                  type="button"
                  disabled={processingFile}
                  onClick={() => cameraInputRef.current?.click()}
                  className="flex-1 min-h-[44px] bg-rose-700 hover:bg-rose-800 disabled:opacity-60 text-white font-semibold px-4 py-2.5 rounded-xl text-xs sm:text-sm shadow-sm transition flex items-center justify-center gap-2"
                >
                  <Camera className="w-4 h-4" />
                  {processingFile ? 'Preparing...' : 'Take Selfie'}
                </button>
                <button
                  type="button"
                  disabled={processingFile}
                  onClick={() => galleryInputRef.current?.click()}
                  className="flex-1 min-h-[44px] bg-gray-900 hover:bg-black disabled:opacity-60 text-white font-semibold px-4 py-2.5 rounded-xl text-xs sm:text-sm shadow-sm transition flex items-center justify-center gap-2"
                >
                  <ImageIcon className="w-4 h-4 text-amber-400" />
                  Upload Selfie
                </button>
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3 bg-gray-50 p-3 rounded-2xl border border-gray-100">
                <div className="text-center space-y-1.5">
                  <div className="aspect-square rounded-xl overflow-hidden bg-gray-200 border border-gray-200">
                    <ProfileAvatar
                      src={profile.photo_url}
                      name={profile.full_name}
                      className="w-full h-full"
                      textSizeClass="text-lg"
                    />
                  </div>
                  <span className="block text-[11px] font-semibold text-gray-600">Profile Photo</span>
                </div>
                <div className="text-center space-y-1.5">
                  <div className="aspect-square rounded-xl overflow-hidden bg-gray-200 border-2 border-rose-500">
                    <img
                      src={selfieDataUrl}
                      alt="Verification selfie preview"
                      className="w-full h-full object-cover"
                    />
                  </div>
                  <span className="block text-[11px] font-semibold text-rose-700">Selfie Preview</span>
                </div>
              </div>

              <div className="flex flex-wrap gap-2.5">
                <button
                  type="button"
                  disabled={submitting}
                  onClick={() => {
                    setSelfieDataUrl('')
                    setErrorMsg('')
                  }}
                  className="min-h-[44px] px-4 py-2.5 rounded-xl bg-gray-100 hover:bg-gray-200 text-gray-700 font-semibold text-xs sm:text-sm transition flex items-center gap-1.5"
                >
                  <Upload className="w-4 h-4" /> Retake / Change
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="flex-1 min-h-[44px] bg-rose-700 hover:bg-rose-800 disabled:opacity-60 text-white font-bold px-4 py-2.5 rounded-xl text-xs sm:text-sm shadow-md transition flex items-center justify-center gap-2"
                >
                  <CheckCircle2 className="w-4 h-4" />
                  {submitting ? 'Submitting Selfie...' : 'Submit Selfie for Verification'}
                </button>
              </div>
            </div>
          )}
        </form>
      </div>
    </div>
  )
}
