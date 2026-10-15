// =============================================================================
// D.I.C.E. Verify Credential Edge Function
// Location: supabase/functions/verify-credential/index.ts
//
// Endpoint Contract:
// - Method: POST
// - Authentication: None (Public verification allowed for MVP)
// - Success status: 200 OK (whether valid or verification check failed)
// - Malformed credential/request: 400 INVALID_CREDENTIAL
// =============================================================================

import { isIsoUtcTimestamp } from '../_shared/canonicalize.ts'
import {
  importPublicKeyFromBase64Url,
  verifyCredentialSignature,
} from '../_shared/crypto.ts'
import { ApiError } from '../_shared/errors.ts'
import {
  assertMethod,
  errorResponse,
  handleCorsPreflight,
  jsonResponse,
  parseJsonBody,
} from '../_shared/http.ts'
import { getSupabaseServerClient } from '../_shared/supabaseServer.ts'
import type {
  StudentCredential,
  StudentStatus,
} from '../_shared/types.ts'

export interface VerificationChecks {
  issuerTrusted: boolean
  signatureValid: boolean
  expired: boolean
  revoked: boolean
  claimSatisfied: boolean
}

export interface VerifyCredentialResponse {
  valid: boolean
  checks: VerificationChecks
  message: string
}

export interface IssuerRecord {
  id: string
  name: string
  public_key: string
  key_id: string
  active: boolean
}

export interface CredentialStatusRecord {
  credential_id: string
  issuer_id: string
  revoked: boolean
}

export interface VerifyCredentialDependencies {
  loadIssuer: (issuerId: string) => Promise<IssuerRecord | null>
  loadCredentialStatus: (credentialId: string) => Promise<CredentialStatusRecord | null>
  importPublicKey: (base64url: string) => Promise<CryptoKey>
  verifySignature: (credential: StudentCredential, publicKey: CryptoKey) => Promise<boolean>
  nowIso: () => string
}

/**
 * Validates the complete incoming credential shape strictly against the D.I.C.E. contract.
 * Rejects unsupported credential types, unknown fields, invalid timestamp ordering,
 * future issuance, or missing/malformed fields as INVALID_CREDENTIAL (400).
 */
