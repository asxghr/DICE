/// <reference types="node" />
import test from 'node:test'
import assert from 'node:assert/strict'
import type { StudentCredential, DemoStudentCredential } from '../../types'
import {
  initialIssuerRevocationState,
  startRevocationAttempt,
  failRevocationAttempt,
  succeedRevocationAttempt,
  resetRevocationState,
  deriveIssuerRegistryStatus,
} from './issuerRevocationState.ts'

const mockBackendCredential: StudentCredential = {
  id: 'urn:uuid:11111111-2222-3333-4444-555555555555',
  type: 'StudentCredential',
  issuerId: 'institution-stanford-01',
  subject: {
    id: 'student-alice-123',
  },
  claims: {
    studentStatus: 'active',
  },
  issuedAt: '2026-10-15T12:00:00.000Z',
  expiresAt: '2027-10-15T12:00:00.000Z',
  proof: {
    type: 'Ed25519Signature',
    keyId: 'institution-stanford-01#key-1',
    signature: 'mock-signature-base64url',
  },
}

const mockSimulatedCredential: DemoStudentCredential = {
  id: 'urn:uuid:simulated-1234',
  type: 'StudentCredential',
  issuerId: 'institution-stanford-01',
  subject: {
    id: 'student-bob-456',
  },
  claims: {
    studentStatus: 'active',
  },
  issuedAt: '2026-10-15T12:00:00.000Z',
  expiresAt: '2027-10-15T12:00:00.000Z',
  proof: {
    type: 'DemoSimulationProof',
    keyId: 'demo-key-1',
    signature: 'demo-sig',
  },
  demoMode: true,
}

test('1. Newly loaded backend credential derives UNVERIFIED and never ACTIVE', () => {
  const status = deriveIssuerRegistryStatus(mockBackendCredential, initialIssuerRevocationState)
  assert.equal(status, 'UNVERIFIED')
})

test('2. Simulated credential derives SIMULATED', () => {
  const status = deriveIssuerRegistryStatus(mockSimulatedCredential, initialIssuerRevocationState)
  assert.equal(status, 'SIMULATED')
})

test('3. Successful revocation produces REVOKED with matching credential receipt', () => {
  let state = startRevocationAttempt(initialIssuerRevocationState, mockBackendCredential.id)
  state = succeedRevocationAttempt(state, {
    credentialId: mockBackendCredential.id,
    revoked: true,
    updatedAt: '2026-10-16T01:30:00.000Z',
  })

  const status = deriveIssuerRegistryStatus(mockBackendCredential, state)
  assert.equal(status, 'REVOKED')
})

test('4. HTTP 409 ALREADY_REVOKED produces ALREADY_REVOKED status', () => {
  let state = startRevocationAttempt(initialIssuerRevocationState, mockBackendCredential.id)
  state = failRevocationAttempt(state, {
    code: 'ALREADY_REVOKED',
    message: 'Credential was already revoked',
    status: 409,
  })

  assert.equal(state.revokedConflict, true)
  assert.equal(state.notFoundInRegistry, false)
  const status = deriveIssuerRegistryStatus(mockBackendCredential, state)
  assert.equal(status, 'ALREADY_REVOKED')
})

test('5. Stale 409 scenario: Retry failure with 500 must produce STATUS_UNAVAILABLE and never retain ALREADY_REVOKED', () => {
  // Attempt 1: Receives 409
  let state = startRevocationAttempt(initialIssuerRevocationState, mockBackendCredential.id)
  state = failRevocationAttempt(state, {
    code: 'ALREADY_REVOKED',
    message: 'Credential was already revoked',
    status: 409,
  })
  assert.equal(deriveIssuerRegistryStatus(mockBackendCredential, state), 'ALREADY_REVOKED')

  // Attempt 2 (Retry): Start clears previous transient state
  state = startRevocationAttempt(state, mockBackendCredential.id)
  assert.equal(state.revokedConflict, false)
  assert.equal(state.revocationError, null)

  // Attempt 2 fails with HTTP 500
  state = failRevocationAttempt(state, {
    code: 'REVOCATION_FAILED',
    message: 'Server error processing revocation',
    status: 500,
  })
  assert.equal(state.revokedConflict, false)
  assert.equal(state.notFoundInRegistry, false)

  // Must derive STATUS_UNAVAILABLE; stale 409 must NOT override the current failure
  const status = deriveIssuerRegistryStatus(mockBackendCredential, state)
  assert.equal(status, 'STATUS_UNAVAILABLE')
})

