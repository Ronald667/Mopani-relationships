import React, { useState, useEffect, useRef, useCallback } from 'react'
import { supabase } from '@/lib/supabase'
import {
  ChatFileAttachment,
  encodeFileMessageContent,
  formatFileSize,
  getMessagePreviewText,
  parseMessageContent,
  uploadFileToSupabase,
} from '@/lib/supabase/storage'
import { BackButton } from '@/components/BackButton'
import { ProfileAvatar } from '@/components/ProfileAvatar'
import {
  Profile,
  PrivateMessage,
  appendLocalThreadMessage,
  fetchApprovedProfiles,
  fetchProfileById,
  generateProfileId,
  getActiveProfileId,
  getAllLocalConversationsForProfile,
  getLastSeenTimestamp,
  getLocalProfiles,
  getLocalThreadMessages,
  getMyProfiles,
  getPrivatePairKey,
  markThreadAsSeen,
  normalizePhone,
  setActiveProfileId,
} from '@/utils/profileStorage'
import {
  MessageCircle,
  Send,
  CheckCheck,
  Lock,
  UserPlus,
  Users,
  Paperclip,
  FileText,
  Download,
  X,
  FolderOpen,
  Search,
  AlertCircle,
} from 'lucide-react'

interface Conversation {
  profileId: string
  profileName: string
  profilePhoto: string
  village: string
  municipality: string
  whatsapp: string
  lastMessage: string
  lastTime: string
  lastTimestamp: number
  unreadCount: number
}

const MAX_CHAT_FILE_BYTES = 15 * 1024 * 1024

