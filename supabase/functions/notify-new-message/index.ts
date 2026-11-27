import { createClient } from 'npm:@supabase/supabase-js@2'

const corsHeaders: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type, x-webhook-secret',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const FILE_MESSAGE_PREFIX = '__MOPANI_FILE__:'
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

interface MessageRecord {
  id?: string
  sender_id?: string
  receiver_id?: string
  content?: string
  created_at?: string
}

interface ProfileRecord {
  id: string
  full_name: string
  village?: string
  municipality?: string
  email?: string
  email_notifications?: boolean
  is_banned?: boolean
}

function jsonResponse(body: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      'Content-Type': 'application/json',
    },
  })
}

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  }
  return diff === 0
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

function formatMessagePreview(rawContent: string): string {
  const trimmed = (rawContent || '').trim()
  if (!trimmed) return 'Sent you a new private message.'

  if (trimmed.startsWith(FILE_MESSAGE_PREFIX)) {
    try {
      const parsed = JSON.parse(trimmed.slice(FILE_MESSAGE_PREFIX.length)) as {
        name?: string
        mime?: string
        caption?: string
      }
      const fileName = (parsed.name || 'attachment').trim()
      const mime = (parsed.mime || '').toLowerCase()
      const caption = (parsed.caption || '').trim()
      let label = `Sent a file: ${fileName}`
      if (mime.startsWith('image/')) {
        label = `Sent a photo: ${fileName}`
      } else if (mime.startsWith('video/')) {
        label = `Sent a video: ${fileName}`
      } else if (mime.startsWith('audio/')) {
        label = `Sent an audio message: ${fileName}`
      }
      const combined = caption ? `${label} — "${caption}"` : label
      return combined.length > 240 ? `${combined.slice(0, 237)}...` : combined
    } catch {
      return 'Sent you a file attachment.'
    }
  }

  return trimmed.length > 240 ? `${trimmed.slice(0, 237)}...` : trimmed
}

function sanitizeSubjectFragment(value: string): string {
  return value.replace(/[\r\n]+/g, ' ').trim().slice(0, 80)
}

