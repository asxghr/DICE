/// <reference types="node" />
import test from 'node:test'
import assert from 'node:assert/strict'
import type { StudentCredential, DemoStudentCredential } from '../../types'
import { classifyWalletProof, getWalletStatusItems } from './walletState.ts'

const mockEd25519Credential: StudentCredential = {
  id: 'urn:uuid:ed25519-wallet-001',
  type: 'StudentCredential',
  issuerId: 'institution-stanford-01',
  subject: {
    id: 'student-alice-wallet',
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
  id: 'urn:uuid:simulated-wallet-002',
  type: 'StudentCredential',
  issuerId: 'institution-stanford-01',
  subject: {
    id: 'student-bob-wallet',
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

test('1. Classifies Ed25519Signature as ed25519 proof format', () => {
  const result = classifyWalletProof(mockEd25519Credential)
  assert.equal(result, 'ed25519')
})

test('2. Classifies DemoSimulationProof as simulated proof format', () => {
  const result = classifyWalletProof(mockSimulatedCredential)
  assert.equal(result, 'simulated')
})

test('3. Classifies null or missing proof as unknown', () => {
  assert.equal(classifyWalletProof(null), 'unknown')
  assert.equal(
    classifyWalletProof({ ...mockEd25519Credential, proof: undefined as any }),
    'unknown'
  )
})

test('4. Status items never infer active or authentic registry status from local storage', () => {
  const ed25519Status = getWalletStatusItems(mockEd25519Credential)
  const registryItem = ed25519Status.find((item) => item.label === 'Registry Status')
  assert.ok(registryItem)
  assert.equal(registryItem.value, 'Unverified (Use Verifier)')
  assert.equal(registryItem.badge, 'neutral')

  const simulatedStatus = getWalletStatusItems(mockSimulatedCredential)
  const simRegistryItem = simulatedStatus.find((item) => item.label === 'Registry Status')
  assert.ok(simRegistryItem)
  assert.equal(simRegistryItem.value, 'Unverified (Use Verifier)')
  assert.equal(simRegistryItem.badge, 'neutral')
})

test('5. Status items accurately reflect proof type and record count', () => {
  const ed25519Status = getWalletStatusItems(mockEd25519Credential)
  assert.deepEqual(ed25519Status.find((i) => i.label === 'Proof Type'), {
    label: 'Proof Type',
    value: 'Ed25519 Signature',
    badge: 'forest',
  })
  assert.deepEqual(ed25519Status.find((i) => i.label === 'Stored Records'), {
    label: 'Stored Records',
    value: '1 Local Record',
    badge: 'forest',
  })

  const emptyStatus = getWalletStatusItems(null)
  assert.deepEqual(emptyStatus.find((i) => i.label === 'Proof Type'), {
    label: 'Proof Type',
    value: 'None',
    badge: 'neutral',
  })
  assert.deepEqual(emptyStatus.find((i) => i.label === 'Stored Records'), {
    label: 'Stored Records',
    value: '0 Records',
    badge: 'neutral',
  })
})