export function validateStudentCredential(cred: unknown, nowIso?: string): StudentCredential {
  if (!cred || typeof cred !== 'object' || Array.isArray(cred)) {
    throw new ApiError('INVALID_CREDENTIAL', 'Invalid credential: expected a non-null JSON object.', 400)
  }

  const c = cred as Record<string, unknown>

  // Strict schema: reject unknown fields in root credential
  const allowedRootKeys = [
    'id',
    'type',
    'issuerId',
    'subject',
    'claims',
    'issuedAt',
    'expiresAt',
    'proof',
  ]
  for (const key of Object.keys(c)) {
    if (!allowedRootKeys.includes(key)) {
      throw new ApiError('INVALID_CREDENTIAL', `Invalid credential: unexpected field '${key}'.`, 400)
    }
  }

  // 1. id
  if (typeof c.id !== 'string' || !c.id.trim()) {
    throw new ApiError('INVALID_CREDENTIAL', 'Invalid credential: id must be a non-empty string.', 400)
  }

  // 2. type
  if (c.type !== 'StudentCredential') {
    throw new ApiError(
      'INVALID_CREDENTIAL',
      `Unsupported credential type: expected 'StudentCredential', received '${String(c.type)}'.`,
      400
    )
  }

  // 3. issuerId
  if (typeof c.issuerId !== 'string' || !c.issuerId.trim()) {
    throw new ApiError('INVALID_CREDENTIAL', 'Invalid credential: issuerId must be a non-empty string.', 400)
  }

  // 4. subject (reject unknown fields in subject)
  if (!c.subject || typeof c.subject !== 'object' || Array.isArray(c.subject)) {
    throw new ApiError('INVALID_CREDENTIAL', 'Invalid credential: subject must be an object.', 400)
  }
  const subject = c.subject as Record<string, unknown>
  const allowedSubjectKeys = ['id']
  for (const key of Object.keys(subject)) {
    if (!allowedSubjectKeys.includes(key)) {
      throw new ApiError('INVALID_CREDENTIAL', `Invalid credential: unexpected field '${key}' in subject.`, 400)
    }
  }
  if (typeof subject.id !== 'string' || !subject.id.trim()) {
    throw new ApiError('INVALID_CREDENTIAL', 'Invalid credential: subject.id must be a non-empty string.', 400)
  }

  // 5. claims (reject unknown fields in claims)
  if (!c.claims || typeof c.claims !== 'object' || Array.isArray(c.claims)) {
    throw new ApiError('INVALID_CREDENTIAL', 'Invalid credential: claims must be an object.', 400)
  }
  const claims = c.claims as Record<string, unknown>
  const allowedClaimsKeys = ['studentStatus']
  for (const key of Object.keys(claims)) {
    if (!allowedClaimsKeys.includes(key)) {
      throw new ApiError('INVALID_CREDENTIAL', `Invalid credential: unexpected field '${key}' in claims.`, 400)
    }
  }
  if (claims.studentStatus !== 'active' && claims.studentStatus !== 'inactive') {
    throw new ApiError(
      'INVALID_CREDENTIAL',
      "Invalid credential: claims.studentStatus must be exactly 'active' or 'inactive'.",
      400
    )
  }

  // 6. issuedAt
  if (typeof c.issuedAt !== 'string' || !isIsoUtcTimestamp(c.issuedAt)) {
    throw new ApiError(
      'INVALID_CREDENTIAL',
      'Invalid credential: issuedAt must be a valid ISO-8601 UTC timestamp ending in \'Z\'.',
      400
    )
  }

  // 7. expiresAt
  if (typeof c.expiresAt !== 'string' || !isIsoUtcTimestamp(c.expiresAt)) {
    throw new ApiError(
      'INVALID_CREDENTIAL',
      'Invalid credential: expiresAt must be a valid ISO-8601 UTC timestamp ending in \'Z\'.',
      400
    )
  }

  // 8. Timestamp ordering: issuedAt must be strictly earlier than expiresAt
  const issuedMs = Date.parse(c.issuedAt)
  const expiresMs = Date.parse(c.expiresAt)
  if (issuedMs >= expiresMs) {
    throw new ApiError(
      'INVALID_CREDENTIAL',
      'Invalid credential: expiresAt must be later than issuedAt timestamp.',
      400
    )
  }

  // 9. Future issuance check: reject future issuedAt
  if (nowIso !== undefined) {
    const nowMs = Date.parse(nowIso)
    if (!Number.isNaN(nowMs) && issuedMs > nowMs) {
      throw new ApiError(
        'INVALID_CREDENTIAL',
        'Invalid credential: issuedAt cannot be in the future.',
        400
      )
    }
  }

  // 10. proof (reject unknown fields in proof)
  if (!c.proof || typeof c.proof !== 'object' || Array.isArray(c.proof)) {
    throw new ApiError('INVALID_CREDENTIAL', 'Invalid credential: proof must be an object.', 400)
  }
  const proof = c.proof as Record<string, unknown>
  const allowedProofKeys = ['type', 'keyId', 'signature']
  for (const key of Object.keys(proof)) {
    if (!allowedProofKeys.includes(key)) {
      throw new ApiError('INVALID_CREDENTIAL', `Invalid credential: unexpected field '${key}' in proof.`, 400)
    }
  }
  if (proof.type !== 'Ed25519Signature') {
    throw new ApiError(
      'INVALID_CREDENTIAL',
      `Unsupported proof type: expected 'Ed25519Signature', received '${String(proof.type)}'.`,
      400
    )
  }
  if (typeof proof.keyId !== 'string' || !proof.keyId.trim()) {
    throw new ApiError('INVALID_CREDENTIAL', 'Invalid credential: proof.keyId must be a non-empty string.', 400)
  }
  if (typeof proof.signature !== 'string' || !proof.signature.trim()) {
    throw new ApiError('INVALID_CREDENTIAL', 'Invalid credential: proof.signature must be a non-empty string.', 400)
  }

  return {
    id: c.id.trim(),
    type: 'StudentCredential',
    issuerId: c.issuerId.trim(),
    subject: { id: subject.id.trim() },
    claims: { studentStatus: claims.studentStatus as StudentStatus },
    issuedAt: c.issuedAt,
    expiresAt: c.expiresAt,
    proof: {
      type: 'Ed25519Signature',
      keyId: proof.keyId.trim(),
      signature: proof.signature.trim(),
    },
  }
}

