import { supabase, isSupabaseConfigured } from './supabase/client'
import type { StudentCredential, StudentStatus, RevokeCredentialResponse } from '../types'
import type { Session, User } from '@supabase/supabase-js'

export interface IssueCredentialParams {
  subjectId: string
  studentStatus: StudentStatus
  expiresAt: string
}

export interface IssueCredentialError {
  code: string
  message: string
  status?: number
}

export type IssueCredentialResult =
  | { success: true; credential: StudentCredential }
  | { success: false; error: IssueCredentialError }

export interface AuthStateResult {
  session: Session | null
  user: User | null
}

/**
 * Sign in using email and password against Supabase Auth.
 * Uses only the public client with publishable key.
 */
export async function signInIssuer(
  email: string,
  password: string
): Promise<{ success: boolean; error?: string }> {
  if (!isSupabaseConfigured) {
    return {
      success: false,
      error: 'Supabase is not configured. Live authentication is unavailable.',
    }
  }

  try {
    const { error } = await supabase.auth.signInWithPassword({
      email,
      password,
    })

    if (error) {
      return {
        success: false,
        error: error.message || 'Failed to authenticate issuer.',
      }
    }

    return { success: true }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown authentication error.'
    return {
      success: false,
      error: message,
    }
  }
}

/**
 * Sign out the currently active issuer session.
 */
export async function signOutIssuer(): Promise<{ success: boolean; error?: string }> {
  if (!isSupabaseConfigured) {
    return { success: true }
  }

  try {
    const { error } = await supabase.auth.signOut()
    if (error) {
      return { success: false, error: error.message }
    }
    return { success: true }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown sign-out error.'
    return { success: false, error: message }
  }
}

/**
 * Requests credential issuance from the live deployed issue-credential Edge Function.
 * Transmits the authenticated session Bearer token and strictly typed payload.
 */
export async function requestCredentialIssuance(
  params: IssueCredentialParams,
  accessToken?: string
): Promise<IssueCredentialResult> {
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

  if (!accessToken) {
    return {
      success: false,
      error: {
        code: 'UNAUTHENTICATED',
        message: 'An active authenticated issuer session is required to issue credentials.',
        status: 401,
      },
    }
  }

  try {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${accessToken}`,
    }

    const { data, error } = await supabase.functions.invoke<{ credential: StudentCredential }>(
      'issue-credential',
      {
        body: {
          subjectId: params.subjectId,
          studentStatus: params.studentStatus,
          expiresAt: params.expiresAt,
        },
        headers,
      }
    )

    if (error) {
      let code = 'ISSUANCE_FAILED'
      let message = error.message || 'Credential issuance failed.'
      let status: number | undefined

      // Extract structured error from Edge Function response context when available
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
          // If body reading fails or is not JSON, retain default status and message
        }
      }

      if (status === 401) {
        code = 'UNAUTHENTICATED'
        message = message || 'Session is invalid or expired. Please sign in again.'
      } else if (status === 403) {
        code = 'NOT_AUTHORIZED'
        message = message || 'Your account is not authorized as an academic issuer.'
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

    if (!data || !data.credential) {
      return {
        success: false,
        error: {
          code: 'MALFORMED_RESPONSE',
          message: 'Backend returned an empty or malformed credential response.',
        },
      }
    }

    return {
      success: true,
      credential: data.credential,
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

export interface RevokeCredentialParams {
  credentialId: string
  reasonCode?: 'ISSUED_IN_ERROR'
}

export interface RevokeCredentialError {
  code: string
  message: string
  status?: number
}

export type RevokeCredentialResult =
  | { success: true; data: RevokeCredentialResponse }
  | { success: false; error: RevokeCredentialError }

/**
 * Requests credential revocation from the live deployed revoke-credential Edge Function.
 * Transmits the authenticated session Bearer token and revocation request body.
 */
export async function requestCredentialRevocation(
  params: RevokeCredentialParams,
  accessToken?: string
): Promise<RevokeCredentialResult> {
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

  if (!accessToken) {
    return {
      success: false,
      error: {
        code: 'UNAUTHENTICATED',
        message: 'An active authenticated issuer session is required to revoke credentials.',
        status: 401,
      },
    }
  }

  try {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${accessToken}`,
    }

    const { data, error } = await supabase.functions.invoke<RevokeCredentialResponse>(
      'revoke-credential',
      {
        body: {
          credentialId: params.credentialId,
          reasonCode: params.reasonCode || 'ISSUED_IN_ERROR',
        },
        headers,
      }
    )

    if (error) {
      let code = 'REVOCATION_FAILED'
      let message = error.message || 'Credential revocation failed.'
      let status: number | undefined

      if (
        'context' in error &&
        error.context &&
        typeof (error.context as Response).json === 'function'
      ) {
        try {
          const res = error.context as Response
          status = res.status
          const body = await res.json()
          if (body && typeof body === 'object' && body.error) {
            code = body.error.code || code
            message = body.error.message || message
          }
        } catch {
          // If body reading fails or is not JSON, retain default status and message
        }
      }

      if (status === 401) {
        code = 'UNAUTHENTICATED'
        message = message || 'Session is invalid or expired. Please sign in again.'
      } else if (status === 403) {
        code = 'NOT_AUTHORIZED'
        message =
          message ||
          'Your account is not authorized to revoke credentials for this issuer authority.'
      } else if (status === 404) {
        code = 'CREDENTIAL_NOT_FOUND'
        message = message || 'Credential was not found in the status registry.'
      } else if (status === 409) {
        code = 'ALREADY_REVOKED'
        message = message || 'Credential has already been revoked in the status registry.'
      } else if (status === 500) {
        code = code === 'REVOCATION_FAILED' ? code : 'REVOCATION_FAILED'
        message = message || 'Credential revocation failed on the server.'
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

    if (!data || typeof data.revoked !== 'boolean' || !data.credentialId) {
      return {
        success: false,
        error: {
          code: 'MALFORMED_RESPONSE',
          message: 'Backend returned an empty or malformed revocation response.',
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
