// =============================================================================
// D.I.C.E. Issue Credential Edge Function
// Location: supabase/functions/issue-credential/index.ts
//
// Endpoint Contract:
// - Method: POST
// - Authentication: Required (Bearer JWT via Supabase Auth)
// - Authorization: Issuer Administrator only (via server-controlled JWT app_metadata)
// - Status: 201 Created
// =============================================================================

import {
  authenticateUser,
  checkIssuerAdminAuthorization,
  type IssuerAdminClaims,
} from '../_shared/auth.ts'
import { isIsoUtcTimestamp } from '../_shared/canonicalize.ts'
import {
  importPrivateKeyFromBase64Url,
  importPublicKeyFromBase64Url,
  signCredential,
  verifyKeyCorrespondence,
} from '../_shared/crypto.ts'
import { ApiError } from '../_shared/errors.ts'
import {
  assertMethod,
  errorResponse,
  handleCorsPreflight,
  jsonResponse,
  parseJsonBody,
} from '../_shared/http.ts'
import {
  getServerEnv,
  getSupabaseServerClient,
} from '../_shared/supabaseServer.ts'
import type {
  StudentCredential,
  StudentStatus,
  UnsignedStudentCredential,
} from '../_shared/types.ts'

export interface IssueCredentialRequestBody {
  subjectId: string
  studentStatus: StudentStatus
  expiresAt: string
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

export interface IssueCredentialDependencies {
  authenticateAndAuthorize: (req: Request) => Promise<IssuerAdminClaims>
  loadIssuer: (issuerId: string) => Promise<IssuerRecord | null>
  loadIssuerPrivateKey: (keyId: string) => Promise<CryptoKey>
  recordCredentialStatus: (status: CredentialStatusRecord) => Promise<void>
  nowIso: () => string
  generateId: () => string
  verifyKeyConsistency?: (privateKey: CryptoKey, publicKey: CryptoKey) => Promise<boolean>
}

/**
 * Validates the issue-credential request body strictly against the D.I.C.E. contract.
 * Rejects unknown fields, malformed values, and invalid expiration timestamps.
 */
export function validateIssueCredentialRequest(
  body: Record<string, unknown>,
  issuedAt: string
): IssueCredentialRequestBody {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new ApiError('INVALID_REQUEST', 'Request body must be a JSON object.', 400)
  }

  // Strict schema: reject unknown fields
  const allowedKeys = ['subjectId', 'studentStatus', 'expiresAt']
  for (const key of Object.keys(body)) {
    if (!allowedKeys.includes(key)) {
      throw new ApiError('INVALID_REQUEST', `Unexpected field '${key}' in request payload.`, 400)
    }
  }

  // 1. subjectId validation
  const subjectId = body.subjectId
  if (typeof subjectId !== 'string' || !subjectId.trim()) {
    throw new ApiError('INVALID_REQUEST', 'subjectId must be a non-empty string.', 400)
  }
  if (subjectId.length > 256) {
    throw new ApiError('INVALID_REQUEST', 'subjectId exceeds maximum length of 256 characters.', 400)
  }

  // 2. studentStatus validation
  const studentStatus = body.studentStatus
  if (studentStatus !== 'active' && studentStatus !== 'inactive') {
    throw new ApiError('INVALID_REQUEST', "studentStatus must be exactly 'active' or 'inactive'.", 400)
  }

  // 3. expiresAt validation (strict ISO-8601 UTC timestamp ending in 'Z')
  const expiresAt = body.expiresAt
  if (typeof expiresAt !== 'string' || !isIsoUtcTimestamp(expiresAt)) {
    throw new ApiError('INVALID_REQUEST', "expiresAt must be a valid ISO-8601 UTC timestamp ending in 'Z'.", 400)
  }

  // 4. expiresAt must be strictly later than issuedAt
  const expiresMs = Date.parse(expiresAt)
  const issuedMs = Date.parse(issuedAt)
  if (expiresMs <= issuedMs) {
    throw new ApiError('INVALID_REQUEST', 'expiresAt must be later than issuedAt timestamp.', 400)
  }

  return {
    subjectId: subjectId.trim(),
    studentStatus,
    expiresAt,
  }
}

/**
 * Creates default production dependencies using the server-side Supabase client.
 */