function isMissingColumnError(errMessage: string | undefined): boolean {
  if (!errMessage) return false
  const lower = errMessage.toLowerCase()
  return (
    lower.includes('column') ||
    lower.includes('schema cache') ||
    lower.includes('pgrst204')
  )
}

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  if (req.method !== 'POST') {
    return jsonResponse({ ok: false, error: 'Method not allowed' }, 405)
  }

  const configuredWebhookSecret = (Deno.env.get('NOTIFY_WEBHOOK_SECRET') || '').trim()
  if (configuredWebhookSecret) {
    const providedSecret = (req.headers.get('x-webhook-secret') || '').trim()
    if (!providedSecret || !constantTimeEqual(providedSecret, configuredWebhookSecret)) {
      return jsonResponse({ ok: false, error: 'Unauthorized' }, 401)
    }
  }

  let payload: Record<string, unknown>
  try {
    payload = (await req.json()) as Record<string, unknown>
  } catch {
    return jsonResponse({ ok: false, error: 'Invalid JSON payload' }, 400)
  }

  // Support both Supabase Database Webhooks ({ type: 'INSERT', record: ... }) and direct invocations
  if (typeof payload.type === 'string' && payload.type !== 'INSERT') {
    return jsonResponse({ ok: true, skipped: true, reason: `ignored_event_${payload.type}` })
  }

  const record: MessageRecord =
    payload.record && typeof payload.record === 'object'
      ? (payload.record as MessageRecord)
      : {
          id:
            typeof payload.message_id === 'string'
              ? payload.message_id
              : typeof payload.id === 'string'
              ? payload.id
              : undefined,
          sender_id: typeof payload.sender_id === 'string' ? payload.sender_id : undefined,
          receiver_id: typeof payload.receiver_id === 'string' ? payload.receiver_id : undefined,
          content: typeof payload.content === 'string' ? payload.content : undefined,
          created_at: typeof payload.created_at === 'string' ? payload.created_at : undefined,
        }

  const messageId = (record.id || '').trim()
  const senderId = (record.sender_id || '').trim()
  const receiverId = (record.receiver_id || '').trim()

  if (!UUID_RE.test(senderId) || !UUID_RE.test(receiverId)) {
    return jsonResponse(
      { ok: false, error: 'Valid sender_id and receiver_id UUIDs are required' },
      400
    )
  }

  if (senderId === receiverId) {
    return jsonResponse({ ok: true, skipped: true, reason: 'self_message' })
  }

  const supabaseUrl = (Deno.env.get('SUPABASE_URL') || '').trim()
  const serviceKey = (
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ||
    Deno.env.get('SUPABASE_SECRET_KEY') ||
    ''
  ).trim()

  if (!supabaseUrl || !serviceKey) {
    return jsonResponse(
      { ok: false, error: 'Supabase service credentials are not configured' },
      500
    )
  }

  const supabase = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  // Claim idempotency lock via email_notified_at when messageId and column exist
  let claimedNotifiedLock = false
  let rawContent = typeof record.content === 'string' ? record.content : ''

  if (messageId && UUID_RE.test(messageId)) {
    const { data: claimedRows, error: claimErr } = await supabase
      .from('messages')
      .update({ email_notified_at: new Date().toISOString() })
      .eq('id', messageId)
      .is('email_notified_at', null)
      .select('id, content')

    if (!claimErr) {
      if (!claimedRows || claimedRows.length === 0) {
        return jsonResponse({
          ok: true,
          skipped: true,
          reason: 'already_notified_or_missing',
        })
      }
      claimedNotifiedLock = true
      if (!rawContent && typeof claimedRows[0]?.content === 'string') {
        rawContent = claimedRows[0].content
      }
    } else if (!isMissingColumnError(claimErr.message)) {
      console.warn('Could not update email_notified_at:', claimErr.message)
    }
  }

  const releaseClaim = async () => {
    if (claimedNotifiedLock && messageId && UUID_RE.test(messageId)) {
      await supabase
        .from('messages')
        .update({ email_notified_at: null })
        .eq('id', messageId)
    }
  }

  // Fetch sender & receiver profiles
  const { data: profiles, error: profileErr } = await supabase
    .from('profiles')
    .select('id, full_name, village, municipality, email, email_notifications, is_banned')
    .in('id', [senderId, receiverId])

  if (profileErr) {
    await releaseClaim()
    if (isMissingColumnError(profileErr.message)) {
      return jsonResponse({
        ok: true,
        skipped: true,
        reason: 'profiles_email_columns_not_migrated',
      })
    }
    return jsonResponse({ ok: false, error: profileErr.message }, 500)
  }

  const profileList = (profiles || []) as ProfileRecord[]
  const sender = profileList.find((p) => p.id === senderId)
  const receiver = profileList.find((p) => p.id === receiverId)

  if (!sender || !receiver) {
    await releaseClaim()
    return jsonResponse({ ok: true, skipped: true, reason: 'profile_not_found' })
  }

  if (sender.is_banned || receiver.is_banned) {
    await releaseClaim()
    return jsonResponse({ ok: true, skipped: true, reason: 'profile_banned' })
  }

  if (receiver.email_notifications === false) {
    return jsonResponse({ ok: true, skipped: true, reason: 'notifications_disabled' })
  }

  const recipientEmail = (receiver.email || '').trim().toLowerCase()
  if (!EMAIL_RE.test(recipientEmail)) {
    return jsonResponse({ ok: true, skipped: true, reason: 'no_valid_recipient_email' })
  }

  const resendApiKey = (Deno.env.get('RESEND_API_KEY') || '').trim()
  if (!resendApiKey) {
    await releaseClaim()
    return jsonResponse(
      { ok: false, error: 'RESEND_API_KEY secret is not configured' },
      500
    )
  }

  const fromEmail =
    (Deno.env.get('FROM_EMAIL') || '').trim() ||
    'Mopani Singles-v2 <onboarding@resend.dev>'
  const appUrl =
    (Deno.env.get('APP_URL') || '').trim() ||
    'https://ais-dev-t6ejmyhna5ixoh74wodopl-833765459038.europe-west2.run.app'

  const previewText = formatMessagePreview(rawContent)
  const senderName = sender.full_name || 'Someone'
  const receiverName = receiver.full_name || 'there'
  const senderLocation = [sender.village, sender.municipality].filter(Boolean).join(', ')

  const safeSenderName = escapeHtml(senderName)
  const safeReceiverName = escapeHtml(receiverName)
  const safeLocation = escapeHtml(senderLocation)
  const safePreview = escapeHtml(previewText)
  const safeAppUrl = escapeHtml(appUrl)

  const subject = `New private message from ${sanitizeSubjectFragment(senderName)} on Mopani Singles-v2`

  const html = `
<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${escapeHtml(subject)}</title>
  </head>
  <body style="margin:0;padding:24px;background-color:#fff1f2;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#1f2937;">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:560px;margin:0 auto;background:#ffffff;border-radius:20px;overflow:hidden;border:1px solid #fecdd3;">
      <tr>
        <td style="background:linear-gradient(135deg,#9f1239,#be123c,#d97706);padding:24px 28px;color:#ffffff;">
          <div style="font-size:12px;letter-spacing:0.08em;text-transform:uppercase;font-weight:700;opacity:0.9;">Mopani Singles-v2</div>
          <h1 style="margin:6px 0 0;font-size:20px;font-weight:800;">You have a new private message</h1>
        </td>
      </tr>
      <tr>
        <td style="padding:28px;">
          <p style="margin:0 0 14px;font-size:15px;line-height:1.5;">Hi <strong>${safeReceiverName}</strong>,</p>
          <p style="margin:0 0 18px;font-size:15px;line-height:1.5;">
            <strong>${safeSenderName}</strong>${safeLocation ? ` (${safeLocation})` : ''} sent you a private message:
          </p>
          <div style="background:#fff1f2;border-left:4px solid #be123c;border-radius:12px;padding:14px 16px;margin:0 0 24px;font-size:14px;line-height:1.55;color:#111827;">
            ${safePreview}
          </div>
          <a href="${safeAppUrl}" style="display:inline-block;background:#be123c;color:#ffffff;text-decoration:none;font-weight:700;font-size:14px;padding:12px 22px;border-radius:12px;">
            Open Mopani Singles Chat
          </a>
          <p style="margin:24px 0 0;font-size:12px;line-height:1.5;color:#6b7280;">
            You received this email because message notifications are enabled on your Mopani Singles-v2 profile. You can pause these emails anytime under My Profile.
          </p>
        </td>
      </tr>
    </table>
  </body>
</html>
`.trim()

  const text = [
    `Hi ${receiverName},`,
    '',
    `${senderName}${senderLocation ? ` (${senderLocation})` : ''} sent you a private message on Mopani Singles-v2:`,
    '',
    `"${previewText}"`,
    '',
    `Open Mopani Singles-v2 to reply: ${appUrl}`,
  ].join('\n')

  const resendResp = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${resendApiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: fromEmail,
      to: [recipientEmail],
      subject,
      html,
      text,
    }),
  })

  if (!resendResp.ok) {
    const errText = await resendResp.text()
    await releaseClaim()
    return jsonResponse(
      { ok: false, error: `Email delivery failed (${resendResp.status}): ${errText}` },
      502
    )
  }

  const resendData = (await resendResp.json()) as { id?: string }
  return jsonResponse({
    ok: true,
    notified: true,
    emailId: resendData.id || null,
  })
})
