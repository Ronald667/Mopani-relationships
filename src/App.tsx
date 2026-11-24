import { useState } from 'react'
import { Navbar } from './components/Navbar'
import { Discover } from './pages/Discover'
import { Matches } from './pages/Matches'
import { Chat } from './pages/Chat'
import { Register } from './pages/Register'
import { MyProfile } from './pages/MyProfile'
import { Safety } from './pages/Safety'
import { Privacy } from './pages/Privacy'
import { DeleteData } from './pages/DeleteData'
import { Admin } from './pages/Admin'
import { Logo } from './components/Logo'

export default function App() {
  const [activeTab, setActiveTab] = useState<string>('discover')
  const [selectedChatRecipientId, setSelectedChatRecipientId] = useState<string>('')

  const handleStartPrivateChat = (profileId: string) => {
    setSelectedChatRecipientId(profileId)
    setActiveTab('chat')
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-rose-50/60 via-gray-50 to-amber-50/40 flex flex-col font-sans text-gray-800">
      <Navbar activeTab={activeTab} setActiveTab={setActiveTab} />

      <main className="flex-1">
        {activeTab === 'discover' && (
          <Discover
            onGoRegister={() => setActiveTab('register')}
            onStartChat={handleStartPrivateChat}
          />
        )}
        {activeTab === 'matches' && (
          <Matches
            onStartChat={handleStartPrivateChat}
            onGoRegister={() => setActiveTab('register')}
            onBack={() => setActiveTab('discover')}
          />
        )}
        {activeTab === 'chat' && (
          <Chat
            initialChatId={selectedChatRecipientId}
            onGoRegister={() => setActiveTab('register')}
            onGoMyProfile={() => setActiveTab('myprofile')}
            onBack={() => setActiveTab('discover')}
          />
        )}
        {activeTab === 'myprofile' && (
          <MyProfile
            onGoRegister={() => setActiveTab('register')}
            onOpenChat={() => setActiveTab('chat')}
            onBack={() => setActiveTab('discover')}
          />
        )}
        {activeTab === 'register' && (
          <Register
            onComplete={() => setActiveTab('discover')}
            onGoMyProfile={() => setActiveTab('myprofile')}
            onBack={() => setActiveTab('discover')}
          />
        )}
        {activeTab === 'safety' && <Safety onBack={() => setActiveTab('discover')} />}
        {activeTab === 'privacy' && <Privacy onBack={() => setActiveTab('discover')} />}
        {activeTab === 'delete' && <DeleteData onBack={() => setActiveTab('discover')} />}
        {activeTab === 'admin' && <Admin onBack={() => setActiveTab('discover')} />}
      </main>

      <footer className="bg-white border-t border-rose-100 py-8 px-4 sm:px-6 lg:px-8 mt-16 text-center text-xs text-gray-500">
        <div className="max-w-7xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <Logo className="w-8 h-8" />
            <span className="font-bold text-gray-800">Mopani Singles-v2</span>
          </div>
          <p>© {new Date().getFullYear()} Mopani Singles-v2 • Limpopo Romance & Community Safety. POPIA Compliant.</p>
          <div className="flex gap-4">
            <button onClick={() => setActiveTab('matches')} className="hover:text-rose-700 transition">
              Smart Matches
            </button>
            <button onClick={() => setActiveTab('myprofile')} className="hover:text-rose-700 transition">
              My Profiles
            </button>
            <button onClick={() => setActiveTab('safety')} className="hover:text-rose-700 transition">
              Safety
            </button>
            <button onClick={() => setActiveTab('privacy')} className="hover:text-rose-700 transition">
              POPIA Privacy
            </button>
            <button onClick={() => setActiveTab('admin')} className="hover:text-rose-700 transition">
              Admin
            </button>
          </div>
        </div>
      </footer>
    </div>
  )
}