/**
 * Creates default production dependencies using the server-side Supabase client.
 */
export function createDefaultVerifyDependencies(
  overrides?: Partial<VerifyCredentialDependencies>
): VerifyCredentialDependencies {
  return {
    loadIssuer: async (issuerId: string) => {
      const supabase = getSupabaseServerClient()
      const { data, error } = await supabase
        .from('issuers')
        .select('id, name, public_key, key_id, active')
        .eq('id', issuerId)
        .maybeSingle()

      if (error) {
        throw new ApiError('VERIFICATION_FAILED', 'Failed to query issuer registry from database.', 500)
      }
      if (!data) {
        return null
      }
      return data as IssuerRecord
    },
    loadCredentialStatus: async (credentialId: string) => {
      const supabase = getSupabaseServerClient()
      const { data, error } = await supabase
        .from('credential_status')
        .select('credential_id, issuer_id, revoked')
        .eq('credential_id', credentialId)
        .maybeSingle()

      if (error) {
        throw new ApiError('VERIFICATION_FAILED', 'Failed to query credential status from database.', 500)
      }
      if (!data) {
        return null
      }
      return data as CredentialStatusRecord
    },
    importPublicKey: importPublicKeyFromBase64Url,
    verifySignature: verifyCredentialSignature,
    nowIso: () => new Date().toISOString(),
    ...overrides,
  }
}

/**
 * Core business logic for verifying a student credential against trusted registry and cryptography.
 */
