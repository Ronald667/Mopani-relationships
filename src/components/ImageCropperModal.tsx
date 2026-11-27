import React, { useState, useRef, useEffect, useCallback } from 'react'
import Cropper, { type Area, type Point } from 'react-easy-crop'
import {
  Camera,
  Upload,
  Check,
  X,
  RotateCw,
  ZoomIn,
  Image as ImageIcon,
  AlertCircle,
} from 'lucide-react'
import { getCroppedResizedImage, MAX_PROFILE_IMAGE_SIZE } from '@/utils/cropImage'

interface ImageCropperModalProps {
  isOpen: boolean
  onClose: () => void
  onCropComplete: (croppedBase64: string, croppedBlob?: Blob) => void
}

export function ImageCropperModal({
  isOpen,
  onClose,
  onCropComplete,
}: ImageCropperModalProps) {
  const [imageSrc, setImageSrc] = useState<string | null>(null)
  const [crop, setCrop] = useState<Point>({ x: 0, y: 0 })
  const [zoom, setZoom] = useState<number>(1)
  const [rotation, setRotation] = useState<number>(0)
  const [croppedAreaPixels, setCroppedAreaPixels] = useState<Area | null>(null)
  const [processing, setProcessing] = useState<boolean>(false)
  const [errorMsg, setErrorMsg] = useState<string>('')

  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const cameraInputRef = useRef<HTMLInputElement | null>(null)
  const objectUrlRef = useRef<string | null>(null)

  const cleanupObjectUrl = useCallback(() => {
    if (objectUrlRef.current) {
      URL.revokeObjectURL(objectUrlRef.current)
      objectUrlRef.current = null
    }
  }, [])

  useEffect(() => {
    if (!isOpen) {
      cleanupObjectUrl()
      setImageSrc(null)
      setCrop({ x: 0, y: 0 })
      setZoom(1)
      setRotation(0)
      setCroppedAreaPixels(null)
      setProcessing(false)
      setErrorMsg('')
    }
  }, [isOpen, cleanupObjectUrl])

  useEffect(() => {
    return () => {
      cleanupObjectUrl()
    }
  }, [cleanupObjectUrl])

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setErrorMsg('')
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return

    if (!file.type.startsWith('image/')) {
      setErrorMsg('Please select a valid image file (JPG, PNG, or WebP).')
      return
    }

    if (file.size > 20 * 1024 * 1024) {
      setErrorMsg('Image file must be 20 MB or smaller.')
      return
    }

    cleanupObjectUrl()
    const nextUrl = URL.createObjectURL(file)
    objectUrlRef.current = nextUrl
    setImageSrc(nextUrl)
    setCrop({ x: 0, y: 0 })
    setZoom(1)
    setRotation(0)
    setCroppedAreaPixels(null)
  }

  const handleCropCompleteInternal = useCallback((_croppedArea: Area, pixels: Area) => {
    setCroppedAreaPixels(pixels)
  }, [])

  const handleResetImage = () => {
    cleanupObjectUrl()
    setImageSrc(null)
    setCrop({ x: 0, y: 0 })
    setZoom(1)
    setRotation(0)
    setCroppedAreaPixels(null)
    setErrorMsg('')
  }

  const handleSave = async () => {
    if (!imageSrc || !croppedAreaPixels || processing) return
    setProcessing(true)
    setErrorMsg('')
    try {
      const result = await getCroppedResizedImage(
        imageSrc,
        croppedAreaPixels,
        rotation,
        MAX_PROFILE_IMAGE_SIZE
      )
      onCropComplete(result.dataUrl, result.blob)
      onClose()
    } catch (err: unknown) {
      setErrorMsg(
        err instanceof Error ? err.message : 'Unable to crop and resize the selected photo.'
      )
    } finally {
      setProcessing(false)
    }
  }

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-xs">
      <div className="bg-white rounded-3xl max-w-md w-full p-6 shadow-2xl overflow-hidden flex flex-col">
        <div className="flex justify-between items-center mb-4">
          <h2 className="text-lg sm:text-xl font-bold text-gray-900 flex items-center gap-2">
            <Camera className="w-5 h-5 text-rose-700" />
            Crop & Upload Photo
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 text-gray-400 hover:text-gray-600 rounded-full hover:bg-gray-100"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {errorMsg && (
          <div className="mb-3 bg-red-50 border border-red-200 text-red-700 px-3 py-2.5 rounded-xl text-xs font-semibold flex items-center gap-2">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>{errorMsg}</span>
          </div>
        )}

        {!imageSrc ? (
          <div className="flex flex-col items-center justify-center border-2 border-dashed border-rose-300 rounded-2xl p-8 bg-rose-50/50 text-center space-y-4">
            <div className="w-16 h-16 bg-rose-100 text-rose-700 rounded-full flex items-center justify-center shadow-inner">
              <Upload className="w-8 h-8" />
            </div>
            <div>
              <p className="font-bold text-gray-900 text-base mb-1">
                Select a Photo from Your Device
              </p>
              <p className="text-xs text-gray-500 max-w-xs mx-auto">
                Crop to a square (1:1), auto-resized up to {MAX_PROFILE_IMAGE_SIZE}×
                {MAX_PROFILE_IMAGE_SIZE} px, and uploaded to Supabase.
              </p>
            </div>

            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={handleFileChange}
            />
            <input
              ref={cameraInputRef}
              type="file"
              accept="image/*"
              capture="environment"
              className="hidden"
              onChange={handleFileChange}
            />

            <div className="flex flex-col sm:flex-row gap-3 w-full pt-2">
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="flex-1 bg-rose-700 hover:bg-rose-800 text-white font-semibold py-3 px-4 rounded-xl shadow-md transition flex items-center justify-center gap-2 text-sm"
              >
                <ImageIcon className="w-4 h-4" /> Device Gallery / Files
              </button>
              <button
                type="button"
                onClick={() => cameraInputRef.current?.click()}
                className="flex-1 bg-gray-900 hover:bg-black text-white font-semibold py-3 px-4 rounded-xl shadow-md transition flex items-center justify-center gap-2 text-sm"
              >
                <Camera className="w-4 h-4 text-amber-400" /> Take Camera Photo
              </button>
            </div>
          </div>
        ) : (
          <div className="flex flex-col items-center">
            <p className="text-xs text-gray-500 mb-2 text-center">
              Drag to position inside the square • Max {MAX_PROFILE_IMAGE_SIZE}×
              {MAX_PROFILE_IMAGE_SIZE} px
            </p>

            <div className="relative w-full h-72 sm:h-80 rounded-2xl overflow-hidden bg-gray-900 border border-rose-200 shadow-inner">
              <Cropper
                image={imageSrc}
                crop={crop}
                zoom={zoom}
                rotation={rotation}
                aspect={1}
                minZoom={1}
                maxZoom={3}
                cropShape="rect"
                showGrid
                onCropChange={setCrop}
                onZoomChange={setZoom}
                onRotationChange={setRotation}
                onCropComplete={handleCropCompleteInternal}
              />
            </div>

            <div className="w-full mt-4 space-y-3">
              <div className="flex items-center gap-2">
                <ZoomIn className="w-4 h-4 text-gray-500 shrink-0" />
                <span className="text-xs text-gray-600 w-12">Zoom</span>
                <input
                  type="range"
                  min="1"
                  max="3"
                  step="0.05"
                  value={zoom}
                  onChange={(e) => setZoom(parseFloat(e.target.value))}
                  className="w-full accent-rose-600"
                />
              </div>

              <div className="flex items-center gap-2">
                <RotateCw className="w-4 h-4 text-gray-500 shrink-0" />
                <span className="text-xs text-gray-600 w-12">Rotate</span>
                <input
                  type="range"
                  min="0"
                  max="360"
                  step="90"
                  value={rotation}
                  onChange={(e) => setRotation(parseInt(e.target.value, 10))}
                  className="w-full accent-rose-600"
                />
                <button
                  type="button"
                  onClick={() => setRotation((prev) => (prev + 90) % 360)}
                  className="text-xs font-semibold text-rose-700 hover:text-rose-800 px-2 py-1 rounded-lg bg-rose-50 shrink-0"
                >
                  90°
                </button>
              </div>

              <div className="flex gap-3 pt-2">
                <button
                  type="button"
                  onClick={handleResetImage}
                  disabled={processing}
                  className="flex-1 bg-gray-100 hover:bg-gray-200 disabled:opacity-60 text-gray-700 font-medium py-2.5 rounded-xl text-sm transition"
                >
                  Choose Different
                </button>
                <button
                  type="button"
                  onClick={handleSave}
                  disabled={processing || !croppedAreaPixels}
                  className="flex-1 bg-rose-700 hover:bg-rose-800 disabled:opacity-60 text-white font-semibold py-2.5 rounded-xl text-sm shadow-md transition flex items-center justify-center gap-2"
                >
                  <Check className="w-4 h-4" />
                  {processing ? 'Processing...' : 'Crop & Use Photo'}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
