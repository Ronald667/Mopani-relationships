import React, { useState, useEffect, useRef, useCallback } from 'react'
import { supabase } from '@/lib/supabase'
import { BackButton } from '@/components/BackButton'
import { ProfileAvatar } from '@/components/ProfileAvatar'
import {
  Profile,
  PrivateMessage,
  appendLocalThreadMessage,
  fetchApprovedProfiles,
  generateProfileId,
  getActiveProfileId,
  getAllLocalConversationsForProfile,
  getLastSeenTimestamp,
  getLocalProfiles,
  getLocalThreadMessages,
  getMyProfiles,
  markThreadAsSeen,
  normalizePhone,
  setActiveProfileId,
} from '@/utils/profileStorage'
import { MessageCircle, Send, CheckCheck, Lock, UserPlus, Users } from 'lucide-react'

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
  const [loadingThreads, setLoadingThreads] = useState(true)
  const messagesEndRef = useRef<HTMLDivElement | null>(null)
  const broadcastRef = useRef<BroadcastChannel | null>(null)

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

      // Include any local or remote message history involving currentSenderId
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
          }
        }
      } catch {
        // fallback to local threads when offline
      }

      // Ensure any peer we have a private thread with is also in the directory if present locally
      const peerIdsWithMessages = new Set([
        ...Object.keys(localThreadMap),
        ...Object.keys(remoteThreadMap),
      ])
      for (const peerId of peerIdsWithMessages) {
        if (!profileDirectory.has(peerId)) {
          const fallbackProfile = localAll.find((lp) => lp.id === peerId)
          if (fallbackProfile && !fallbackProfile.is_banned) {
            profileDirectory.set(peerId, fallbackProfile)
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
          lastMessage: latest ? latest.content : 'Private chat — no messages yet',
          lastTime: latest ? formatMessageTime(latest.created_at) : '',
          lastTimestamp: latest ? new Date(latest.created_at).getTime() : 0,
          unreadCount,
        }
      })

      // Sort conversations with recent messages first, then alphabetically
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

    const channel = supabase
      .channel(`private-chat-${senderProfileId}-${activeChatId}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'messages' },
        (payload) => {
          const newMsg = payload.new as PrivateMessage
          const belongsToActiveThread =
            (newMsg.sender_id === activeChatId && newMsg.receiver_id === senderProfileId) ||
            (newMsg.sender_id === senderProfileId && newMsg.receiver_id === activeChatId)

          if (belongsToActiveThread) {
            appendLocalThreadMessage(newMsg)
            setMessages((prev) => (prev.some((m) => m.id === newMsg.id) ? prev : [...prev, newMsg]))
            markThreadAsSeen(senderProfileId, activeChatId)
          }

          const involvesSender =
            newMsg.sender_id === senderProfileId || newMsg.receiver_id === senderProfileId
          if (involvesSender) {
            const peerId = newMsg.sender_id === senderProfileId ? newMsg.receiver_id : newMsg.sender_id
            setConversations((prev) =>
              prev.map((c) =>
                c.profileId === peerId
                  ? {
                      ...c,
                      lastMessage: newMsg.content,
                      lastTime: formatMessageTime(newMsg.created_at),
                      lastTimestamp: new Date(newMsg.created_at).getTime(),
                      unreadCount: peerId === activeChatId ? 0 : c.unreadCount + 1,
                    }
                  : c
              )
            )
          }
        }
      )
      .subscribe()

    if (typeof BroadcastChannel !== 'undefined') {
      broadcastRef.current = new BroadcastChannel('mopani_private_chat')
      broadcastRef.current.onmessage = (event) => {
        const incoming = event.data as PrivateMessage
        if (!incoming) return
        const belongsToActiveThread =
          (incoming.sender_id === activeChatId && incoming.receiver_id === senderProfileId) ||
          (incoming.sender_id === senderProfileId && incoming.receiver_id === activeChatId)
        if (belongsToActiveThread) {
          setMessages((prev) => (prev.some((m) => m.id === incoming.id) ? prev : [...prev, incoming]))
          markThreadAsSeen(senderProfileId, activeChatId)
        }
      }
    }

    const handleStorage = () => {
      loadActiveThread(senderProfileId, activeChatId)
    }
    window.addEventListener('storage', handleStorage)

    return () => {
      supabase.removeChannel(channel)
      broadcastRef.current?.close()
      broadcastRef.current = null
      window.removeEventListener('storage', handleStorage)
    }
  }, [senderProfileId, activeChatId, loadActiveThread])

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  const handleSwitchSenderProfile = (newSenderId: string) => {
    setActiveProfileId(newSenderId)
    setSenderProfileId(newSenderId)
    setActiveChatId('')
    buildConversations(newSenderId)
  }

  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!inputText.trim() || !activeChatId || !senderProfileId) return

    const text = inputText.trim()
    setInputText('')

    const optimisticId = generateProfileId()
    const nowIso = new Date().toISOString()
    const newMsg: PrivateMessage = {
      id: optimisticId,
      sender_id: senderProfileId,
      receiver_id: activeChatId,
      content: text,
      created_at: nowIso,
    }

    setMessages((prev) => [...prev, newMsg])
    appendLocalThreadMessage(newMsg)
    markThreadAsSeen(senderProfileId, activeChatId)
    broadcastRef.current?.postMessage(newMsg)

    setConversations((prev) =>
      prev.map((c) =>
        c.profileId === activeChatId
          ? {
              ...c,
              lastMessage: text,
              lastTime: formatMessageTime(nowIso),
              lastTimestamp: new Date(nowIso).getTime(),
              unreadCount: 0,
            }
          : c
      )
    )

    try {
      const { data, error } = await supabase
        .from('messages')
        .insert([
          {
            id: optimisticId,
            sender_id: senderProfileId,
            receiver_id: activeChatId,
            content: text,
          },
        ])
        .select()
        .single()

      if (!error && data) {
        const persisted = data as PrivateMessage
        appendLocalThreadMessage(persisted)
      }
    } catch {
      // message remains safely persisted locally for this private pair
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
            Private 1-on-1 conversations are scoped strictly to your own profile so nobody else can view your messages. Create one or more profiles to start chatting.
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

  const activeConversation = conversations.find((c) => c.profileId === activeChatId)
  const activeWaNumber = activeConversation ? normalizePhone(activeConversation.whatsapp) : ''

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
              <p className="text-xs text-gray-500">1-on-1 encrypted room per profile pair</p>
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
          </div>

          <div className="flex-1 overflow-y-auto divide-y divide-gray-100">
            {loadingThreads ? (
              <div className="p-6 text-center text-xs text-gray-400">Loading private chats...</div>
            ) : conversations.length === 0 ? (
              <div className="p-6 text-center space-y-3">
                <Users className="w-8 h-8 text-gray-300 mx-auto" />
                <p className="text-xs font-semibold text-gray-700">No contacts available yet</p>
                <p className="text-[11px] text-gray-500">
                  Once other profiles are approved by admin (or you create another profile to test), they will appear here for private chat.
                </p>
              </div>
            ) : (
              conversations.map((c) => {
                const isSelected = activeChatId === c.profileId
                return (
                  <div
                    key={c.profileId}
                    onClick={() => {
                      setActiveChatId(c.profileId)
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
              <div className="p-4 border-b border-gray-100 flex items-center justify-between bg-white shadow-xs">
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

                {activeWaNumber && (
                  <div className="flex items-center gap-2">
                    <a
                      href={`https://wa.me/${activeWaNumber}?text=Hi%20${encodeURIComponent(activeConversation.profileName)},%20messaging%20you%20from%20Mopani%20Singles-v2!`}
                      target="_blank"
                      rel="noreferrer"
                      className="bg-rose-600 text-white text-xs font-semibold px-3.5 py-2 rounded-xl shadow-xs hover:bg-rose-700 transition flex items-center gap-1.5"
                    >
                      <MessageCircle className="w-4 h-4 fill-white text-rose-600" /> WhatsApp
                    </a>
                  </div>
                )}
              </div>

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
                      Only {activeSenderProfile.full_name} and {activeConversation.profileName} can see messages in this thread. Send a message below to start chatting.
                    </p>
                  </div>
                ) : (
                  messages.map((m) => {
                    const isMe = m.sender_id === senderProfileId
                    return (
                      <div key={m.id} className={`flex ${isMe ? 'justify-end' : 'justify-start'}`}>
                        <div
                          className={`max-w-[75%] rounded-2xl px-4 py-3 shadow-sm text-sm ${
                            isMe
                              ? 'bg-rose-700 text-white rounded-br-xs'
                              : 'bg-white text-gray-800 border border-rose-100 rounded-bl-xs'
                          }`}
                        >
                          <p className="leading-relaxed break-words">{m.content}</p>
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

              <form onSubmit={handleSendMessage} className="p-3 border-t border-gray-100 bg-white flex gap-2">
                <input
                  type="text"
                  placeholder={`Message ${activeConversation.profileName} privately as ${activeSenderProfile.full_name}...`}
                  value={inputText}
                  onChange={(e) => setInputText(e.target.value)}
                  className="flex-1 border border-gray-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-rose-500"
                />
                <button
                  type="submit"
                  disabled={!inputText.trim()}
                  className="bg-rose-700 hover:bg-rose-800 disabled:opacity-50 text-white font-semibold px-5 py-3 rounded-xl shadow-md transition flex items-center gap-2 text-sm"
                >
                  <Send className="w-4 h-4" /> Send
                </button>
              </form>
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
