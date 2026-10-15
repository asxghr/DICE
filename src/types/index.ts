export type ActiveView = 'issuer' | 'wallet' | 'verifier'

export interface NavigationItem {
  id: ActiveView
  label: string
  description: string
}

export type StudentStatus = 'active' | 'inactive'

export interface CredentialSubject {
  id: string
  studentId?: string
  studentName?: string
  institution?: string
  degree?: string
  gpa?: string
  graduationYear?: string
}

export interface CredentialProof {
  type: 'Ed25519Signature'
  keyId: string
  signature: string
}

export interface StudentCredential {
  id: string
  type: 'StudentCredential'
  issuerId: string
  subject: {
    id: string
  }
  claims: {
    studentStatus: StudentStatus
  }
  issuedAt: string
  expiresAt: string
  proof: CredentialProof
}

export interface DemoCredentialProof {
  type: 'DemoSimulationProof' | 'Ed25519Signature'
  keyId: string
  signature: string
  simulationNote?: string
}

export interface DemoStudentCredential {
  id: string
  type: 'StudentCredential'
  issuerId: string
  subject: {
    id: string
  }
  claims: {
    studentStatus: StudentStatus
  }
  issuedAt: string
  expiresAt: string
  proof: DemoCredentialProof
  demoMode?: true
}

export type AnyStudentCredential = StudentCredential | DemoStudentCredential

export interface StudentCredentialPlaceholder {
  id: string
  type: string
  issuer: string
  issuanceDate: string
  subject: CredentialSubject
}

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

export type RevocationReasonCode = 'ISSUED_IN_ERROR'

export interface RevokeCredentialResponse {
  credentialId: string
  revoked: boolean
  updatedAt: string
}

export type IssuerRegistryStatus =
  | 'SIMULATED'
  | 'UNVERIFIED'
  | 'REVOKED'
  | 'ALREADY_REVOKED'
  | 'NOT_REGISTERED'
  | 'STATUS_UNAVAILABLE'
