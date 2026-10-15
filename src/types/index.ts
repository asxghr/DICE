export type ActiveView = 'issuer' | 'wallet' | 'verifier'

export interface NavigationItem {
  id: ActiveView
  label: string
  description: string
}

export type StudentStatus = 'active' | 'inactive'

export interface DemoCredentialProof {
  type: 'DemoSimulationProof'
  keyId: string
  signature: string
  simulationNote: string
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
  demoMode: true
}

// Minimal placeholder interfaces for future credential exchange model
export interface CredentialSubject {
  studentId?: string
  studentName?: string
  institution?: string
  degree?: string
  gpa?: string
  graduationYear?: string
}

export interface StudentCredentialPlaceholder {
  id: string
  type: string
  issuer: string
  issuanceDate: string
  subject: CredentialSubject
}
