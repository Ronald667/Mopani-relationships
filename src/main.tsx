import { createRoot } from 'react-dom/client'
import App from './App.tsx'
import { hydrateSupabaseFromServerConfig } from './lib/supabase'
import './index.css'

async function bootstrap() {
  await hydrateSupabaseFromServerConfig()
  createRoot(document.getElementById('root')!).render(<App />)
}

bootstrap()
