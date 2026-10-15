import test from 'node:test'
import assert from 'node:assert/strict'
import {
  verifyCredentialHandler,
  validateStudentCredential,
  type IssuerRecord,
  type CredentialStatusRecord,
  type VerifyCredentialDependencies,
  type VerifyCredentialResponse,
} from './index.ts'
import {
  generateEd25519KeyPair,
  exportPublicKeyToBase64Url,
  signCredential,
} from '../_shared/crypto.ts'
import { ApiError } from '../_shared/errors.ts'
import type { StudentCredential, UnsignedStudentCredential } from '../_shared/types.ts'

const sampleUnsigned: UnsignedStudentCredential = {
  id: 'urn:uuid:credential-verify-test-001',
  type: 'StudentCredential',
  issuerId: 'issuer-stanford-01',
  subject: { id: 'student-bob-789' },
  claims: { studentStatus: 'active' },
  issuedAt: '2026-10-15T18:00:00.000Z',
  expiresAt: '2027-10-15T18:00:00.000Z',
}

test('1. Valid credential passes all verification checks and returns 200 with valid: true', async () => {
  const keyPair = await generateEd25519KeyPair()
  const pubBase64Url = await exportPublicKeyToBase64Url(keyPair.publicKey)
  const keyId = 'stanford-key-2026'

  const signedCredential = await signCredential(sampleUnsigned, keyPair.privateKey, keyId)

  const issuerRecord: IssuerRecord = {
    id: 'issuer-stanford-01',
    name: 'Stanford University',
    public_key: pubBase64Url,
    key_id: keyId,
    active: true,
  }

  const statusRecord: CredentialStatusRecord = {
    credential_id: signedCredential.id,
    issuer_id: issuerRecord.id,
    revoked: false,
  }

  const mockDeps: VerifyCredentialDependencies = {
    loadIssuer: async (id) => (id === issuerRecord.id ? issuerRecord : null),
    loadCredentialStatus: async (id) => (id === statusRecord.credential_id ? statusRecord : null),
    importPublicKey: async () => keyPair.publicKey,
    verifySignature: async (cred, pk) => {
      const { verifyCredentialSignature } = await import('../_shared/crypto.ts')
      return await verifyCredentialSignature(cred, pk)
    },
    nowIso: () => '2026-10-15T19:00:00.000Z',
  }

  const req = new Request('http://localhost/verify-credential', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ credential: signedCredential }),
  })

  const res = await verifyCredentialHandler(req, mockDeps)
  assert.strictEqual(res.status, 200)

  const body = (await res.json()) as VerifyCredentialResponse
  assert.strictEqual(body.valid, true)
  assert.deepStrictEqual(body.checks, {
    issuerTrusted: true,
    signatureValid: true,
    expired: false,
    revoked: false,
    claimSatisfied: true,
  })
  assert.strictEqual(body.message, 'Credential verified.')
})

test('2. Altered signed claim returns 200 and signatureValid: false', async () => {
  const keyPair = await generateEd25519KeyPair()
  const pubBase64Url = await exportPublicKeyToBase64Url(keyPair.publicKey)
  const keyId = 'stanford-key-2026'

  const signedCredential = await signCredential(sampleUnsigned, keyPair.privateKey, keyId)

  // Tamper with claims after signing
  const tampered: StudentCredential = {
    ...signedCredential,
    claims: { studentStatus: 'inactive' },
  }

  const issuerRecord: IssuerRecord = {
    id: 'issuer-stanford-01',
    name: 'Stanford University',
    public_key: pubBase64Url,
    key_id: keyId,
    active: true,
  }

  const mockDeps: VerifyCredentialDependencies = {
    loadIssuer: async () => issuerRecord,
    loadCredentialStatus: async () => ({ credential_id: tampered.id, issuer_id: issuerRecord.id, revoked: false }),
    importPublicKey: async () => keyPair.publicKey,
    verifySignature: async (cred, pk) => {
      const { verifyCredentialSignature } = await import('../_shared/crypto.ts')
      return await verifyCredentialSignature(cred, pk)
    },
    nowIso: () => '2026-10-15T19:00:00.000Z',
  }

  const req = new Request('http://localhost/verify-credential', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ credential: tampered }),
  })

  const res = await verifyCredentialHandler(req, mockDeps)
  assert.strictEqual(res.status, 200)

  const body = (await res.json()) as VerifyCredentialResponse
  assert.strictEqual(body.valid, false)
  assert.strictEqual(body.checks.signatureValid, false)
  assert.strictEqual(body.checks.issuerTrusted, true)
})

