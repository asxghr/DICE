import { supabase, isSupabaseConfigured } from './supabase/client'
import type { VerifyCredentialResponse } from '../types'

export interface VerificationError {
  code: string
  message: string
  status?: number
}

export type VerificationResult =
  | { success: true; data: VerifyCredentialResponse }
  | { success: false; error: VerificationError }

/**
 * Submits a credential payload to the public verify-credential Edge Function.
 * Does not require authentication.
 */
export async function verifyRemoteCredential(
  credential: unknown
): Promise<VerificationResult> {
  if (!isSupabaseConfigured) {
    return {
      success: false,
      error: {
        code: 'CONFIGURATION_MISSING',
        message:
          'Supabase configuration is missing. VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY are required.',
      },
    }
  }

  try {
    const { data, error } = await supabase.functions.invoke<VerifyCredentialResponse>(
      'verify-credential',
      {
        body: { credential },
      }
    )

    if (error) {
      let code = 'VERIFICATION_FAILED'
      let message = error.message || 'Remote verification request failed.'
      let status: number | undefined

      if ('context' in error && error.context && typeof (error.context as Response).json === 'function') {
        try {
          const res = error.context as Response
          status = res.status
          const body = await res.json()
          if (body && typeof body === 'object' && body.error) {
            code = body.error.code || code
            message = body.error.message || message
          }
        } catch {
          // Retain default error code and message if parsing fails
        }
      }

      return {
        success: false,
        error: {
          code,
          message,
          status,
        },
      }
    }

    if (!data || typeof data.valid !== 'boolean' || !data.checks) {
      return {
        success: false,
        error: {
          code: 'MALFORMED_RESPONSE',
          message: 'Backend returned an empty or malformed verification response.',
        },
      }
    }

    return {
      success: true,
      data,
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown network failure.'
    return {
      success: false,
      error: {
        code: 'BACKEND_UNAVAILABLE',
        message: `Edge Function service unavailable: ${message}`,
      },
    }
  }
}
