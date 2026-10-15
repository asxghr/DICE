import { createClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || ''
const supabasePublishableKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || ''

export const isSupabaseConfigured = Boolean(
  supabaseUrl && supabasePublishableKey
)

// Initialize Supabase client with safe fallback to prevent runtime exceptions when env vars are unpopulated in dev
export const supabase = createClient(
  supabaseUrl || 'https://placeholder-project.supabase.co',
  supabasePublishableKey || 'placeholder-publishable-key'
)