test('6. Stale 404 scenario: Retry failure with network error must produce STATUS_UNAVAILABLE and never retain NOT_REGISTERED', () => {
  // Attempt 1: Receives 404
  let state = startRevocationAttempt(initialIssuerRevocationState, mockBackendCredential.id)
  state = failRevocationAttempt(state, {
    code: 'CREDENTIAL_NOT_FOUND',
    message: 'Credential not in database',
    status: 404,
  })
  assert.equal(deriveIssuerRegistryStatus(mockBackendCredential, state), 'NOT_REGISTERED')

  // Attempt 2 (Retry): Start clears previous transient state
  state = startRevocationAttempt(state, mockBackendCredential.id)
  assert.equal(state.notFoundInRegistry, false)

  // Attempt 2 fails with network timeout
  state = failRevocationAttempt(state, {
    code: 'BACKEND_UNAVAILABLE',
    message: 'Edge Function service unavailable',
  })
  assert.equal(state.notFoundInRegistry, false)
  assert.equal(state.revokedConflict, false)

  // Must derive STATUS_UNAVAILABLE; stale 404 must NOT override
  const status = deriveIssuerRegistryStatus(mockBackendCredential, state)
  assert.equal(status, 'STATUS_UNAVAILABLE')
})

test('7. Retry after HTTP 500 that receives HTTP 409 correctly transitions to ALREADY_REVOKED', () => {
  let state = startRevocationAttempt(initialIssuerRevocationState, mockBackendCredential.id)
  state = failRevocationAttempt(state, {
    code: 'REVOCATION_FAILED',
    message: 'Server error',
    status: 500,
  })
  assert.equal(deriveIssuerRegistryStatus(mockBackendCredential, state), 'STATUS_UNAVAILABLE')

  state = startRevocationAttempt(state, mockBackendCredential.id)
  state = failRevocationAttempt(state, {
    code: 'ALREADY_REVOKED',
    message: 'Already revoked',
    status: 409,
  })
  assert.equal(deriveIssuerRegistryStatus(mockBackendCredential, state), 'ALREADY_REVOKED')
})

test('8. Reset revocation state on sign-out clears all transient result state', () => {
  let state = startRevocationAttempt(initialIssuerRevocationState, mockBackendCredential.id)
  state = failRevocationAttempt(state, {
    code: 'ALREADY_REVOKED',
    message: 'Conflict',
    status: 409,
  })
  assert.equal(state.revokedConflict, true)

  const resetState = resetRevocationState()
  assert.deepEqual(resetState, initialIssuerRevocationState)
  assert.equal(deriveIssuerRegistryStatus(mockBackendCredential, resetState), 'UNVERIFIED')
})

test('9. Credential mismatch prevents revocation state from leaking to a different credential', () => {
  let state = startRevocationAttempt(initialIssuerRevocationState, mockBackendCredential.id)
  state = succeedRevocationAttempt(state, {
    credentialId: mockBackendCredential.id,
    revoked: true,
    updatedAt: '2026-10-16T01:30:00.000Z',
  })

  const anotherCredential: StudentCredential = {
    ...mockBackendCredential,
    id: 'urn:uuid:99999999-9999-9999-9999-999999999999',
  }

  // Another credential must not inherit the revocation receipt of the first credential
  assert.equal(deriveIssuerRegistryStatus(anotherCredential, state), 'UNVERIFIED')
})
