// =============================================================================
// D.I.C.E. Revoke Credential Edge Function
// Location: supabase/functions/revoke-credential/index.ts
//
// Endpoint Contract:
// - Method: POST
// - Authentication: Required (Bearer JWT via Supabase Auth)
// - Authorization: Issuer Administrator only (via server-controlled JWT app_metadata)
// - Status: 200 OK
// =============================================================================

import {
  authenticateUser,
  checkIssuerAdminAuthorization,
  type IssuerAdminClaims,
} from '../_shared/auth.ts'
import { ApiError } from '../_shared/errors.ts'
import {
  assertMethod,
  errorResponse,
  handleCorsPreflight,
  jsonResponse,
  parseJsonBody,
} from '../_shared/http.ts'
import { getSupabaseServerClient } from '../_shared/supabaseServer.ts'

export type RevocationReasonCode = 'ISSUED_IN_ERROR'

export interface RevokeCredentialRequestBody {
  credentialId: string
  reasonCode: RevocationReasonCode
}

export interface CredentialStatusRow {
  credential_id: string
  issuer_id: string
  revoked: boolean
  updated_at: string
}

export interface RevokeCredentialResponse {
  credentialId: string
  revoked: boolean
  updatedAt: string
}

export interface RevokeCredentialDependencies {
  authenticateAndAuthorize: (req: Request) => Promise<IssuerAdminClaims>
  loadCredentialStatus: (credentialId: string) => Promise<CredentialStatusRow | null>
  updateRevocationStatus: (
    credentialId: string,
    issuerId: string,
    updatedAt: string
  ) => Promise<boolean>
  nowIso: () => string
}

/**
 * Validates the revoke-credential request body strictly.
 * Rejects unknown fields, malformed types, and free-text reasons.
 */
export function validateRevokeCredentialRequest(
  body: Record<string, unknown>
): RevokeCredentialRequestBody {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new ApiError('INVALID_REQUEST', 'Request body must be a JSON object.', 400)
  }

  // Strict schema: reject unknown fields
  const allowedKeys = ['credentialId', 'reasonCode']
  for (const key of Object.keys(body)) {
    if (!allowedKeys.includes(key)) {
      throw new ApiError('INVALID_REQUEST', `Unexpected field '${key}' in request payload.`, 400)
    }
  }

  // 1. credentialId validation
  const credentialId = body.credentialId
  if (typeof credentialId !== 'string' || !credentialId.trim()) {
    throw new ApiError('INVALID_REQUEST', 'credentialId must be a non-empty string.', 400)
  }
  if (credentialId.length > 256) {
    throw new ApiError('INVALID_REQUEST', 'credentialId exceeds maximum length of 256 characters.', 400)
  }

  // 2. reasonCode validation (strictly bounded enum, no free-text personal notes)
  const reasonCode = body.reasonCode
  if (reasonCode !== 'ISSUED_IN_ERROR') {
    throw new ApiError(
      'INVALID_REQUEST',
      "reasonCode must be an approved enum value: 'ISSUED_IN_ERROR'. Free-text reasons are not accepted.",
      400
    )
  }

  return {
    credentialId: credentialId.trim(),
    reasonCode,
  }
}

/**
 * Creates default production dependencies using the server-side Supabase client.
 */