test('3. Altered signature returns 200 and signatureValid: false', async () => {
  const keyPair = await generateEd25519KeyPair()
  const pubBase64Url = await exportPublicKeyToBase64Url(keyPair.publicKey)
  const keyId = 'stanford-key-2026'

  const signedCredential = await signCredential(sampleUnsigned, keyPair.privateKey, keyId)

  // Corrupt signature
  const corrupted: StudentCredential = {
    ...signedCredential,
    proof: {
      ...signedCredential.proof,
      signature: 'corrupted-signature-xyz',
    },
  }

  const issuerRecord: IssuerRecord = {
    id: 'issuer-stanford-01',
    name: 'Stanford University',
    public_key: pubBase64Url,
    key_id: keyId,
    active: true,
  }

  const mockDeps: VerifyCredentialDependencies = {
    loadIssuer: async () => issuerRecord,
    loadCredentialStatus: async () => ({ credential_id: corrupted.id, issuer_id: issuerRecord.id, revoked: false }),
    importPublicKey: async () => keyPair.publicKey,
    verifySignature: async (cred, pk) => {
      const { verifyCredentialSignature } = await import('../_shared/crypto.ts')
      return await verifyCredentialSignature(cred, pk)
    },
    nowIso: () => '2026-10-15T19:00:00.000Z',
  }

  const req = new Request('http://localhost/verify-credential', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ credential: corrupted }),
  })

  const res = await verifyCredentialHandler(req, mockDeps)
  assert.strictEqual(res.status, 200)

  const body = (await res.json()) as VerifyCredentialResponse
  assert.strictEqual(body.valid, false)
  assert.strictEqual(body.checks.signatureValid, false)
})

test('4. Unknown or inactive issuer returns 200 and issuerTrusted: false', async () => {
  const keyPair = await generateEd25519KeyPair()
  const signedCredential = await signCredential(sampleUnsigned, keyPair.privateKey, 'stanford-key-2026')

  // Case A: Unknown issuer
  const unknownMockDeps: VerifyCredentialDependencies = {
    loadIssuer: async () => null,
    loadCredentialStatus: async () => null,
    importPublicKey: async () => keyPair.publicKey,
    verifySignature: async () => false,
    nowIso: () => '2026-10-15T19:00:00.000Z',
  }

  const reqA = new Request('http://localhost/verify-credential', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ credential: signedCredential }),
  })

  const resA = await verifyCredentialHandler(reqA, unknownMockDeps)
  assert.strictEqual(resA.status, 200)
  const bodyA = (await resA.json()) as VerifyCredentialResponse
  assert.strictEqual(bodyA.valid, false)
  assert.strictEqual(bodyA.checks.issuerTrusted, false)

  // Case B: Inactive issuer
  const inactiveMockDeps: VerifyCredentialDependencies = {
    loadIssuer: async () => ({
      id: 'issuer-stanford-01',
      name: 'Stanford University',
      public_key: 'pk',
      key_id: 'stanford-key-2026',
      active: false,
    }),
    loadCredentialStatus: async () => null,
    importPublicKey: async () => keyPair.publicKey,
    verifySignature: async () => false,
    nowIso: () => '2026-10-15T19:00:00.000Z',
  }

  const reqB = new Request('http://localhost/verify-credential', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ credential: signedCredential }),
  })

  const resB = await verifyCredentialHandler(reqB, inactiveMockDeps)
  assert.strictEqual(resB.status, 200)
  const bodyB = (await resB.json()) as VerifyCredentialResponse
  assert.strictEqual(bodyB.valid, false)
  assert.strictEqual(bodyB.checks.issuerTrusted, false)
})

test('5. Expired credential returns 200 and expired: true', async () => {
  const keyPair = await generateEd25519KeyPair()
  const pubBase64Url = await exportPublicKeyToBase64Url(keyPair.publicKey)
  const keyId = 'stanford-key-2026'

  const signedCredential = await signCredential(sampleUnsigned, keyPair.privateKey, keyId)

  const issuerRecord: IssuerRecord = {
    id: 'issuer-stanford-01',
    name: 'Stanford University',
    public_key: pubBase64Url,
    key_id: keyId,
    active: true,
  }

  const mockDeps: VerifyCredentialDependencies = {
    loadIssuer: async () => issuerRecord,
    loadCredentialStatus: async () => ({ credential_id: signedCredential.id, issuer_id: issuerRecord.id, revoked: false }),
    importPublicKey: async () => keyPair.publicKey,
    verifySignature: async () => true,
    // Server time is 2029 (way past expiresAt of 2027)
    nowIso: () => '2029-01-01T00:00:00.000Z',
  }

  const req = new Request('http://localhost/verify-credential', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ credential: signedCredential }),
  })

  const res = await verifyCredentialHandler(req, mockDeps)
  assert.strictEqual(res.status, 200)

  const body = (await res.json()) as VerifyCredentialResponse
  assert.strictEqual(body.valid, false)
  assert.strictEqual(body.checks.expired, true)
  assert.strictEqual(body.message, 'Credential has expired.')
})

