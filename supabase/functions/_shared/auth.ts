// =============================================================================
// D.I.C.E. Edge Function Authentication & Authorization Infrastructure
// Location: supabase/functions/_shared/auth.ts
//
// Enforces strict server-controlled authorization boundaries:
// 1. Bearer token extraction and validation.
// 2. Issuer-admin authorization derived exclusively from server-controlled JWT `app_metadata`.
// 3. Explicit rejection of user-editable `user_metadata` as an authorization source.
// =============================================================================

import type { SupabaseClient, User } from '@supabase/supabase-js'
import { ApiError } from './errors.ts'

export interface IssuerAdminClaims {
  userId: string
  issuerId: string
  role: 'issuer_admin' | string
}

/**
 * Extracts the Bearer token from the HTTP Authorization header.
 * Rejects missing headers and malformed prefixes.
 */
export function extractBearerToken(req: Request): string {
  const authHeader = req.headers.get('authorization') || req.headers.get('Authorization')
  if (!authHeader || !authHeader.trim()) {
    throw new ApiError('UNAUTHENTICATED', 'Missing Authorization header.', 401)
  }

  const parts = authHeader.trim().split(/\s+/)
  if (parts.length !== 2 || parts[0].toLowerCase() !== 'bearer') {
    throw new ApiError('UNAUTHENTICATED', 'Malformed Authorization header: expected Bearer <token>.', 401)
  }

  const token = parts[1].trim()
  if (!token) {
    throw new ApiError('UNAUTHENTICATED', 'Bearer token cannot be empty.', 401)
  }

  return token
}

/**
 * Verifies the caller's JWT token using Supabase Auth.
 */
export async function authenticateUser(
  req: Request,
  supabaseClient: SupabaseClient
): Promise<User> {
  const token = extractBearerToken(req)

  const {
    data: { user },
    error,
  } = await supabaseClient.auth.getUser(token)

  if (error || !user) {
    throw new ApiError('UNAUTHENTICATED', 'Invalid or expired authorization token.', 401)
  }

  return user
}

/**
 * Authorizes that the authenticated user possesses valid issuer_admin authority.
 *
 * CRITICAL SECURITY RULE:
 * Authorization claims (role, issuer_id) MUST come strictly from server-controlled
 * `app_metadata`. Ordinary user-editable `user_metadata` is completely ignored and
 * explicitly rejected if presented as a credential source.
 */
export function checkIssuerAdminAuthorization(
  user: Pick<User, 'id'> & {
    app_metadata?: Record<string, unknown>
    user_metadata?: Record<string, unknown>
  },
  targetIssuerId?: string
): IssuerAdminClaims {
  if (!user || typeof user !== 'object' || !user.id) {
    throw new ApiError('UNAUTHENTICATED', 'Invalid user identity.', 401)
  }

  // Strictly inspect server-controlled app_metadata
  const appMetadata = user.app_metadata
  if (!appMetadata || typeof appMetadata !== 'object') {
    throw new ApiError('NOT_AUTHORIZED', 'User lacks server-controlled issuer authorization.', 403)
  }

  // Check role in app_metadata
  const role = appMetadata.role
  if (role !== 'issuer_admin') {
    throw new ApiError('NOT_AUTHORIZED', 'Access denied: user does not hold the issuer_admin role.', 403)
  }

  // Check issuer_id in app_metadata
  const issuerId = appMetadata.issuer_id
  if (typeof issuerId !== 'string' || !issuerId.trim()) {
    throw new ApiError('NOT_AUTHORIZED', 'Access denied: user is not assigned to an active issuer.', 403)
  }

  // If a specific target issuer ID was requested, verify ownership
  if (targetIssuerId && issuerId !== targetIssuerId) {
    throw new ApiError(
      'NOT_AUTHORIZED',
      `Access denied: user is authorized for issuer '${issuerId}', not '${targetIssuerId}'.`,
      403
    )
  }

  return {
    userId: user.id,
    issuerId,
    role,
  }
}