export function createDefaultRevokeDependencies(
  overrides?: Partial<RevokeCredentialDependencies>
): RevokeCredentialDependencies {
  return {
    authenticateAndAuthorize: async (req: Request) => {
      const supabase = getSupabaseServerClient()
      const user = await authenticateUser(req, supabase)
      return checkIssuerAdminAuthorization(user)
    },
    loadCredentialStatus: async (credentialId: string) => {
      const supabase = getSupabaseServerClient()
      const { data, error } = await supabase
        .from('credential_status')
        .select('credential_id, issuer_id, revoked, updated_at')
        .eq('credential_id', credentialId)
        .maybeSingle()

      if (error) {
        throw new ApiError('REVOCATION_FAILED', 'Failed to query credential status from database.', 500)
      }
      if (!data) {
        return null
      }
      return data as CredentialStatusRow
    },
    updateRevocationStatus: async (
      credentialId: string,
      issuerId: string,
      updatedAt: string
    ): Promise<boolean> => {
      const supabase = getSupabaseServerClient()
      const { data, error } = await supabase
        .from('credential_status')
        .update({
          revoked: true,
          updated_at: updatedAt,
        })
        .eq('credential_id', credentialId)
        .eq('issuer_id', issuerId)
        .eq('revoked', false)
        .select('credential_id')

      if (error) {
        throw new ApiError('REVOCATION_FAILED', 'Failed to update credential status in database.', 500)
      }

      return Array.isArray(data) && data.length > 0
    },
    nowIso: () => new Date().toISOString(),
    ...overrides,
  }
}

/**
 * Core business logic for revoking an issued credential.
 */
export async function executeRevokeCredential(
  req: Request,
  deps: RevokeCredentialDependencies
): Promise<Response> {
  // 1. Authenticate & Authorize issuer admin
  const claims = await deps.authenticateAndAuthorize(req)

  // 2. Parse and validate request body
  const rawBody = await parseJsonBody<Record<string, unknown>>(req)
  const validated = validateRevokeCredentialRequest(rawBody)

  // 3. Load credential status record from database
  let statusRow: CredentialStatusRow | null
  try {
    statusRow = await deps.loadCredentialStatus(validated.credentialId)
  } catch (err) {
    if (err instanceof ApiError) throw err
    throw new ApiError('REVOCATION_FAILED', 'Failed to query credential status from database.', 500)
  }

  if (!statusRow) {
    throw new ApiError(
      'CREDENTIAL_NOT_FOUND',
      `Credential '${validated.credentialId}' not found in status registry.`,
      404
    )
  }

  // 4. Confirm authorization: Issuer can only revoke their own credentials
  if (statusRow.issuer_id !== claims.issuerId) {
    throw new ApiError(
      'NOT_AUTHORIZED',
      'Access denied: you are not authorized to revoke credentials issued by another authority.',
      403
    )
  }

  // 5. Conflict check: Check if already revoked
  if (statusRow.revoked) {
    throw new ApiError(
      'ALREADY_REVOKED',
      `Credential '${validated.credentialId}' has already been revoked.`,
      409
    )
  }

  // 6. Update revocation status conditionally
  const updatedAt = deps.nowIso()
  let updated = false
  try {
    updated = await deps.updateRevocationStatus(
      validated.credentialId,
      claims.issuerId,
      updatedAt
    )
  } catch (err) {
    if (err instanceof ApiError) throw err
    throw new ApiError('REVOCATION_FAILED', 'Failed to update credential status in database.', 500)
  }

  if (!updated) {
    throw new ApiError(
      'ALREADY_REVOKED',
      `Credential '${validated.credentialId}' has already been revoked.`,
      409
    )
  }

  // 7. Return exact response structure (HTTP 200)
  const responsePayload: RevokeCredentialResponse = {
    credentialId: validated.credentialId,
    revoked: true,
    updatedAt,
  }

  return jsonResponse(responsePayload, 200, undefined, req)
}

/**
 * Main HTTP request handler for the revoke-credential Edge Function.
 */
export async function revokeCredentialHandler(
  req: Request,
  depsOverride?: Partial<RevokeCredentialDependencies>
): Promise<Response> {
  const preflight = handleCorsPreflight(req)
  if (preflight) {
    return preflight
  }

  try {
    assertMethod(req, ['POST'])
    const deps = createDefaultRevokeDependencies(depsOverride)
    return await executeRevokeCredential(req, deps)
  } catch (err) {
    return errorResponse(err, undefined, req)
  }
}

// Standalone entry point for Supabase Deno Edge Runtime
declare const Deno: { serve: (handler: (req: Request) => Promise<Response>) => void } | undefined

if (typeof Deno !== 'undefined' && typeof Deno.serve === 'function') {
  Deno.serve(revokeCredentialHandler)
}
