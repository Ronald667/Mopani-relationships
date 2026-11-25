import { supabase, SUPABASE_STORAGE_BUCKET } from './client'

export interface UploadedFileResult {
  url: string
  path: string
  fileName: string
  fileType: string
  fileSize: number
  storedInSupabase: boolean
  error?: string
}

export interface ChatFileAttachment {
  url: string
  name: string
  mime: string
  size: number
  caption?: string
  storedInSupabase?: boolean
}

const FILE_MESSAGE_PREFIX = '__MOPANI_FILE__:'

function randomSuffix(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID().slice(0, 8)
  }
  return Math.random().toString(36).slice(2, 10)
}

function sanitizeFileName(name: string): string {
  const cleaned = (name || 'file')
    .replace(/[^a-zA-Z0-9._-]/g, '_')
    .replace(/_+/g, '_')
  return cleaned.slice(0, 80) || 'file'
}

export function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onloadend = () => {
      if (typeof reader.result === 'string') {
        resolve(reader.result)
      } else {
        reject(new Error('Failed to read file'))
      }
    }
    reader.onerror = () => reject(new Error('Failed to convert file'))
    reader.readAsDataURL(blob)
  })
}

export function dataUrlToBlob(dataUrl: string): Blob {
  const parts = dataUrl.split(',')
  const mimeMatch = parts[0].match(/:(.*?);/)
  const mime = mimeMatch ? mimeMatch[1] : 'image/jpeg'
  const byteString = atob(parts[1] || '')
  const buffer = new Uint8Array(byteString.length)
  for (let i = 0; i < byteString.length; i++) {
    buffer[i] = byteString.charCodeAt(i)
  }
  return new Blob([buffer], { type: mime })
}

export async function uploadFileToSupabase(
  file: File | Blob,
  folder: 'profiles' | 'chat' | 'shared',
  customFileName?: string,
  subPath?: string
): Promise<UploadedFileResult> {
  const originalName =
    customFileName ||
    (file instanceof File ? file.name : undefined) ||
    (file.type.startsWith('image/') ? 'photo.jpg' : 'attachment')
  const safeName = sanitizeFileName(originalName)
  const prefix = subPath ? `${folder}/${subPath}` : folder
  const storagePath = `${prefix}/${Date.now()}-${randomSuffix()}-${safeName}`
  const contentType = file.type || 'application/octet-stream'

  try {
    const { data, error } = await supabase.storage
      .from(SUPABASE_STORAGE_BUCKET)
      .upload(storagePath, file, {
        cacheControl: '3600',
        upsert: false,
        contentType,
      })

    if (error || !data) {
      throw new Error(error?.message || 'Supabase Storage upload failed')
    }

    const { data: urlData } = supabase.storage
      .from(SUPABASE_STORAGE_BUCKET)
      .getPublicUrl(data.path)

    return {
      url: urlData.publicUrl,
      path: data.path,
      fileName: originalName,
      fileType: contentType,
      fileSize: file.size,
      storedInSupabase: true,
    }
  } catch (err: any) {
    // Fallback to Data URL for smaller files if Storage bucket/key is not ready yet
    let fallbackUrl = ''
    if (file.size <= 2 * 1024 * 1024) {
      try {
        fallbackUrl = await blobToDataUrl(file)
      } catch {
        fallbackUrl = ''
      }
    }

    return {
      url: fallbackUrl,
      path: '',
      fileName: originalName,
      fileType: contentType,
      fileSize: file.size,
      storedInSupabase: false,
      error: err?.message || 'Could not upload file to Supabase Storage',
    }
  }
}

export async function uploadDataUrlToSupabase(
  dataUrl: string,
  folder: 'profiles' | 'chat' | 'shared',
  fileName = 'profile-photo.jpg'
): Promise<UploadedFileResult> {
  if (!dataUrl.startsWith('data:')) {
    return {
      url: dataUrl,
      path: '',
      fileName,
      fileType: 'image/jpeg',
      fileSize: 0,
      storedInSupabase: dataUrl.includes('/storage/v1/object/'),
    }
  }

  const blob = dataUrlToBlob(dataUrl)
  const result = await uploadFileToSupabase(blob, folder, fileName)
  if (!result.url) {
    return { ...result, url: dataUrl }
  }
  return result
}

export async function deleteStorageFileByUrl(publicUrl: string): Promise<void> {
  if (!publicUrl) return
  const marker = `/storage/v1/object/public/${SUPABASE_STORAGE_BUCKET}/`
  const idx = publicUrl.indexOf(marker)
  if (idx === -1) return

  const storagePath = decodeURIComponent(publicUrl.slice(idx + marker.length).split('?')[0])
  if (!storagePath) return

  try {
    await supabase.storage.from(SUPABASE_STORAGE_BUCKET).remove([storagePath])
  } catch {
    // best-effort cleanup
  }
}

export function encodeFileMessageContent(attachment: ChatFileAttachment): string {
  return `${FILE_MESSAGE_PREFIX}${JSON.stringify(attachment)}`
}

export function parseMessageContent(content: string): {
  isFile: boolean
  text: string
  attachment?: ChatFileAttachment
} {
  if (!content || !content.startsWith(FILE_MESSAGE_PREFIX)) {
    return { isFile: false, text: content || '' }
  }

  try {
    const parsed = JSON.parse(content.slice(FILE_MESSAGE_PREFIX.length)) as ChatFileAttachment
    if (parsed && parsed.url) {
      return {
        isFile: true,
        text: parsed.caption || '',
        attachment: parsed,
      }
    }
  } catch {
    // fall back to raw content
  }

  return { isFile: false, text: content }
}

export function getMessagePreviewText(content: string): string {
  const parsed = parseMessageContent(content)
  if (!parsed.isFile || !parsed.attachment) {
    return parsed.text
  }
  const isImage = parsed.attachment.mime?.startsWith('image/')
  const label = isImage ? `Photo: ${parsed.attachment.name}` : `File: ${parsed.attachment.name}`
  return parsed.attachment.caption ? `${label} — ${parsed.attachment.caption}` : label
}

export function formatFileSize(bytes: number): string {
  if (!bytes || bytes <= 0) return '0 B'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}