test('6. Revoked credential returns 200 and revoked: true', async () => {
  const keyPair = await generateEd25519KeyPair()
  const pubBase64Url = await exportPublicKeyToBase64Url(keyPair.publicKey)
  const keyId = 'stanford-key-2026'

  const signedCredential = await signCredential(sampleUnsigned, keyPair.privateKey, keyId)

  const issuerRecord: IssuerRecord = {
    id: 'issuer-stanford-01',
    name: 'Stanford University',
    public_key: pubBase64Url,
    key_id: keyId,
    active: true,
  }

  // Revoked in status registry
  const revokedStatus: CredentialStatusRecord = {
    credential_id: signedCredential.id,
    issuer_id: issuerRecord.id,
    revoked: true,
  }

  const mockDeps: VerifyCredentialDependencies = {
    loadIssuer: async () => issuerRecord,
    loadCredentialStatus: async () => revokedStatus,
    importPublicKey: async () => keyPair.publicKey,
    verifySignature: async () => true,
    nowIso: () => '2026-10-15T19:00:00.000Z',
  }

  const req = new Request('http://localhost/verify-credential', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ credential: signedCredential }),
  })

  const res = await verifyCredentialHandler(req, mockDeps)
  assert.strictEqual(res.status, 200)

  const body = (await res.json()) as VerifyCredentialResponse
  assert.strictEqual(body.valid, false)
  assert.strictEqual(body.checks.revoked, true)
  assert.strictEqual(body.message, 'Credential has been revoked by the issuer.')
})

test('7. Missing status record in registry fails verification safely', async () => {
  const keyPair = await generateEd25519KeyPair()
  const pubBase64Url = await exportPublicKeyToBase64Url(keyPair.publicKey)
  const keyId = 'stanford-key-2026'

  const signedCredential = await signCredential(sampleUnsigned, keyPair.privateKey, keyId)

  const issuerRecord: IssuerRecord = {
    id: 'issuer-stanford-01',
    name: 'Stanford University',
    public_key: pubBase64Url,
    key_id: keyId,
    active: true,
  }

  const mockDeps: VerifyCredentialDependencies = {
    loadIssuer: async () => issuerRecord,
    // Status record does not exist
    loadCredentialStatus: async () => null,
    importPublicKey: async () => keyPair.publicKey,
    verifySignature: async () => true,
    nowIso: () => '2026-10-15T19:00:00.000Z',
  }

  const req = new Request('http://localhost/verify-credential', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ credential: signedCredential }),
  })

  const res = await verifyCredentialHandler(req, mockDeps)
  assert.strictEqual(res.status, 200)

  const body = (await res.json()) as VerifyCredentialResponse
  assert.strictEqual(body.valid, false)
  assert.strictEqual(body.checks.revoked, false)
  assert.strictEqual(body.message, 'Credential is not registered in the status registry.')
})

test('8. Mismatched proof.keyId fails safely with issuerTrusted: true and signatureValid: false', async () => {
  const keyPair = await generateEd25519KeyPair()
  const pubBase64Url = await exportPublicKeyToBase64Url(keyPair.publicKey)

  // Credential signed with keyId 'rotated-key-99'
  const signedCredential = await signCredential(sampleUnsigned, keyPair.privateKey, 'rotated-key-99')

  // Issuer in DB has active key_id 'stanford-key-2026'
  const issuerRecord: IssuerRecord = {
    id: 'issuer-stanford-01',
    name: 'Stanford University',
    public_key: pubBase64Url,
    key_id: 'stanford-key-2026',
    active: true,
  }

  const mockDeps: VerifyCredentialDependencies = {
    loadIssuer: async () => issuerRecord,
    loadCredentialStatus: async () => ({ credential_id: signedCredential.id, issuer_id: issuerRecord.id, revoked: false }),
    importPublicKey: async () => keyPair.publicKey,
    verifySignature: async () => true,
    nowIso: () => '2026-10-15T19:00:00.000Z',
  }

  const req = new Request('http://localhost/verify-credential', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ credential: signedCredential }),
  })

  const res = await verifyCredentialHandler(req, mockDeps)
  assert.strictEqual(res.status, 200)

  const body = (await res.json()) as VerifyCredentialResponse
  assert.strictEqual(body.valid, false)
  assert.strictEqual(body.checks.issuerTrusted, true)
  assert.strictEqual(body.checks.signatureValid, false)
  assert.strictEqual(body.message, 'Credential key ID does not match the trusted issuer record.')
})

test('9. Malformed credential returns 400 INVALID_CREDENTIAL', async () => {
  // Empty request
  const emptyReq = new Request('http://localhost/verify-credential', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({}),
  })
  const emptyRes = await verifyCredentialHandler(emptyReq)
  assert.strictEqual(emptyRes.status, 400)
  const emptyBody = (await emptyRes.json()) as { error: { code: string } }
  assert.strictEqual(emptyBody.error.code, 'INVALID_CREDENTIAL')

  // Missing proof
  assert.throws(
    () =>
      validateStudentCredential({
        ...sampleUnsigned,
        // missing proof
      }),
    (err: unknown) => {
      assert.ok(err instanceof ApiError)
      assert.strictEqual(err.code, 'INVALID_CREDENTIAL')
      assert.strictEqual(err.statusCode, 400)
      return true
    }
  )

  // Unsupported credential type
  assert.throws(
    () =>
      validateStudentCredential({
        ...sampleUnsigned,
        type: 'DriversLicense',
        proof: { type: 'Ed25519Signature', keyId: 'k1', signature: 's1' },
      }),
    (err: unknown) => {
      assert.ok(err instanceof ApiError)
      assert.strictEqual(err.code, 'INVALID_CREDENTIAL')
      assert.ok(err.message.includes("Unsupported credential type"))
      return true
    }
  )

  // Non-UTC timestamp
  assert.throws(
    () =>
      validateStudentCredential({
        ...sampleUnsigned,
        expiresAt: '2027-10-15T18:00:00+05:30',
        proof: { type: 'Ed25519Signature', keyId: 'k1', signature: 's1' },
      }),
    (err: unknown) => {
      assert.ok(err instanceof ApiError)
      assert.strictEqual(err.code, 'INVALID_CREDENTIAL')
      assert.strictEqual(err.statusCode, 400)
      return true
    }
  )
})

