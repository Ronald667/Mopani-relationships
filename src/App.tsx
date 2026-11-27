import { useEffect, useState } from 'react'
import { APIProvider } from '@vis.gl/react-google-maps'
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
import { getGoogleMapsApiKey } from './lib/googleMaps'

export default function App() {
  const [activeTab, setActiveTab] = useState<string>('discover')
  const [selectedChatRecipientId, setSelectedChatRecipientId] = useState<string>('')
  const [mapsQuotaExceeded, setMapsQuotaExceeded] = useState<boolean>(false)
  const mapsApiKey = getGoogleMapsApiKey()

  useEffect(() => {
    const handleQuotaExceeded = () => setMapsQuotaExceeded(true)
    window.addEventListener('gmp-quota-exceeded', handleQuotaExceeded)
    return () => {
      window.removeEventListener('gmp-quota-exceeded', handleQuotaExceeded)
    }
  }, [])

  const handleStartPrivateChat = (profileId: string) => {
    setSelectedChatRecipientId(profileId)
    setActiveTab('chat')
  }

  const content = (
    <div className="min-h-screen bg-gradient-to-br from-rose-50/60 via-gray-50 to-amber-50/40 flex flex-col font-sans text-gray-800">
      {mapsQuotaExceeded && (
        <div className="bg-amber-50 border-b border-amber-200 text-amber-900 px-4 py-2.5 text-xs md:text-sm text-center sticky top-0 z-50 shadow-sm">
          <span>
            Google Maps Platform quota reached. If you are the app owner, visit{' '}
            <a
              href="https://developers.google.com/maps/ai/ai-studio?utm_campaign=gmp_mcp_codeassist_v1_aistudio#quota_exceeded_errors"
              target="_blank"
              rel="noopener noreferrer"
              className="underline font-semibold text-amber-950 hover:text-amber-800"
            >
              maps developer site
            </a>{' '}
            for instructions to update your account.
          </span>
        </div>
      )}

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
          <div className="space-y-1">
            <p>© {new Date().getFullYear()} Mopani Singles-v2 • Limpopo Romance & Community Safety. POPIA Compliant.</p>
            <p className="text-[11px] text-gray-400">
              Location & distance features use Google Maps (
              <a
                href="https://maps.google.com/help/terms_maps/?utm_campaign=gmp_mcp_codeassist_v1_aistudio"
                target="_blank"
                rel="noopener noreferrer"
                className="underline hover:text-gray-600"
              >
                Google Maps Terms
              </a>
              {' • '}
              <a
                href="https://policies.google.com/privacy?utm_campaign=gmp_mcp_codeassist_v1_aistudio"
                target="_blank"
                rel="noopener noreferrer"
                className="underline hover:text-gray-600"
              >
                Google Privacy Policy
              </a>
              ).
            </p>
          </div>
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

  if (!mapsApiKey) {
    return content
  }

  return (
    <APIProvider
      apiKey={mapsApiKey}
      language="en"
      region="ZA"
      libraries={['marker', 'routes', 'places', 'geometry']}
    >
      {content}
    </APIProvider>
  )
}
