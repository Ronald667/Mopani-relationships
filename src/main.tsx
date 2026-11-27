import { createRoot } from 'react-dom/client'
import App from './App.tsx'
import { hydrateSupabaseFromServerConfig } from './lib/supabase'
import { hydrateGoogleMapsConfig, triggerGmpQuotaExceeded } from './lib/googleMaps'
import './index.css'

;(window as unknown as { gm_authFailure?: () => void }).gm_authFailure = () => {
  triggerGmpQuotaExceeded()
}

const origConsoleError = console.error
console.error = (...args: unknown[]) => {
  origConsoleError.apply(console, args)
  const msg = args.map((a) => String(a)).join(' ')
  if (msg.includes('OverQuotaMapError') || msg.includes('QuotaExceededError')) {
    triggerGmpQuotaExceeded()
  }
}

async function bootstrap() {
  await Promise.all([hydrateSupabaseFromServerConfig(), hydrateGoogleMapsConfig()])
  createRoot(document.getElementById('root')!).render(<App />)
}

bootstrap()