export function createDefaultDependencies(
  overrides?: Partial<IssueCredentialDependencies>
): IssueCredentialDependencies {
  return {
    authenticateAndAuthorize: async (req: Request) => {
      const supabase = getSupabaseServerClient()
      const user = await authenticateUser(req, supabase)
      return checkIssuerAdminAuthorization(user)
    },
    loadIssuer: async (issuerId: string) => {
      const supabase = getSupabaseServerClient()
      const { data, error } = await supabase
        .from('issuers')
        .select('id, name, public_key, key_id, active')
        .eq('id', issuerId)
        .maybeSingle()

      if (error) {
        throw new ApiError('ISSUANCE_FAILED', 'Failed to query issuer registry from database.', 500)
      }
      if (!data) {
        return null
      }
      return data as IssuerRecord
    },
    loadIssuerPrivateKey: async (_keyId: string) => {
      const privateKeyBase64Url = getServerEnv('ISSUER_PRIVATE_KEY')
      if (!privateKeyBase64Url) {
        throw new ApiError('ISSUANCE_FAILED', 'Issuer signing key is not configured on server.', 500)
      }
      try {
        return await importPrivateKeyFromBase64Url(privateKeyBase64Url)
      } catch {
        throw new ApiError('ISSUANCE_FAILED', 'Failed to import server signing key.', 500)
      }
    },
    recordCredentialStatus: async (statusRecord: CredentialStatusRecord) => {
      const supabase = getSupabaseServerClient()
      const { error } = await supabase
        .from('credential_status')
        .insert({
          credential_id: statusRecord.credential_id,
          issuer_id: statusRecord.issuer_id,
          revoked: false,
        })

      if (error) {
        throw new ApiError('ISSUANCE_FAILED', 'Failed to record credential status in database.', 500)
      }
    },
    verifyKeyConsistency: verifyKeyCorrespondence,
    nowIso: () => new Date().toISOString(),
    generateId: () => crypto.randomUUID(),
    ...overrides,
  }
}

/**
 * Core business logic for issuing a verifiable student credential.
 */
export async function executeIssueCredential(
  req: Request,
  deps: IssueCredentialDependencies
): Promise<Response> {
  // 1. Authenticate & Authorize issuer admin
  const claims = await deps.authenticateAndAuthorize(req)

  // 2. Parse request body safely
  const rawBody = await parseJsonBody<Record<string, unknown>>(req)

  // 3. Capture authoritative server issuance timestamp
  const issuedAt = deps.nowIso()

  // 4. Validate input against strict schema
  const validated = validateIssueCredentialRequest(rawBody, issuedAt)

  // 5. Load and verify active issuer record from registry
  let issuer: IssuerRecord | null
  try {
    issuer = await deps.loadIssuer(claims.issuerId)
  } catch (err) {
    if (err instanceof ApiError) throw err
    throw new ApiError('ISSUANCE_FAILED', 'Failed to query issuer registry from database.', 500)
  }

  if (!issuer || !issuer.active) {
    throw new ApiError('ISSUANCE_FAILED', 'Authorized issuer is inactive or not found.', 400)
  }

  // 6. Load server-side Ed25519 signing key
  let privateKey: CryptoKey
  try {
    privateKey = await deps.loadIssuerPrivateKey(issuer.key_id)
  } catch (err) {
    if (err instanceof ApiError) throw err
    throw new ApiError('ISSUANCE_FAILED', 'Failed to load server signing key.', 500)
  }

  // 7. Verify cryptographic key consistency between private key and registered public key
  const verifyKeyMatch = deps.verifyKeyConsistency ?? verifyKeyCorrespondence
  let isKeyConsistent = false
  try {
    const publicKey = await importPublicKeyFromBase64Url(issuer.public_key)
    isKeyConsistent = await verifyKeyMatch(privateKey, publicKey)
  } catch {
    isKeyConsistent = false
  }

  if (!isKeyConsistent) {
    throw new ApiError(
      'ISSUANCE_FAILED',
      'Configured server signing key does not correspond to the registered issuer public key.',
      500
    )
  }

  // 8. Formulate canonical unsigned credential
  const credentialId = deps.generateId()
  const unsignedPayload: UnsignedStudentCredential = {
    id: credentialId,
    type: 'StudentCredential',
    issuerId: issuer.id,
    subject: {
      id: validated.subjectId,
    },
    claims: {
      studentStatus: validated.studentStatus,
    },
    issuedAt,
    expiresAt: validated.expiresAt,
  }

  // 9. Sign canonical unsigned payload with server private key using trusted issuer.key_id
  let signedCredential: StudentCredential
  try {
    signedCredential = await signCredential(
      unsignedPayload,
      privateKey,
      issuer.key_id
    )
  } catch {
    throw new ApiError('ISSUANCE_FAILED', 'Cryptographic signing failed.', 500)
  }

  // 10. Register minimal status in database (strictly zero claims / zero payloads stored)
  try {
    await deps.recordCredentialStatus({
      credential_id: credentialId,
      issuer_id: issuer.id,
      revoked: false,
    })
  } catch (err) {
    if (err instanceof ApiError) throw err
    throw new ApiError('ISSUANCE_FAILED', 'Failed to record credential status in database.', 500)
  }

  // 11. Return signed credential with HTTP 201 Created
  return jsonResponse({ credential: signedCredential }, 201)
}

/**
 * Main HTTP request handler for the issue-credential Edge Function.
 */
export async function issueCredentialHandler(
  req: Request,
  depsOverride?: Partial<IssueCredentialDependencies>
): Promise<Response> {
  const preflight = handleCorsPreflight(req)
  if (preflight) {
    return preflight
  }

  try {
    assertMethod(req, ['POST'])
    const deps = createDefaultDependencies(depsOverride)
    return await executeIssueCredential(req, deps)
  } catch (err) {
    return errorResponse(err)
  }
}

// Standalone entry point for Supabase Deno Edge Runtime
declare const Deno: { serve: (handler: (req: Request) => Promise<Response>) => void } | undefined

if (typeof Deno !== 'undefined' && typeof Deno.serve === 'function') {
  Deno.serve(issueCredentialHandler)
}