test('10. Regression: Reject future issuedAt in unit validation and HTTP handler', async () => {
  const keyPair = await generateEd25519KeyPair()
  const pubBase64Url = await exportPublicKeyToBase64Url(keyPair.publicKey)
  const keyId = 'stanford-key-2026'

  const validProof = {
    type: 'Ed25519Signature' as const,
    keyId,
    signature: 'mock-sig-abc',
  }

  // 1. validateStudentCredential throws 400 INVALID_CREDENTIAL when issuedAt is in the future
  assert.throws(
    () =>
      validateStudentCredential(
        {
          ...sampleUnsigned,
          issuedAt: '2026-10-15T20:00:00.000Z',
          proof: validProof,
        },
        '2026-10-15T19:00:00.000Z'
      ),
    (err: unknown) => {
      assert.ok(err instanceof ApiError)
      assert.strictEqual(err.code, 'INVALID_CREDENTIAL')
      assert.strictEqual(err.statusCode, 400)
      assert.ok(err.message.includes('issuedAt cannot be in the future'))
      return true
    }
  )

  // 2. validateStudentCredential accepts issuedAt equal to nowIso (not in the future)
  assert.doesNotThrow(() =>
    validateStudentCredential(
      {
        ...sampleUnsigned,
        issuedAt: '2026-10-15T19:00:00.000Z',
        proof: validProof,
      },
      '2026-10-15T19:00:00.000Z'
    )
  )

  // 3. HTTP handler returns 400 INVALID_CREDENTIAL when credential has future issuedAt
  const signedFuture = await signCredential(
    {
      ...sampleUnsigned,
      issuedAt: '2026-10-15T20:00:00.000Z',
    },
    keyPair.privateKey,
    keyId
  )

  const issuerRecord: IssuerRecord = {
    id: 'issuer-stanford-01',
    name: 'Stanford University',
    public_key: pubBase64Url,
    key_id: keyId,
    active: true,
  }

  const mockDeps: VerifyCredentialDependencies = {
    loadIssuer: async () => issuerRecord,
    loadCredentialStatus: async () => ({
      credential_id: signedFuture.id,
      issuer_id: issuerRecord.id,
      revoked: false,
    }),
    importPublicKey: async () => keyPair.publicKey,
    verifySignature: async () => true,
    nowIso: () => '2026-10-15T19:00:00.000Z',
  }

  const req = new Request('http://localhost/verify-credential', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ credential: signedFuture }),
  })

  const res = await verifyCredentialHandler(req, mockDeps)
  assert.strictEqual(res.status, 400)
  const body = (await res.json()) as { error: { code: string; message: string } }
  assert.strictEqual(body.error.code, 'INVALID_CREDENTIAL')
  assert.ok(body.error.message.includes('issuedAt cannot be in the future'))
})

test('11. Regression: Reject issuedAt >= expiresAt (ordering violation)', async () => {
  const validProof = {
    type: 'Ed25519Signature' as const,
    keyId: 'stanford-key-2026',
    signature: 'mock-sig-abc',
  }

  // 1. issuedAt > expiresAt
  assert.throws(
    () =>
      validateStudentCredential({
        ...sampleUnsigned,
        issuedAt: '2027-10-15T18:00:00.000Z',
        expiresAt: '2026-10-15T18:00:00.000Z',
        proof: validProof,
      }),
    (err: unknown) => {
      assert.ok(err instanceof ApiError)
      assert.strictEqual(err.code, 'INVALID_CREDENTIAL')
      assert.strictEqual(err.statusCode, 400)
      assert.ok(err.message.includes('expiresAt must be later than issuedAt timestamp'))
      return true
    }
  )

  // 2. issuedAt === expiresAt
  assert.throws(
    () =>
      validateStudentCredential({
        ...sampleUnsigned,
        issuedAt: '2026-10-15T18:00:00.000Z',
        expiresAt: '2026-10-15T18:00:00.000Z',
        proof: validProof,
      }),
    (err: unknown) => {
      assert.ok(err instanceof ApiError)
      assert.strictEqual(err.code, 'INVALID_CREDENTIAL')
      assert.strictEqual(err.statusCode, 400)
      assert.ok(err.message.includes('expiresAt must be later than issuedAt timestamp'))
      return true
    }
  )

  // 3. HTTP handler returns 400 INVALID_CREDENTIAL for issuedAt >= expiresAt
  const req = new Request('http://localhost/verify-credential', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      credential: {
        ...sampleUnsigned,
        issuedAt: '2026-10-15T18:00:00.000Z',
        expiresAt: '2026-10-15T18:00:00.000Z',
        proof: validProof,
      },
    }),
  })
  const res = await verifyCredentialHandler(req)
  assert.strictEqual(res.status, 400)
  const body = (await res.json()) as { error: { code: string; message: string } }
  assert.strictEqual(body.error.code, 'INVALID_CREDENTIAL')
  assert.ok(body.error.message.includes('expiresAt must be later than issuedAt timestamp'))
})

