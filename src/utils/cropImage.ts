import type { Area } from 'react-easy-crop'

export const MAX_PROFILE_IMAGE_SIZE = 500

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image()
    image.addEventListener('load', () => resolve(image))
    image.addEventListener('error', () => reject(new Error('Failed to load selected image')))
    if (/^https?:\/\//i.test(src)) {
      image.crossOrigin = 'anonymous'
    }
    image.src = src
  })
}

function getRadianAngle(degreeValue: number): number {
  return (degreeValue * Math.PI) / 180
}

function getRotatedSize(width: number, height: number, rotation: number) {
  const rotRad = getRadianAngle(rotation)
  return {
    width: Math.abs(Math.cos(rotRad) * width) + Math.abs(Math.sin(rotRad) * height),
    height: Math.abs(Math.sin(rotRad) * width) + Math.abs(Math.cos(rotRad) * height),
  }
}

export interface CroppedImageResult {
  blob: Blob
  dataUrl: string
  width: number
  height: number
}

export async function getCroppedResizedImage(
  imageSrc: string,
  pixelCrop: Area,
  rotation = 0,
  maxSize = MAX_PROFILE_IMAGE_SIZE
): Promise<CroppedImageResult> {
  const image = await loadImage(imageSrc)

  const rotCanvas = document.createElement('canvas')
  const rotCtx = rotCanvas.getContext('2d')
  if (!rotCtx) {
    throw new Error('Canvas 2D context is unavailable')
  }

  const rotRad = getRadianAngle(rotation)
  const { width: bBoxWidth, height: bBoxHeight } = getRotatedSize(
    image.naturalWidth || image.width,
    image.naturalHeight || image.height,
    rotation
  )

  rotCanvas.width = Math.max(1, Math.round(bBoxWidth))
  rotCanvas.height = Math.max(1, Math.round(bBoxHeight))

  rotCtx.translate(rotCanvas.width / 2, rotCanvas.height / 2)
  rotCtx.rotate(rotRad)
  rotCtx.translate(-(image.naturalWidth || image.width) / 2, -(image.naturalHeight || image.height) / 2)
  rotCtx.drawImage(image, 0, 0)

  const cropWidth = Math.max(1, Math.round(pixelCrop.width))
  const cropHeight = Math.max(1, Math.round(pixelCrop.height))
  const cropSide = Math.max(cropWidth, cropHeight)
  const targetSide = Math.min(maxSize, cropSide)

  const outCanvas = document.createElement('canvas')
  outCanvas.width = targetSide
  outCanvas.height = targetSide

  const outCtx = outCanvas.getContext('2d')
  if (!outCtx) {
    throw new Error('Output canvas 2D context is unavailable')
  }

  outCtx.fillStyle = '#ffffff'
  outCtx.fillRect(0, 0, targetSide, targetSide)
  outCtx.imageSmoothingEnabled = true
  outCtx.imageSmoothingQuality = 'high'

  outCtx.drawImage(
    rotCanvas,
    Math.max(0, Math.round(pixelCrop.x)),
    Math.max(0, Math.round(pixelCrop.y)),
    cropWidth,
    cropHeight,
    0,
    0,
    targetSide,
    targetSide
  )

  const dataUrl = outCanvas.toDataURL('image/jpeg', 0.88)

  const blob = await new Promise<Blob>((resolve, reject) => {
    outCanvas.toBlob(
      (result) => {
        if (result) {
          resolve(result)
        } else {
          reject(new Error('Could not generate cropped image blob'))
        }
      },
      'image/jpeg',
      0.88
    )
  })

  return {
    blob,
    dataUrl,
    width: targetSide,
    height: targetSide,
  }
}
