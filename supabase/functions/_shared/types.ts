// =============================================================================
// D.I.C.E. Credential Contract Types
// Location: supabase/functions/_shared/types.ts
//
// Defines the strict application-level credential schema and payload types.
// Timestamps must strictly be valid ISO-8601 UTC strings ending in 'Z'.
// =============================================================================

export type StudentStatus = 'active' | 'inactive'

export interface CredentialSubject {
  id: string
}

export interface CredentialClaims {
  studentStatus: StudentStatus
}

export interface CredentialProof {
  type: 'Ed25519Signature'
  keyId: string
  signature: string // base64url-encoded Ed25519 signature
}

/**
 * The Unsigned Payload: Contains every signed credential field.
 * The proof object and signature value are strictly excluded from the signed representation.
 */
export interface UnsignedStudentCredential {
  id: string
  type: 'StudentCredential'
  issuerId: string // Matches issuers.id
  subject: CredentialSubject
  claims: CredentialClaims
  issuedAt: string // ISO-8601 UTC string ending strictly in 'Z' (e.g., '2026-10-15T18:00:00.000Z')
  expiresAt: string // ISO-8601 UTC string ending strictly in 'Z' (e.g., '2027-10-15T18:00:00.000Z')
}

/**
 * Complete Verifiable Student Credential:
 * Unsigned payload + attached proof metadata and signature.
 */
export interface StudentCredential extends UnsignedStudentCredential {
  proof: CredentialProof
}

/**
 * Verification result returned by the verify-credential service.
 */
export type VerificationFailureReason =
  | 'tampered'
  | 'expired'
  | 'unknown_issuer'
  | 'inactive_issuer'
  | 'revoked'
  | 'invalid_format'

export interface VerificationResult {
  valid: boolean
  reason?: VerificationFailureReason
  issuerId?: string
  credentialId?: string
  details?: string
}