test('12. Regression: Reject unknown fields in root credential, subject, claims, and proof', async () => {
  const validProof = {
    type: 'Ed25519Signature' as const,
    keyId: 'stanford-key-2026',
    signature: 'mock-sig-abc',
  }

  // 1. Unknown field in root credential
  assert.throws(
    () =>
      validateStudentCredential({
        ...sampleUnsigned,
        proof: validProof,
        adminRole: 'superadmin',
      }),
    (err: unknown) => {
      assert.ok(err instanceof ApiError)
      assert.strictEqual(err.code, 'INVALID_CREDENTIAL')
      assert.strictEqual(err.statusCode, 400)
      assert.ok(err.message.includes("unexpected field 'adminRole'"))
      return true
    }
  )

  // 2. Unknown field in subject
  assert.throws(
    () =>
      validateStudentCredential({
        ...sampleUnsigned,
        proof: validProof,
        subject: {
          id: 'student-bob-789',
          email: 'bob@stanford.edu',
        },
      }),
    (err: unknown) => {
      assert.ok(err instanceof ApiError)
      assert.strictEqual(err.code, 'INVALID_CREDENTIAL')
      assert.strictEqual(err.statusCode, 400)
      assert.ok(err.message.includes("unexpected field 'email' in subject"))
      return true
    }
  )

  // 3. Unknown field in claims
  assert.throws(
    () =>
      validateStudentCredential({
        ...sampleUnsigned,
        proof: validProof,
        claims: {
          studentStatus: 'active',
          gpa: '4.0',
        },
      }),
    (err: unknown) => {
      assert.ok(err instanceof ApiError)
      assert.strictEqual(err.code, 'INVALID_CREDENTIAL')
      assert.strictEqual(err.statusCode, 400)
      assert.ok(err.message.includes("unexpected field 'gpa' in claims"))
      return true
    }
  )

  // 4. Unknown field in proof
  assert.throws(
    () =>
      validateStudentCredential({
        ...sampleUnsigned,
        proof: {
          ...validProof,
          unverifiedNonce: 'abc-123',
        },
      }),
    (err: unknown) => {
      assert.ok(err instanceof ApiError)
      assert.strictEqual(err.code, 'INVALID_CREDENTIAL')
      assert.strictEqual(err.statusCode, 400)
      assert.ok(err.message.includes("unexpected field 'unverifiedNonce' in proof"))
      return true
    }
  )

  // 5. Unknown field in top-level request body
  const reqExtraBody = new Request('http://localhost/verify-credential', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      credential: {
        ...sampleUnsigned,
        proof: validProof,
      },
      injectedPayload: 'attack',
    }),
  })
  const resExtraBody = await verifyCredentialHandler(reqExtraBody)
  assert.strictEqual(resExtraBody.status, 400)
  const bodyExtra = (await resExtraBody.json()) as { error: { code: string; message: string } }
  assert.strictEqual(bodyExtra.error.code, 'INVALID_CREDENTIAL')
  assert.ok(bodyExtra.error.message.includes("Unexpected field 'injectedPayload' in request payload"))
})