function formatMessageTime(iso: string): string {
  const ts = new Date(iso)
  if (Number.isNaN(ts.getTime())) return ''
  return ts.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

export function Chat({
  initialChatId,
  onGoRegister,
  onGoMyProfile,
  onBack,
}: {
  initialChatId?: string
  onGoRegister: () => void
  onGoMyProfile: () => void
  onBack: () => void
}) {
  const [myProfiles, setMyProfiles] = useState<Profile[]>(() => getMyProfiles())
  const [senderProfileId, setSenderProfileId] = useState<string>(() => getActiveProfileId())
  const [conversations, setConversations] = useState<Conversation[]>([])
  const [activeChatId, setActiveChatId] = useState<string>('')
  const [messages, setMessages] = useState<PrivateMessage[]>([])
  const [inputText, setInputText] = useState('')
  const [selectedFile, setSelectedFile] = useState<File | null>(null)
  const [sending, setSending] = useState(false)
  const [chatError, setChatError] = useState('')
  const [searchTerm, setSearchTerm] = useState('')
  const [showSharedFiles, setShowSharedFiles] = useState(false)
  const [loadingThreads, setLoadingThreads] = useState(true)

  const messagesEndRef = useRef<HTMLDivElement | null>(null)
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const broadcastRef = useRef<BroadcastChannel | null>(null)
  const activeChatIdRef = useRef<string>('')

  useEffect(() => {
    activeChatIdRef.current = activeChatId
  }, [activeChatId])

  const activeSenderProfile = myProfiles.find((p) => p.id === senderProfileId) || myProfiles[0] || null

  const buildConversations = useCallback(async (currentSenderId: string, preferredChatId?: string) => {
    if (!currentSenderId) {
      setConversations([])
      setActiveChatId('')
      setLoadingThreads(false)
      return
    }

    setLoadingThreads(true)
    try {
      const approvedProfiles = await fetchApprovedProfiles()
      const localAll = getLocalProfiles()
      const ownOthers = getMyProfiles().filter((p) => p.id !== currentSenderId)

      const profileDirectory = new Map<string, Profile>()
      for (const p of [...approvedProfiles, ...ownOthers]) {
        if (p.id !== currentSenderId && !p.is_banned) {
          profileDirectory.set(p.id, p)
        }
      }

      const localThreadMap = getAllLocalConversationsForProfile(currentSenderId)
      const remoteThreadMap: Record<string, PrivateMessage[]> = {}

      try {
        const { data, error } = await supabase
          .from('messages')
          .select('*')
          .or(`sender_id.eq.${currentSenderId},receiver_id.eq.${currentSenderId}`)
          .order('created_at', { ascending: true })

        if (!error && data) {
          for (const msg of data as PrivateMessage[]) {
            const peerId = msg.sender_id === currentSenderId ? msg.receiver_id : msg.sender_id
            if (!peerId || peerId === currentSenderId) continue
            if (!remoteThreadMap[peerId]) remoteThreadMap[peerId] = []
            remoteThreadMap[peerId].push(msg)
            appendLocalThreadMessage(msg)
          }
        }
      } catch {
        // fall back to local threads
      }

      const peerIdsWithMessages = new Set([
        ...Object.keys(localThreadMap),
        ...Object.keys(remoteThreadMap),
      ])

      for (const peerId of peerIdsWithMessages) {
        if (!profileDirectory.has(peerId)) {
          const remoteOrLocal = localAll.find((lp) => lp.id === peerId) || (await fetchProfileById(peerId))
          if (remoteOrLocal && !remoteOrLocal.is_banned) {
            profileDirectory.set(peerId, remoteOrLocal)
          }
        }
      }

      const convList: Conversation[] = Array.from(profileDirectory.values()).map((peer) => {
        const mergedMap = new Map<string, PrivateMessage>()
        for (const m of localThreadMap[peer.id] || []) mergedMap.set(m.id, m)
        for (const m of remoteThreadMap[peer.id] || []) mergedMap.set(m.id, m)

        const sorted = Array.from(mergedMap.values()).sort(
          (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
        )
        const latest = sorted[sorted.length - 1]
        const lastSeen = getLastSeenTimestamp(currentSenderId, peer.id)
        const unreadCount = sorted.filter(
          (m) =>
            m.sender_id === peer.id &&
            m.receiver_id === currentSenderId &&
            new Date(m.created_at).getTime() > lastSeen
        ).length

        return {
          profileId: peer.id,
          profileName: peer.full_name,
          profilePhoto: peer.photo_url || '',
          village: peer.village || 'Mopani',
          municipality: peer.municipality || 'Limpopo',
          whatsapp: peer.whatsapp || '',
          lastMessage: latest ? getMessagePreviewText(latest.content) : 'Private chat — no messages yet',
          lastTime: latest ? formatMessageTime(latest.created_at) : '',
          lastTimestamp: latest ? new Date(latest.created_at).getTime() : 0,
          unreadCount,
        }
      })

      convList.sort((a, b) => {
        if (b.lastTimestamp !== a.lastTimestamp) return b.lastTimestamp - a.lastTimestamp
        return a.profileName.localeCompare(b.profileName)
      })

      setConversations(convList)

      if (preferredChatId && convList.some((c) => c.profileId === preferredChatId)) {
        setActiveChatId(preferredChatId)
        markThreadAsSeen(currentSenderId, preferredChatId)
      } else if (convList.length > 0) {
        setActiveChatId((prev) => {
          if (prev && convList.some((c) => c.profileId === prev)) return prev
          return convList[0].profileId
        })
      } else {
        setActiveChatId('')
      }
    } finally {
      setLoadingThreads(false)
    }
  }, [])

  useEffect(() => {
    const mine = getMyProfiles()
    setMyProfiles(mine)
    const activeId = getActiveProfileId()
    setSenderProfileId(activeId)
    buildConversations(activeId, initialChatId)
  }, [initialChatId, buildConversations])

  const loadActiveThread = useCallback(async (currentSenderId: string, peerId: string) => {
    if (!currentSenderId || !peerId) {
      setMessages([])
      return
    }

    const localMsgs = getLocalThreadMessages(currentSenderId, peerId)
    const merged = new Map<string, PrivateMessage>()
    for (const m of localMsgs) merged.set(m.id, m)

    try {
      const { data, error } = await supabase
        .from('messages')
        .select('*')
        .or(
          `and(sender_id.eq.${currentSenderId},receiver_id.eq.${peerId}),and(sender_id.eq.${peerId},receiver_id.eq.${currentSenderId})`
        )
        .order('created_at', { ascending: true })

      if (!error && data) {
        for (const m of data as PrivateMessage[]) {
          merged.set(m.id, m)
          appendLocalThreadMessage(m)
        }
      }
    } catch {
      // keep local messages
    }

    const sorted = Array.from(merged.values()).sort(
      (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
    )
    setMessages(sorted)
    markThreadAsSeen(currentSenderId, peerId)
  }, [])

  useEffect(() => {
    if (!senderProfileId || !activeChatId) {
      setMessages([])
      return
    }
    loadActiveThread(senderProfileId, activeChatId)
  }, [senderProfileId, activeChatId, loadActiveThread])

  // Global realtime listener for ALL incoming/outgoing messages for senderProfileId + new user profiles
  useEffect(() => {
    if (!senderProfileId) return

    const handleIncomingMessage = async (newMsg: PrivateMessage) => {
      const involvesSender =
        newMsg.sender_id === senderProfileId || newMsg.receiver_id === senderProfileId
      if (!involvesSender) return

      const peerId = newMsg.sender_id === senderProfileId ? newMsg.receiver_id : newMsg.sender_id
      if (!peerId || peerId === senderProfileId) return

      appendLocalThreadMessage(newMsg)

      const currentActivePeer = activeChatIdRef.current
      if (peerId === currentActivePeer) {
        setMessages((prev) => (prev.some((m) => m.id === newMsg.id) ? prev : [...prev, newMsg]))
        markThreadAsSeen(senderProfileId, peerId)
      }

      const preview = getMessagePreviewText(newMsg.content)
      const timeLabel = formatMessageTime(newMsg.created_at)
      const msgTs = new Date(newMsg.created_at).getTime()

      setConversations((prev) => {
        const exists = prev.some((c) => c.profileId === peerId)
        if (exists) {
          const updated = prev.map((c) =>
            c.profileId === peerId
              ? {
                  ...c,
                  lastMessage: preview,
                  lastTime: timeLabel,
                  lastTimestamp: msgTs,
                  unreadCount:
                    peerId === currentActivePeer
                      ? 0
                      : newMsg.sender_id === peerId
                      ? c.unreadCount + 1
                      : c.unreadCount,
                }
              : c
          )
          updated.sort((a, b) => b.lastTimestamp - a.lastTimestamp)
          return updated
        }
        return prev
      })

      // If this peer wasn't in our conversation list yet, fetch their profile and add them
      const peerProfile = await fetchProfileById(peerId)
      if (peerProfile && !peerProfile.is_banned) {
        setConversations((prev) => {
          if (prev.some((c) => c.profileId === peerId)) return prev
          const newConv: Conversation = {
            profileId: peerProfile.id,
            profileName: peerProfile.full_name,
            profilePhoto: peerProfile.photo_url || '',
            village: peerProfile.village || 'Mopani',
            municipality: peerProfile.municipality || 'Limpopo',
            whatsapp: peerProfile.whatsapp || '',
            lastMessage: preview,
            lastTime: timeLabel,
            lastTimestamp: msgTs,
            unreadCount: peerId === currentActivePeer ? 0 : 1,
          }
          return [newConv, ...prev]
        })
      }
    }

    const msgChannel = supabase
      .channel(`user-inbox-${senderProfileId}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'messages' },
        (payload) => {
          handleIncomingMessage(payload.new as PrivateMessage)
        }
      )
      .subscribe()

    const profileChannel = supabase
      .channel(`user-directory-${senderProfileId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'profiles' },
        () => {
          buildConversations(senderProfileId, activeChatIdRef.current)
        }
      )
      .subscribe()

    if (typeof BroadcastChannel !== 'undefined') {
      broadcastRef.current = new BroadcastChannel('mopani_private_chat')
      broadcastRef.current.onmessage = (event) => {
        const incoming = event.data as PrivateMessage
        if (incoming) handleIncomingMessage(incoming)
      }
    }

    const handleStorage = () => {
      if (activeChatIdRef.current) {
        loadActiveThread(senderProfileId, activeChatIdRef.current)
      }
    }
    window.addEventListener('storage', handleStorage)

    return () => {
      supabase.removeChannel(msgChannel)
      supabase.removeChannel(profileChannel)
      broadcastRef.current?.close()
      broadcastRef.current = null
      window.removeEventListener('storage', handleStorage)
    }
  }, [senderProfileId, buildConversations, loadActiveThread])

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  const handleSwitchSenderProfile = (newSenderId: string) => {
    setActiveProfileId(newSenderId)
    setSenderProfileId(newSenderId)
    setActiveChatId('')
    setSelectedFile(null)
    setShowSharedFiles(false)
    buildConversations(newSenderId)
  }

  const handleFilePick = (e: React.ChangeEvent<HTMLInputElement>) => {
    setChatError('')
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return

    if (file.size > MAX_CHAT_FILE_BYTES) {
      setChatError('File size must be 15 MB or smaller.')
      return
    }
    setSelectedFile(file)
  }

  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault()
    if ((!inputText.trim() && !selectedFile) || !activeChatId || !senderProfileId || sending) return

    setChatError('')
    setSending(true)

    try {
      const text = inputText.trim()
      let messageContent = text

      if (selectedFile) {
        const pairKey = getPrivatePairKey(senderProfileId, activeChatId)
        const uploadRes = await uploadFileToSupabase(
          selectedFile,
          'chat',
          selectedFile.name,
          pairKey
        )

        if (!uploadRes.url) {
          setChatError(
            uploadRes.error
              ? `Could not upload file to Supabase Storage (${uploadRes.error}). Check your Supabase anon key and mopani-files bucket.`
              : 'Could not upload file. Please try a smaller file or verify Supabase Storage setup.'
          )
          setSending(false)
          return
        }

        const attachment: ChatFileAttachment = {
          url: uploadRes.url,
          name: uploadRes.fileName,
          mime: uploadRes.fileType,
          size: uploadRes.fileSize,
          caption: text || undefined,
          storedInSupabase: uploadRes.storedInSupabase,
        }
        messageContent = encodeFileMessageContent(attachment)
      }

      setInputText('')
      setSelectedFile(null)

      const optimisticId = generateProfileId()
      const nowIso = new Date().toISOString()
      const newMsg: PrivateMessage = {
        id: optimisticId,
        sender_id: senderProfileId,
        receiver_id: activeChatId,
        content: messageContent,
        created_at: nowIso,
      }

      setMessages((prev) => [...prev, newMsg])
      appendLocalThreadMessage(newMsg)
      markThreadAsSeen(senderProfileId, activeChatId)
      broadcastRef.current?.postMessage(newMsg)

      const preview = getMessagePreviewText(messageContent)
      const timeLabel = formatMessageTime(nowIso)

      setConversations((prev) =>
        prev.map((c) =>
          c.profileId === activeChatId
            ? {
                ...c,
                lastMessage: preview,
                lastTime: timeLabel,
                lastTimestamp: new Date(nowIso).getTime(),
                unreadCount: 0,
              }
            : c
        )
      )

      const { data, error } = await supabase
        .from('messages')
        .insert([
          {
            id: optimisticId,
            sender_id: senderProfileId,
            receiver_id: activeChatId,
            content: messageContent,
          },
        ])
        .select()
        .single()

      if (error) {
        console.warn('Supabase message insert notice:', error.message)
      } else if (data) {
        appendLocalThreadMessage(data as PrivateMessage)
      }
    } finally {
      setSending(false)
    }
  }

  if (myProfiles.length === 0 || !activeSenderProfile) {
    return (
      <div className="max-w-xl mx-auto px-4 py-16">
        <BackButton onClick={onBack} label="Back to Discover" />
        <div className="bg-white rounded-3xl p-8 sm:p-12 shadow-xl border border-rose-100 text-center space-y-5">
          <div className="w-16 h-16 bg-rose-100 text-rose-700 rounded-full flex items-center justify-center mx-auto">
            <Lock className="w-8 h-8" />
          </div>
          <h2 className="text-2xl font-black text-gray-900">Create a Profile to Chat Privately</h2>
          <p className="text-sm text-gray-600 leading-relaxed">
            Private 1-on-1 conversations and file sharing are scoped to your profile so nobody else can view your messages. Create one or more profiles to start chatting with other app users.
          </p>
          <button
            onClick={onGoRegister}
            className="bg-rose-700 hover:bg-rose-800 text-white font-bold px-6 py-3 rounded-2xl shadow-md transition inline-flex items-center gap-2 text-sm"
          >
            <UserPlus className="w-4 h-4" /> Create Your Profile
          </button>
        </div>
      </div>
    )
  }

  const filteredConversations = conversations.filter((c) => {
    if (!searchTerm.trim()) return true
    const q = searchTerm.toLowerCase()
    return (
      c.profileName.toLowerCase().includes(q) ||
      c.village.toLowerCase().includes(q) ||
      c.municipality.toLowerCase().includes(q)
    )
  })

  const activeConversation = conversations.find((c) => c.profileId === activeChatId)
  const activeWaNumber = activeConversation ? normalizePhone(activeConversation.whatsapp) : ''

  const sharedFilesInThread = messages
    .map((m) => ({ msg: m, parsed: parseMessageContent(m.content) }))
    .filter((item) => item.parsed.isFile && item.parsed.attachment)

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
      <BackButton onClick={onBack} label="Back to Discover" />

      <div className="bg-white rounded-3xl shadow-xl border border-rose-100 overflow-hidden grid grid-cols-1 md:grid-cols-3 h-[76vh]">
        <div className="border-r border-gray-100 flex flex-col bg-gray-50/50 min-h-0">
          <div className="p-4 border-b border-gray-100 bg-white space-y-3">
            <div>
              <h2 className="text-lg font-black text-gray-900 flex items-center gap-2">
                <Lock className="w-4 h-4 text-rose-600" /> Private Messages
              </h2>
              <p className="text-xs text-gray-500">Real-time chat & file sharing with app users</p>
            </div>

            <div className="bg-rose-50/70 border border-rose-100 rounded-xl p-2.5">
              <div className="flex items-center justify-between mb-1">
                <label className="text-[10px] font-bold uppercase tracking-wider text-rose-700">
                  Chatting As
                </label>
                <button
                  type="button"
                  onClick={onGoMyProfile}
                  className="text-[10px] font-semibold text-rose-700 hover:underline"
                >
                  Manage Profiles ({myProfiles.length})
                </button>
              </div>
              <select
                value={senderProfileId}
                onChange={(e) => handleSwitchSenderProfile(e.target.value)}
                className="w-full bg-white border border-rose-200 rounded-lg px-2.5 py-1.5 text-xs font-semibold text-gray-800 focus:outline-none focus:ring-2 focus:ring-rose-500"
              >
                {myProfiles.map((mp) => (
                  <option key={mp.id} value={mp.id}>
                    {mp.full_name} ({mp.age}, {mp.village})
                  </option>
                ))}
              </select>
            </div>

            <div className="relative">
              <Search className="w-3.5 h-3.5 text-gray-400 absolute left-3 top-2.5" />
              <input
                type="text"
                placeholder="Search users..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full pl-8 pr-3 py-1.5 bg-gray-50 border border-gray-200 rounded-lg text-xs focus:outline-none focus:ring-2 focus:ring-rose-500"
              />
            </div>
          </div>

          <div className="flex-1 overflow-y-auto divide-y divide-gray-100">
            {loadingThreads ? (
              <div className="p-6 text-center text-xs text-gray-400">Loading private chats...</div>
            ) : filteredConversations.length === 0 ? (
              <div className="p-6 text-center space-y-3">
                <Users className="w-8 h-8 text-gray-300 mx-auto" />
                <p className="text-xs font-semibold text-gray-700">No contacts found</p>
                <p className="text-[11px] text-gray-500">
                  Other registered Mopani Singles users will appear here as soon as they join.
                </p>
              </div>
            ) : (
              filteredConversations.map((c) => {
                const isSelected = activeChatId === c.profileId
                return (
                  <div
                    key={c.profileId}
                    onClick={() => {
                      setActiveChatId(c.profileId)
                      setShowSharedFiles(false)
                      markThreadAsSeen(senderProfileId, c.profileId)
                      setConversations((prev) =>
                        prev.map((item) =>
                          item.profileId === c.profileId ? { ...item, unreadCount: 0 } : item
                        )
                      )
                    }}
                    className={`p-4 flex items-center gap-3 cursor-pointer transition ${
                      isSelected ? 'bg-rose-50/90 ring-1 ring-inset ring-rose-200' : 'hover:bg-white'
                    }`}
                  >
                    <ProfileAvatar
                      src={c.profilePhoto}
                      name={c.profileName}
                      className="w-12 h-12 rounded-full shadow-sm shrink-0"
                    />
                    <div className="flex-1 min-w-0">
                      <div className="flex justify-between items-baseline mb-1 gap-2">
                        <h3 className="text-sm font-bold text-gray-900 truncate">{c.profileName}</h3>
                        {c.lastTime && <span className="text-[10px] text-gray-400 shrink-0">{c.lastTime}</span>}
                      </div>
                      <p className="text-xs text-gray-600 truncate">{c.lastMessage}</p>
                    </div>
                    {c.unreadCount > 0 && (
                      <span className="bg-rose-600 text-white text-[10px] font-bold w-5 h-5 rounded-full flex items-center justify-center shrink-0">
                        {c.unreadCount}
                      </span>
                    )}
                  </div>
                )
              })
            )}
          </div>
        </div>

        <div className="md:col-span-2 flex flex-col bg-white min-h-0">
          {activeConversation ? (
            <>
              <div className="p-4 border-b border-gray-100 flex flex-wrap items-center justify-between gap-2 bg-white shadow-xs">
                <div className="flex items-center gap-3">
                  <ProfileAvatar
                    src={activeConversation.profilePhoto}
                    name={activeConversation.profileName}
                    className="w-10 h-10 rounded-full shadow-xs shrink-0"
                    textSizeClass="text-xs"
                  />
                  <div>
                    <h3 className="text-sm font-bold text-gray-900">{activeConversation.profileName}</h3>
                    <p className="text-[11px] text-rose-600 font-medium flex items-center gap-1">
                      <Lock className="w-3 h-3" /> Private chat • {activeConversation.village}, {activeConversation.municipality}
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setShowSharedFiles((prev) => !prev)}
                    className={`text-xs font-semibold px-3 py-2 rounded-xl transition flex items-center gap-1.5 border ${
                      showSharedFiles
                        ? 'bg-rose-50 border-rose-300 text-rose-800'
                        : 'bg-gray-50 border-gray-200 text-gray-700 hover:bg-gray-100'
                    }`}
                  >
                    <FolderOpen className="w-3.5 h-3.5" />
                    Files ({sharedFilesInThread.length})
                  </button>

                  {activeWaNumber && (
                    <a
                      href={`https://wa.me/${activeWaNumber}?text=Hi%20${encodeURIComponent(activeConversation.profileName)},%20messaging%20you%20from%20Mopani%20Singles-v2!`}
                      target="_blank"
                      rel="noreferrer"
                      className="bg-rose-600 text-white text-xs font-semibold px-3.5 py-2 rounded-xl shadow-xs hover:bg-rose-700 transition flex items-center gap-1.5"
                    >
                      <MessageCircle className="w-4 h-4 fill-white text-rose-600" /> WhatsApp
                    </a>
                  )}
                </div>
              </div>

              {showSharedFiles ? (
                <div className="flex-1 overflow-y-auto p-5 bg-gray-50/50 space-y-4">
                  <div className="flex items-center justify-between">
                    <h4 className="text-sm font-bold text-gray-900">
                      Shared Files with {activeConversation.profileName}
                    </h4>
                    <button
                      onClick={() => setShowSharedFiles(false)}
                      className="text-xs text-rose-700 font-semibold hover:underline"
                    >
                      Back to Messages
                    </button>
                  </div>
                  {sharedFilesInThread.length === 0 ? (
                    <div className="bg-white rounded-2xl border border-gray-200 p-10 text-center text-xs text-gray-500">
                      No files shared in this conversation yet. Use the paperclip button below to upload and share photos or documents via Supabase Storage.
                    </div>
                  ) : (
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      {sharedFilesInThread.map(({ msg, parsed }) => {
                        const file = parsed.attachment!
                        const isImage = file.mime?.startsWith('image/')
                        return (
                          <div
                            key={msg.id}
                            className="bg-white border border-rose-100 rounded-2xl p-3 flex items-center gap-3 shadow-xs"
                          >
                            {isImage ? (
                              <img
                                src={file.url}
                                alt={file.name}
                                className="w-14 h-14 rounded-xl object-cover shrink-0 bg-gray-100"
                              />
                            ) : (
                              <div className="w-14 h-14 rounded-xl bg-rose-50 text-rose-700 flex items-center justify-center shrink-0">
                                <FileText className="w-6 h-6" />
                              </div>
                            )}
                            <div className="flex-1 min-w-0">
                              <p className="text-xs font-bold text-gray-900 truncate">{file.name}</p>
                              <p className="text-[11px] text-gray-500">
                                {formatFileSize(file.size)} • {formatMessageTime(msg.created_at)}
                              </p>
                              <a
                                href={file.url}
                                target="_blank"
                                rel="noreferrer"
                                download={file.name}
                                className="inline-flex items-center gap-1 text-[11px] font-semibold text-rose-700 hover:underline mt-1"
                              >
                                <Download className="w-3 h-3" /> Open / Download
                              </a>
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  )}
                </div>
              ) : (
                <div className="flex-1 overflow-y-auto p-4 space-y-3 bg-gradient-to-b from-gray-50/50 to-rose-50/20">
                  {messages.length === 0 ? (
                    <div className="h-full flex flex-col items-center justify-center text-center px-6 py-12">
                      <div className="w-12 h-12 rounded-full bg-rose-50 text-rose-600 flex items-center justify-center mb-3">
                        <Lock className="w-5 h-5" />
                      </div>
                      <p className="text-sm font-bold text-gray-800">
                        Private conversation with {activeConversation.profileName}
                      </p>
                      <p className="text-xs text-gray-500 mt-1 max-w-sm">
                        Only {activeSenderProfile.full_name} and {activeConversation.profileName} can see messages and files in this thread. Send a message or attach a file below.
                      </p>
                    </div>
                  ) : (
                    messages.map((m) => {
                      const isMe = m.sender_id === senderProfileId
                      const parsed = parseMessageContent(m.content)
                      const attachment = parsed.attachment
                      const isImage = attachment?.mime?.startsWith('image/')

                      return (
                        <div key={m.id} className={`flex ${isMe ? 'justify-end' : 'justify-start'}`}>
                          <div
                            className={`max-w-[78%] rounded-2xl px-4 py-3 shadow-sm text-sm ${
                              isMe
                                ? 'bg-rose-700 text-white rounded-br-xs'
                                : 'bg-white text-gray-800 border border-rose-100 rounded-bl-xs'
                            }`}
                          >
                            {attachment && (
                              <div className="mb-2">
                                {isImage ? (
                                  <a
                                    href={attachment.url}
                                    target="_blank"
                                    rel="noreferrer"
                                    className="block overflow-hidden rounded-xl border border-black/10"
                                  >
                                    <img
                                      src={attachment.url}
                                      alt={attachment.name}
                                      className="max-h-60 w-auto object-cover rounded-xl"
                                    />
                                  </a>
                                ) : (
                                  <a
                                    href={attachment.url}
                                    target="_blank"
                                    rel="noreferrer"
                                    download={attachment.name}
                                    className={`flex items-center gap-2.5 p-2.5 rounded-xl border transition ${
                                      isMe
                                        ? 'bg-rose-800/80 border-rose-500/40 text-white hover:bg-rose-800'
                                        : 'bg-rose-50/70 border-rose-200 text-gray-900 hover:bg-rose-100/70'
                                    }`}
                                  >
                                    <FileText className="w-5 h-5 shrink-0" />
                                    <div className="min-w-0 flex-1">
                                      <p className="text-xs font-bold truncate">{attachment.name}</p>
                                      <p className={`text-[10px] ${isMe ? 'text-rose-200' : 'text-gray-500'}`}>
                                        {formatFileSize(attachment.size)}
                                      </p>
                                    </div>
                                    <Download className="w-4 h-4 shrink-0" />
                                  </a>
                                )}
                              </div>
                            )}

                            {parsed.text && <p className="leading-relaxed break-words">{parsed.text}</p>}

                            <div
                              className={`flex items-center justify-end gap-1 text-[10px] mt-1 ${
                                isMe ? 'text-rose-200' : 'text-gray-400'
                              }`}
                            >
                              <span>{formatMessageTime(m.created_at)}</span>
                              {isMe && <CheckCheck className="w-3.5 h-3.5 text-rose-300" />}
                            </div>
                          </div>
                        </div>
                      )
                    })
                  )}
                  <div ref={messagesEndRef} />
                </div>
              )}

              <div className="border-t border-gray-100 bg-white p-3 space-y-2">
                {chatError && (
                  <div className="bg-red-50 border border-red-200 text-red-700 text-xs font-semibold px-3 py-2 rounded-xl flex items-center gap-2">
                    <AlertCircle className="w-4 h-4 shrink-0" />
                    <span className="flex-1">{chatError}</span>
                    <button onClick={() => setChatError('')} className="text-red-500 hover:text-red-700">
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                )}

                {selectedFile && (
                  <div className="bg-rose-50 border border-rose-200 rounded-xl px-3 py-2 flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2 min-w-0">
                      <FileText className="w-4 h-4 text-rose-700 shrink-0" />
                      <span className="text-xs font-semibold text-gray-900 truncate">{selectedFile.name}</span>
                      <span className="text-[11px] text-gray-500 shrink-0">
                        ({formatFileSize(selectedFile.size)})
                      </span>
                    </div>
                    <button
                      type="button"
                      onClick={() => setSelectedFile(null)}
                      className="text-gray-500 hover:text-red-600 p-1"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                )}

                <form onSubmit={handleSendMessage} className="flex gap-2 items-center">
                  <input
                    ref={fileInputRef}
                    type="file"
                    onChange={handleFilePick}
                    className="hidden"
                  />
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    title="Attach photo or file"
                    className="p-3 rounded-xl border border-gray-200 text-gray-600 hover:text-rose-700 hover:border-rose-300 hover:bg-rose-50 transition shrink-0"
                  >
                    <Paperclip className="w-4 h-4" />
                  </button>
                  <input
                    type="text"
                    placeholder={`Message ${activeConversation.profileName} privately as ${activeSenderProfile.full_name}...`}
                    value={inputText}
                    onChange={(e) => setInputText(e.target.value)}
                    className="flex-1 border border-gray-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-rose-500"
                  />
                  <button
                    type="submit"
                    disabled={sending || (!inputText.trim() && !selectedFile)}
                    className="bg-rose-700 hover:bg-rose-800 disabled:opacity-50 text-white font-semibold px-5 py-3 rounded-xl shadow-md transition flex items-center gap-2 text-sm shrink-0"
                  >
                    <Send className="w-4 h-4" /> {sending ? 'Sending...' : 'Send'}
                  </button>
                </form>
              </div>
            </>
          ) : (
            <div className="flex-1 flex items-center justify-center text-gray-400 text-sm px-6 text-center">
              Select a profile from the sidebar to start a private conversation.
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
