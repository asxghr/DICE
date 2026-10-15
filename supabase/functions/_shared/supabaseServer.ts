// =============================================================================
// D.I.C.E. Server-Side Supabase Client Setup
// Location: supabase/functions/_shared/supabaseServer.ts
//
// Initializes the service-role Supabase client exclusively on the server.
// Never exposes the service-role key to client bundles or logs.
// =============================================================================

import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { ApiError } from './errors.ts'

declare const Deno: { env: { get: (key: string) => string | undefined } } | undefined

/**
 * Safely reads a server-side environment variable across Deno and Node environments.
 */
export function getServerEnv(key: string): string | undefined {
  if (typeof Deno !== 'undefined' && Deno?.env?.get) {
    return Deno.env.get(key)
  }
  if (typeof process !== 'undefined' && process?.env) {
    return process.env[key]
  }
  return undefined
}

/**
 * Creates an authorized server-side Supabase client with the service-role key.
 *
 * SECURITY INVARIANTS:
 * - Only callable in server environments (Edge Functions).
 * - Never log or print the service-role key or credentials.
 * - Session persistence is disabled for stateless server functions.
 */
export function getSupabaseServerClient(): SupabaseClient {
  const supabaseUrl = getServerEnv('SUPABASE_URL')
  const serviceRoleKey = getServerEnv('SUPABASE_SERVICE_ROLE_KEY')

  if (!supabaseUrl || !serviceRoleKey) {
    throw new ApiError(
      'INTERNAL_ERROR',
      'Server error: Supabase environment variables are not configured.',
      500
    )
  }

  return createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  })
}