test('13. Regression: Preserve API contract (malformed credential -> HTTP 400 INVALID_CREDENTIAL, well-formed invalid -> HTTP 200 with valid: false)', async () => {
  // A. Malformed credential -> HTTP 400 INVALID_CREDENTIAL
  const malformedReq = new Request('http://localhost/verify-credential', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ credential: { notEvenACredential: true } }),
  })
  const malformedRes = await verifyCredentialHandler(malformedReq)
  assert.strictEqual(malformedRes.status, 400)
  const malformedBody = (await malformedRes.json()) as { error: { code: string; message: string } }
  assert.strictEqual(malformedBody.error.code, 'INVALID_CREDENTIAL')

  // B. Well-formed but inactive studentStatus claim -> HTTP 200 with valid: false, claimSatisfied: false
  const keyPair = await generateEd25519KeyPair()
  const pubBase64Url = await exportPublicKeyToBase64Url(keyPair.publicKey)
  const keyId = 'stanford-key-2026'

  const inactiveCredentialPayload: UnsignedStudentCredential = {
    ...sampleUnsigned,
    claims: { studentStatus: 'inactive' },
  }
  const signedInactive = await signCredential(inactiveCredentialPayload, keyPair.privateKey, keyId)

  const issuerRecord: IssuerRecord = {
    id: 'issuer-stanford-01',
    name: 'Stanford University',
    public_key: pubBase64Url,
    key_id: keyId,
    active: true,
  }

  const mockDeps: VerifyCredentialDependencies = {
    loadIssuer: async () => issuerRecord,
    loadCredentialStatus: async () => ({
      credential_id: signedInactive.id,
      issuer_id: issuerRecord.id,
      revoked: false,
    }),
    importPublicKey: async () => keyPair.publicKey,
    verifySignature: async (cred, pk) => {
      const { verifyCredentialSignature } = await import('../_shared/crypto.ts')
      return await verifyCredentialSignature(cred, pk)
    },
    nowIso: () => '2026-10-15T19:00:00.000Z',
  }

  const wellFormedReq = new Request('http://localhost/verify-credential', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ credential: signedInactive }),
  })

  const wellFormedRes = await verifyCredentialHandler(wellFormedReq, mockDeps)
  assert.strictEqual(wellFormedRes.status, 200)
  const wellFormedBody = (await wellFormedRes.json()) as VerifyCredentialResponse
  assert.strictEqual(wellFormedBody.valid, false)
  assert.deepStrictEqual(wellFormedBody.checks, {
    issuerTrusted: true,
    signatureValid: true,
    expired: false,
    revoked: false,
    claimSatisfied: false,
  })
  assert.strictEqual(wellFormedBody.message, 'Student status claim is inactive.')
})

test('14. Regression: Preserve existing signature, issuer, expiry, revocation, and claim checks', async () => {
  const keyPair = await generateEd25519KeyPair()
  const pubBase64Url = await exportPublicKeyToBase64Url(keyPair.publicKey)
  const keyId = 'stanford-key-2026'

  const signedCredential = await signCredential(sampleUnsigned, keyPair.privateKey, keyId)

  const issuerRecord: IssuerRecord = {
    id: 'issuer-stanford-01',
    name: 'Stanford University',
    public_key: pubBase64Url,
    key_id: keyId,
    active: true,
  }

  const baseDeps: VerifyCredentialDependencies = {
    loadIssuer: async () => issuerRecord,
    loadCredentialStatus: async () => ({
      credential_id: signedCredential.id,
      issuer_id: issuerRecord.id,
      revoked: false,
    }),
    importPublicKey: async () => keyPair.publicKey,
    verifySignature: async (cred, pk) => {
      const { verifyCredentialSignature } = await import('../_shared/crypto.ts')
      return await verifyCredentialSignature(cred, pk)
    },
    nowIso: () => '2026-10-15T19:00:00.000Z',
  }

  // 1. Signature check preserved: bad signature fails check with 200
  const badSigDeps: VerifyCredentialDependencies = {
    ...baseDeps,
    verifySignature: async () => false,
  }
  const reqSig = new Request('http://localhost/verify-credential', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ credential: signedCredential }),
  })
  const resSig = await verifyCredentialHandler(reqSig, badSigDeps)
  assert.strictEqual(resSig.status, 200)
  const bodySig = (await resSig.json()) as VerifyCredentialResponse
  assert.strictEqual(bodySig.valid, false)
  assert.strictEqual(bodySig.checks.signatureValid, false)

  // 2. Issuer check preserved: unknown issuer fails check with 200
  const unknownIssuerDeps: VerifyCredentialDependencies = {
    ...baseDeps,
    loadIssuer: async () => null,
  }
  const reqIssuer = new Request('http://localhost/verify-credential', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ credential: signedCredential }),
  })
  const resIssuer = await verifyCredentialHandler(reqIssuer, unknownIssuerDeps)
  assert.strictEqual(resIssuer.status, 200)
  const bodyIssuer = (await resIssuer.json()) as VerifyCredentialResponse
  assert.strictEqual(bodyIssuer.valid, false)
  assert.strictEqual(bodyIssuer.checks.issuerTrusted, false)

  // 3. Expiry check preserved: expired fails check with 200
  const expiredDeps: VerifyCredentialDependencies = {
    ...baseDeps,
    nowIso: () => '2029-01-01T00:00:00.000Z', // past expiresAt 2027
  }
  const reqExp = new Request('http://localhost/verify-credential', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ credential: signedCredential }),
  })
  const resExp = await verifyCredentialHandler(reqExp, expiredDeps)
  assert.strictEqual(resExp.status, 200)
  const bodyExp = (await resExp.json()) as VerifyCredentialResponse
  assert.strictEqual(bodyExp.valid, false)
  assert.strictEqual(bodyExp.checks.expired, true)

  // 4. Revocation check preserved: revoked status fails check with 200
  const revokedDeps: VerifyCredentialDependencies = {
    ...baseDeps,
    loadCredentialStatus: async () => ({
      credential_id: signedCredential.id,
      issuer_id: issuerRecord.id,
      revoked: true,
    }),
  }
  const reqRev = new Request('http://localhost/verify-credential', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ credential: signedCredential }),
  })
  const resRev = await verifyCredentialHandler(reqRev, revokedDeps)
  assert.strictEqual(resRev.status, 200)
  const bodyRev = (await resRev.json()) as VerifyCredentialResponse
  assert.strictEqual(bodyRev.valid, false)
  assert.strictEqual(bodyRev.checks.revoked, true)
})