export async function executeVerifyCredential(
  req: Request,
  deps: VerifyCredentialDependencies
): Promise<Response> {
  // 1. Parse body and check for credential container
  const rawBody = await parseJsonBody<Record<string, unknown>>(req)
  if (!rawBody || typeof rawBody !== 'object' || !('credential' in rawBody)) {
    throw new ApiError('INVALID_CREDENTIAL', "Request body must contain a 'credential' object.", 400)
  }

  const allowedBodyKeys = ['credential']
  for (const key of Object.keys(rawBody)) {
    if (!allowedBodyKeys.includes(key)) {
      throw new ApiError('INVALID_CREDENTIAL', `Unexpected field '${key}' in request payload.`, 400)
    }
  }

  // 2. Validate complete credential shape
  const credential = validateStudentCredential(rawBody.credential, deps.nowIso())

  // 3. Resolve trusted issuer record from database
  let issuer: IssuerRecord | null
  try {
    issuer = await deps.loadIssuer(credential.issuerId)
  } catch (err) {
    if (err instanceof ApiError) throw err
    throw new ApiError('VERIFICATION_FAILED', 'Failed to query issuer registry from database.', 500)
  }

  // Check 1: Issuer Trust & Active Status
  if (!issuer || !issuer.active) {
    const failureRes: VerifyCredentialResponse = {
      valid: false,
      checks: {
        issuerTrusted: false,
        signatureValid: false,
        expired: false,
        revoked: false,
        claimSatisfied: false,
      },
      message: 'Issuer is unknown, unverified, or inactive.',
    }
    return jsonResponse(failureRes, 200, undefined, req)
  }

  // Check 2: Key ID Matching
  if (credential.proof.keyId !== issuer.key_id) {
    const keyMismatchRes: VerifyCredentialResponse = {
      valid: false,
      checks: {
        issuerTrusted: true,
        signatureValid: false,
        expired: false,
        revoked: false,
        claimSatisfied: false,
      },
      message: 'Credential key ID does not match the trusted issuer record.',
    }
    return jsonResponse(keyMismatchRes, 200, undefined, req)
  }

  // Check 3: Cryptographic Signature Verification
  let isSignatureValid = false
  try {
    const publicKey = await deps.importPublicKey(issuer.public_key)
    isSignatureValid = await deps.verifySignature(credential, publicKey)
  } catch {
    isSignatureValid = false
  }

  if (!isSignatureValid) {
    const sigFailureRes: VerifyCredentialResponse = {
      valid: false,
      checks: {
        issuerTrusted: true,
        signatureValid: false,
        expired: false,
        revoked: false,
        claimSatisfied: false,
      },
      message: 'Cryptographic signature verification failed: credential payload was altered or signature is invalid.',
    }
    return jsonResponse(sigFailureRes, 200, undefined, req)
  }

  // Check 4: Expiration Check
  const nowMs = Date.parse(deps.nowIso())
  const expiresMs = Date.parse(credential.expiresAt)
  const isExpired = expiresMs <= nowMs

  // Check 5: Student Claim Satisfaction
  const isClaimSatisfied = credential.claims.studentStatus === 'active'

  // Check 6: Credential Status Registry Lookup
  let statusRecord: CredentialStatusRecord | null
  try {
    statusRecord = await deps.loadCredentialStatus(credential.id)
  } catch (err) {
    if (err instanceof ApiError) throw err
    throw new ApiError('VERIFICATION_FAILED', 'Failed to query credential status from database.', 500)
  }

  // If not found in registry: treat as unregistered failure
  if (!statusRecord) {
    const unregisteredRes: VerifyCredentialResponse = {
      valid: false,
      checks: {
        issuerTrusted: true,
        signatureValid: true,
        expired: isExpired,
        revoked: false,
        claimSatisfied: isClaimSatisfied,
      },
      message: 'Credential is not registered in the status registry.',
    }
    return jsonResponse(unregisteredRes, 200, undefined, req)
  }

  // Check 7: Credential Status Issuer Ownership
  if (statusRecord.issuer_id !== credential.issuerId) {
    const issuerMismatchRes: VerifyCredentialResponse = {
      valid: false,
      checks: {
        issuerTrusted: true,
        signatureValid: true,
        expired: isExpired,
        revoked: false,
        claimSatisfied: isClaimSatisfied,
      },
      message: 'Credential status issuer does not match credential issuer.',
    }
    return jsonResponse(issuerMismatchRes, 200, undefined, req)
  }

  const isRevoked = statusRecord.revoked === true

  // Compute overall validity: ALL checks must succeed
  const isValid =
    !isExpired &&
    !isRevoked &&
    isClaimSatisfied

  let message = 'Credential verified.'
  if (!isValid) {
    if (isRevoked) {
      message = 'Credential has been revoked by the issuer.'
    } else if (isExpired) {
      message = 'Credential has expired.'
    } else if (!isClaimSatisfied) {
      message = 'Student status claim is inactive.'
    } else {
      message = 'Credential verification failed.'
    }
  }

  const responsePayload: VerifyCredentialResponse = {
    valid: isValid,
    checks: {
      issuerTrusted: true,
      signatureValid: true,
      expired: isExpired,
      revoked: isRevoked,
      claimSatisfied: isClaimSatisfied,
    },
    message,
  }

  return jsonResponse(responsePayload, 200, undefined, req)
}

/**
 * Main HTTP request handler for the verify-credential Edge Function.
 */
export async function verifyCredentialHandler(
  req: Request,
  depsOverride?: Partial<VerifyCredentialDependencies>
): Promise<Response> {
  const preflight = handleCorsPreflight(req)
  if (preflight) {
    return preflight
  }

  try {
    assertMethod(req, ['POST'])
    const deps = createDefaultVerifyDependencies(depsOverride)
    return await executeVerifyCredential(req, deps)
  } catch (err) {
    return errorResponse(err, undefined, req)
  }
}

// Standalone entry point for Supabase Deno Edge Runtime
declare const Deno: { serve: (handler: (req: Request) => Promise<Response>) => void } | undefined

if (typeof Deno !== 'undefined' && typeof Deno.serve === 'function') {
  Deno.serve(verifyCredentialHandler)
}
