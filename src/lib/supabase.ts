export {
  supabase,
  supabaseUrl,
  SUPABASE_STORAGE_BUCKET,
  isSupabaseKeyConfigured,
  hasDirectClientSupabase,
  isServerSupabaseProxyAvailable,
  hydrateSupabaseFromServerConfig,
  testSupabaseConnection,
} from './supabase/client'
export {
  sendEmailVerificationOtp,
  verifyEmailOtpCode,
  consumeEmailVerificationFromUrl,
  getVerifiedAuthToken,
  setVerifiedAuthToken,
  getLatestVerifiedEmailSession,
  clearVerifiedAuthToken,
} from './supabase/auth'