test('15. Regression: Issuer lookup database failure during verification returns HTTP 500 VERIFICATION_FAILED', async () => {
  const keyPair = await generateEd25519KeyPair()
  const keyId = 'stanford-key-2026'

  const signedCredential = await signCredential(sampleUnsigned, keyPair.privateKey, keyId)

  const dbFailureDeps: VerifyCredentialDependencies = {
    loadIssuer: async () => {
      throw new Error('pg_query error: connection pool exhausted; select * from issuers where id = $1')
    },
    loadCredentialStatus: async () => null,
    importPublicKey: async () => keyPair.publicKey,
    verifySignature: async () => true,
    nowIso: () => '2026-10-15T19:00:00.000Z',
  }

  const req = new Request('http://localhost/verify-credential', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ credential: signedCredential }),
  })

  const res = await verifyCredentialHandler(req, dbFailureDeps)
  assert.strictEqual(res.status, 500)
  const body = (await res.json()) as { error: { code: string; message: string } }
  assert.strictEqual(body.error.code, 'VERIFICATION_FAILED')
  assert.strictEqual(body.error.message, 'Failed to query issuer registry from database.')
  // Verify no raw database details are leaked
  assert.strictEqual(body.error.message.includes('pg_query'), false)
  assert.strictEqual(body.error.message.includes('connection pool'), false)
  assert.strictEqual(body.error.message.includes('issuers'), false)
})

test('16. Regression: Credential status lookup database failure during verification returns HTTP 500 VERIFICATION_FAILED', async () => {
  const keyPair = await generateEd25519KeyPair()
  const pubBase64Url = await exportPublicKeyToBase64Url(keyPair.publicKey)
  const keyId = 'stanford-key-2026'

  const signedCredential = await signCredential(sampleUnsigned, keyPair.privateKey, keyId)

  const issuerRecord: IssuerRecord = {
    id: 'issuer-stanford-01',
    name: 'Stanford University',
    public_key: pubBase64Url,
    key_id: keyId,
    active: true,
  }

  const dbStatusFailureDeps: VerifyCredentialDependencies = {
    loadIssuer: async () => issuerRecord,
    loadCredentialStatus: async () => {
      throw new Error('fatal: database query timed out on table credential_status')
    },
    importPublicKey: async () => keyPair.publicKey,
    verifySignature: async (cred, pk) => {
      const { verifyCredentialSignature } = await import('../_shared/crypto.ts')
      return await verifyCredentialSignature(cred, pk)
    },
    nowIso: () => '2026-10-15T19:00:00.000Z',
  }

  const req = new Request('http://localhost/verify-credential', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ credential: signedCredential }),
  })

  const res = await verifyCredentialHandler(req, dbStatusFailureDeps)
  assert.strictEqual(res.status, 500)
  const body = (await res.json()) as { error: { code: string; message: string } }
  assert.strictEqual(body.error.code, 'VERIFICATION_FAILED')
  assert.strictEqual(body.error.message, 'Failed to query credential status from database.')
  // Verify no raw database details are leaked
  assert.strictEqual(body.error.message.includes('database query timed out'), false)
  assert.strictEqual(body.error.message.includes('credential_status'), false)
})

test('17. Credential-status issuer ownership: Matching credential and status issuer IDs continues normal verification', async () => {
  const keyPair = await generateEd25519KeyPair()
  const pubBase64Url = await exportPublicKeyToBase64Url(keyPair.publicKey)
  const keyId = 'stanford-key-2026'

  const signedCredential = await signCredential(sampleUnsigned, keyPair.privateKey, keyId)

  const issuerRecord: IssuerRecord = {
    id: 'issuer-stanford-01',
    name: 'Stanford University',
    public_key: pubBase64Url,
    key_id: keyId,
    active: true,
  }

  // Matching issuer_id
  const matchingStatus: CredentialStatusRecord = {
    credential_id: signedCredential.id,
    issuer_id: 'issuer-stanford-01',
    revoked: false,
  }

  const mockDeps: VerifyCredentialDependencies = {
    loadIssuer: async () => issuerRecord,
    loadCredentialStatus: async () => matchingStatus,
    importPublicKey: async () => keyPair.publicKey,
    verifySignature: async (cred, pk) => {
      const { verifyCredentialSignature } = await import('../_shared/crypto.ts')
      return await verifyCredentialSignature(cred, pk)
    },
    nowIso: () => '2026-10-15T19:00:00.000Z',
  }

  const req = new Request('http://localhost/verify-credential', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ credential: signedCredential }),
  })

  const res = await verifyCredentialHandler(req, mockDeps)
  assert.strictEqual(res.status, 200)

  const body = (await res.json()) as VerifyCredentialResponse
  assert.strictEqual(body.valid, true)
  assert.deepStrictEqual(body.checks, {
    issuerTrusted: true,
    signatureValid: true,
    expired: false,
    revoked: false,
    claimSatisfied: true,
  })
  assert.strictEqual(body.message, 'Credential verified.')
})

test('18. Credential-status issuer ownership: Mismatched issuer IDs returns HTTP 200 with valid: false', async () => {
  const keyPair = await generateEd25519KeyPair()
  const pubBase64Url = await exportPublicKeyToBase64Url(keyPair.publicKey)
  const keyId = 'stanford-key-2026'

  // Credential was signed with issuerId 'issuer-stanford-01'
  const signedCredential = await signCredential(sampleUnsigned, keyPair.privateKey, keyId)

  const issuerRecord: IssuerRecord = {
    id: 'issuer-stanford-01',
    name: 'Stanford University',
    public_key: pubBase64Url,
    key_id: keyId,
    active: true,
  }

  // Status record belongs to a DIFFERENT issuer ('issuer-other-99')
  const mismatchedStatus: CredentialStatusRecord = {
    credential_id: signedCredential.id,
    issuer_id: 'issuer-other-99',
    revoked: false,
  }

  const mockDeps: VerifyCredentialDependencies = {
    loadIssuer: async () => issuerRecord,
    loadCredentialStatus: async () => mismatchedStatus,
    importPublicKey: async () => keyPair.publicKey,
    verifySignature: async (cred, pk) => {
      const { verifyCredentialSignature } = await import('../_shared/crypto.ts')
      return await verifyCredentialSignature(cred, pk)
    },
    nowIso: () => '2026-10-15T19:00:00.000Z',
  }

  const req = new Request('http://localhost/verify-credential', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ credential: signedCredential }),
  })

  const res = await verifyCredentialHandler(req, mockDeps)
  assert.strictEqual(res.status, 200)

  const body = (await res.json()) as VerifyCredentialResponse
  assert.strictEqual(body.valid, false, 'Mismatched issuer must make the credential invalid')
  assert.strictEqual(body.checks.signatureValid, true)
  assert.strictEqual(body.checks.revoked, false)
  assert.strictEqual(body.message, 'Credential status issuer does not match credential issuer.')
  // Ensure no sensitive internal details leaked
  assert.strictEqual(body.message.includes('issuer-other-99'), false)
  assert.strictEqual(body.message.includes('credential_status'), false)
})

test('19. Credential-status issuer ownership: A mismatched issuer record cannot produce valid: true', async () => {
  const keyPair = await generateEd25519KeyPair()
  const pubBase64Url = await exportPublicKeyToBase64Url(keyPair.publicKey)
  const keyId = 'stanford-key-2026'

  const signedCredential = await signCredential(sampleUnsigned, keyPair.privateKey, keyId)

  const issuerRecord: IssuerRecord = {
    id: 'issuer-stanford-01',
    name: 'Stanford University',
    public_key: pubBase64Url,
    key_id: keyId,
    active: true,
  }

  // Case A: Even with active student claim, valid signature, unexpired, and revoked=false
  const mockDepsA: VerifyCredentialDependencies = {
    loadIssuer: async () => issuerRecord,
    loadCredentialStatus: async () => ({
      credential_id: signedCredential.id,
      issuer_id: 'issuer-mit-02', // Mismatch!
      revoked: false,
    }),
    importPublicKey: async () => keyPair.publicKey,
    verifySignature: async () => true,
    nowIso: () => '2026-10-15T19:00:00.000Z',
  }

  const reqA = new Request('http://localhost/verify-credential', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ credential: signedCredential }),
  })

  const resA = await verifyCredentialHandler(reqA, mockDepsA)
  assert.strictEqual(resA.status, 200)
  const bodyA = (await resA.json()) as VerifyCredentialResponse
  assert.strictEqual(bodyA.valid, false, 'Mismatched status issuer cannot produce valid: true')

  // Case B: When status record has revoked=true and mismatched issuer, issuer mismatch takes precedence before revocation evaluation
  const mockDepsB: VerifyCredentialDependencies = {
    loadIssuer: async () => issuerRecord,
    loadCredentialStatus: async () => ({
      credential_id: signedCredential.id,
      issuer_id: 'issuer-mit-02', // Mismatch!
      revoked: true,
    }),
    importPublicKey: async () => keyPair.publicKey,
    verifySignature: async () => true,
    nowIso: () => '2026-10-15T19:00:00.000Z',
  }

  const reqB = new Request('http://localhost/verify-credential', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ credential: signedCredential }),
  })

  const resB = await verifyCredentialHandler(reqB, mockDepsB)
  assert.strictEqual(resB.status, 200)
  const bodyB = (await resB.json()) as VerifyCredentialResponse
  assert.strictEqual(bodyB.valid, false, 'Mismatched status issuer cannot produce valid: true')
  assert.strictEqual(bodyB.message, 'Credential status issuer does not match credential issuer.')
})

