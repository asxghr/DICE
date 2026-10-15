import test from 'node:test'
import assert from 'node:assert/strict'
import {
  issueCredentialHandler,
  validateIssueCredentialRequest,
  type CredentialStatusRecord,
  type IssueCredentialDependencies,
  type IssuerRecord,
} from './index.ts'
import {
  generateEd25519KeyPair,
  exportPublicKeyToBase64Url,
  verifyCredentialSignature,
} from '../_shared/crypto.ts'
import { ApiError } from '../_shared/errors.ts'
import type { StudentCredential } from '../_shared/types.ts'

test('1. Valid issuance produces verified credential and minimal status record', async () => {
  const keyPair = await generateEd25519KeyPair()
  const pubBase64Url = await exportPublicKeyToBase64Url(keyPair.publicKey)

  const activeIssuer: IssuerRecord = {
    id: 'issuer-mit-01',
    name: 'Massachusetts Institute of Technology',
    public_key: pubBase64Url,
    key_id: 'mit-key-2026',
    active: true,
  }

  let capturedStatus: CredentialStatusRecord | null = null

  const mockDeps: IssueCredentialDependencies = {
    authenticateAndAuthorize: async () => ({
      userId: 'user-admin-99',
      issuerId: 'issuer-mit-01',
      role: 'issuer_admin',
    }),
    loadIssuer: async (id: string) => (id === 'issuer-mit-01' ? activeIssuer : null),
    loadIssuerPrivateKey: async () => keyPair.privateKey,
    recordCredentialStatus: async (status: CredentialStatusRecord) => {
      capturedStatus = status
    },
    nowIso: () => '2026-10-15T18:00:00.000Z',
    generateId: () => 'urn:uuid:test-credential-uuid-001',
  }

  const req = new Request('http://localhost/issue-credential', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: 'Bearer valid.mock.jwt',
    },
    body: JSON.stringify({
      subjectId: 'student-alice-123',
      studentStatus: 'active',
      expiresAt: '2027-10-15T18:00:00.000Z',
    }),
  })

  const res = await issueCredentialHandler(req, mockDeps)
  assert.strictEqual(res.status, 201)

  const body = (await res.json()) as { credential: StudentCredential }
  assert.ok(body.credential)

  const cred = body.credential
  assert.strictEqual(cred.id, 'urn:uuid:test-credential-uuid-001')
  assert.strictEqual(cred.type, 'StudentCredential')
  assert.strictEqual(cred.issuerId, 'issuer-mit-01')
  assert.strictEqual(cred.subject.id, 'student-alice-123')
  assert.strictEqual(cred.claims.studentStatus, 'active')
  assert.strictEqual(cred.issuedAt, '2026-10-15T18:00:00.000Z')
  assert.strictEqual(cred.expiresAt, '2027-10-15T18:00:00.000Z')
  assert.strictEqual(cred.proof.type, 'Ed25519Signature')
  assert.strictEqual(cred.proof.keyId, 'mit-key-2026')
  assert.ok(cred.proof.signature.length > 0)

  // Verify the issued credential cryptographically with the public key
  const isSignatureValid = await verifyCredentialSignature(cred, keyPair.publicKey)
  assert.strictEqual(isSignatureValid, true, 'Issued credential must cryptographically verify')

  // Verify database record minimalism: ONLY credential_id, issuer_id, revoked = false
  assert.ok(capturedStatus !== null)
  assert.deepStrictEqual(capturedStatus, {
    credential_id: 'urn:uuid:test-credential-uuid-001',
    issuer_id: 'issuer-mit-01',
    revoked: false,
  })

  // Ensure NO student claims or credential payloads exist in status record
  assert.strictEqual('claims' in capturedStatus, false)
  assert.strictEqual('subject' in capturedStatus, false)
  assert.strictEqual('signature' in capturedStatus, false)
})

test('2. Rejects invalid input: empty subjectId, bad status, past expiration, unknown fields', () => {
  const issuedAt = '2026-10-15T18:00:00.000Z'

  // Empty subjectId
  assert.throws(
    () =>
      validateIssueCredentialRequest(
        {
          subjectId: '   ',
          studentStatus: 'active',
          expiresAt: '2027-10-15T18:00:00.000Z',
        },
        issuedAt
      ),
    /subjectId must be a non-empty string/
  )

  // Invalid student status
  assert.throws(
    () =>
      validateIssueCredentialRequest(
        {
          subjectId: 'student-1',
          studentStatus: 'alumni',
          expiresAt: '2027-10-15T18:00:00.000Z',
        },
        issuedAt
      ),
    /studentStatus must be exactly 'active' or 'inactive'/
  )

  // Non-UTC expiration (offset +05:30)
  assert.throws(
    () =>
      validateIssueCredentialRequest(
        {
          subjectId: 'student-1',
          studentStatus: 'active',
          expiresAt: '2027-10-15T18:00:00+05:30',
        },
        issuedAt
      ),
    /expiresAt must be a valid ISO-8601 UTC timestamp/
  )

  // Expiration in the past (before issuedAt)
  assert.throws(
    () =>
      validateIssueCredentialRequest(
        {
          subjectId: 'student-1',
          studentStatus: 'active',
          expiresAt: '2025-01-01T00:00:00.000Z',
        },
        issuedAt
      ),
    /expiresAt must be later than issuedAt/
  )

  // Unknown fields rejected
  assert.throws(
    () =>
      validateIssueCredentialRequest(
        {
          subjectId: 'student-1',
          studentStatus: 'active',
          expiresAt: '2027-10-15T18:00:00.000Z',
          injectedGpa: '4.0',
        },
        issuedAt
      ),
    /Unexpected field 'injectedGpa'/
  )
})

test('3. Inactive or missing issuer causes safe issuance failure (400)', async () => {
  const keyPair = await generateEd25519KeyPair()

  // Inactive issuer
  const inactiveIssuer: IssuerRecord = {
    id: 'issuer-inactive-01',
    name: 'Suspended University',
    public_key: 'pk',
    key_id: 'k1',
    active: false,
  }

  const mockDeps: IssueCredentialDependencies = {
    authenticateAndAuthorize: async () => ({
      userId: 'user-admin-1',
      issuerId: 'issuer-inactive-01',
      role: 'issuer_admin',
    }),
    loadIssuer: async () => inactiveIssuer,
    loadIssuerPrivateKey: async () => keyPair.privateKey,
    recordCredentialStatus: async () => {},
    nowIso: () => '2026-10-15T18:00:00.000Z',
    generateId: () => 'uuid',
  }

  const req = new Request('http://localhost/issue-credential', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: 'Bearer token',
    },
    body: JSON.stringify({
      subjectId: 'student-1',
      studentStatus: 'active',
      expiresAt: '2027-10-15T18:00:00.000Z',
    }),
  })

  const res = await issueCredentialHandler(req, mockDeps)
  assert.strictEqual(res.status, 400)
  const errBody = (await res.json()) as { error: { code: string; message: string } }
  assert.strictEqual(errBody.error.code, 'ISSUANCE_FAILED')
  assert.strictEqual(errBody.error.message, 'Authorized issuer is inactive or not found.')
})

test('4. Unauthorized caller is rejected with 403 NOT_AUTHORIZED', async () => {
  const mockDeps: IssueCredentialDependencies = {
    authenticateAndAuthorize: async () => {
      throw new ApiError('NOT_AUTHORIZED', 'Access denied: user does not hold the issuer_admin role.', 403)
    },
    loadIssuer: async () => null,
    loadIssuerPrivateKey: async () => {
      throw new Error('Should not reach')
    },
    recordCredentialStatus: async () => {},
    nowIso: () => '2026-10-15T18:00:00.000Z',
    generateId: () => 'uuid',
  }

  const req = new Request('http://localhost/issue-credential', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: 'Bearer student.jwt',
    },
    body: JSON.stringify({
      subjectId: 'student-1',
      studentStatus: 'active',
      expiresAt: '2027-10-15T18:00:00.000Z',
    }),
  })

  const res = await issueCredentialHandler(req, mockDeps)
  assert.strictEqual(res.status, 403)
  const errBody = (await res.json()) as { error: { code: string; message: string } }
  assert.strictEqual(errBody.error.code, 'NOT_AUTHORIZED')
})

test('5. Regression: Issuer lookup database failure during issuance returns HTTP 500 ISSUANCE_FAILED', async () => {
  const keyPair = await generateEd25519KeyPair()

  const mockDeps: IssueCredentialDependencies = {
    authenticateAndAuthorize: async () => ({
      userId: 'user-admin-1',
      issuerId: 'issuer-mit-01',
      role: 'issuer_admin',
    }),
    loadIssuer: async () => {
      // Simulate underlying Postgres/network error
      throw new Error('Connection terminated unexpectedly; select * from issuers where id = ...')
    },
    loadIssuerPrivateKey: async () => keyPair.privateKey,
    recordCredentialStatus: async () => {},
    nowIso: () => '2026-10-15T18:00:00.000Z',
    generateId: () => 'uuid',
  }

  const req = new Request('http://localhost/issue-credential', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: 'Bearer admin.jwt',
    },
    body: JSON.stringify({
      subjectId: 'student-1',
      studentStatus: 'active',
      expiresAt: '2027-10-15T18:00:00.000Z',
    }),
  })

  const res = await issueCredentialHandler(req, mockDeps)
  assert.strictEqual(res.status, 500)
  const errBody = (await res.json()) as { error: { code: string; message: string } }
  assert.strictEqual(errBody.error.code, 'ISSUANCE_FAILED')
  assert.strictEqual(errBody.error.message, 'Failed to query issuer registry from database.')
  // Verify no raw database details are leaked
  assert.strictEqual(errBody.error.message.includes('Connection terminated'), false)
  assert.strictEqual(errBody.error.message.includes('select *'), false)
  assert.strictEqual(errBody.error.message.includes('issuers'), false)
})

test('6. Regression: Status recording database failure during issuance returns HTTP 500 ISSUANCE_FAILED', async () => {
  const keyPair = await generateEd25519KeyPair()
  const pubBase64Url = await exportPublicKeyToBase64Url(keyPair.publicKey)

  const activeIssuer: IssuerRecord = {
    id: 'issuer-mit-01',
    name: 'MIT',
    public_key: pubBase64Url,
    key_id: 'mit-key-2026',
    active: true,
  }

  const mockDeps: IssueCredentialDependencies = {
    authenticateAndAuthorize: async () => ({
      userId: 'user-admin-1',
      issuerId: 'issuer-mit-01',
      role: 'issuer_admin',
    }),
    loadIssuer: async () => activeIssuer,
    loadIssuerPrivateKey: async () => keyPair.privateKey,
    recordCredentialStatus: async () => {
      throw new Error('deadlock detected on table credential_status')
    },
    nowIso: () => '2026-10-15T18:00:00.000Z',
    generateId: () => 'uuid',
  }

  const req = new Request('http://localhost/issue-credential', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: 'Bearer admin.jwt',
    },
    body: JSON.stringify({
      subjectId: 'student-1',
      studentStatus: 'active',
      expiresAt: '2027-10-15T18:00:00.000Z',
    }),
  })

  const res = await issueCredentialHandler(req, mockDeps)
  assert.strictEqual(res.status, 500)
  const errBody = (await res.json()) as { error: { code: string; message: string } }
  assert.strictEqual(errBody.error.code, 'ISSUANCE_FAILED')
  assert.strictEqual(errBody.error.message, 'Failed to record credential status in database.')
  assert.strictEqual(errBody.error.message.includes('deadlock'), false)
  assert.strictEqual(errBody.error.message.includes('credential_status'), false)
})

test('7. Key consistency: Matching private/public key succeeds and proof uses trusted issuer registry key_id', async () => {
  const keyPair = await generateEd25519KeyPair()
  const pubBase64Url = await exportPublicKeyToBase64Url(keyPair.publicKey)

  const activeIssuer: IssuerRecord = {
    id: 'issuer-oxford-01',
    name: 'University of Oxford',
    public_key: pubBase64Url,
    key_id: 'oxford-registry-key-2026',
    active: true,
  }

  let capturedStatus: CredentialStatusRecord | null = null

  const mockDeps: IssueCredentialDependencies = {
    authenticateAndAuthorize: async () => ({
      userId: 'user-admin-oxford',
      issuerId: 'issuer-oxford-01',
      role: 'issuer_admin',
    }),
    loadIssuer: async () => activeIssuer,
    loadIssuerPrivateKey: async () => keyPair.privateKey,
    recordCredentialStatus: async (status: CredentialStatusRecord) => {
      capturedStatus = status
    },
    nowIso: () => '2026-10-15T19:00:00.000Z',
    generateId: () => 'urn:uuid:oxford-cred-001',
  }

  const req = new Request('http://localhost/issue-credential', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: 'Bearer valid.jwt',
    },
    body: JSON.stringify({
      subjectId: 'student-bob-456',
      studentStatus: 'active',
      expiresAt: '2027-10-15T19:00:00.000Z',
    }),
  })

  const res = await issueCredentialHandler(req, mockDeps)
  assert.strictEqual(res.status, 201)

  const body = (await res.json()) as { credential: StudentCredential }
  assert.ok(body.credential)
  // Ensure the credential proof uses the issuer record's trusted key_id
  assert.strictEqual(body.credential.proof.keyId, 'oxford-registry-key-2026')

  // Verify signature cryptographically against public key
  const valid = await verifyCredentialSignature(body.credential, keyPair.publicKey)
  assert.strictEqual(valid, true)

  // Verify status record was created
  assert.ok(capturedStatus !== null)
  assert.strictEqual((capturedStatus as CredentialStatusRecord).credential_id, 'urn:uuid:oxford-cred-001')
})

test('8. Key consistency: Mismatched private/public key returns HTTP 500 ISSUANCE_FAILED', async () => {
  const keyPairA = await generateEd25519KeyPair()
  const keyPairB = await generateEd25519KeyPair()
  const pubBase64UrlA = await exportPublicKeyToBase64Url(keyPairA.publicKey)

  // Active issuer in registry has keyPairA's public key
  const activeIssuer: IssuerRecord = {
    id: 'issuer-mit-01',
    name: 'MIT',
    public_key: pubBase64UrlA,
    key_id: 'mit-key-2026',
    active: true,
  }

  let statusRecorded = false

  const mockDeps: IssueCredentialDependencies = {
    authenticateAndAuthorize: async () => ({
      userId: 'user-admin-1',
      issuerId: 'issuer-mit-01',
      role: 'issuer_admin',
    }),
    loadIssuer: async () => activeIssuer,
    // Server has keyPairB's private key configured (mismatch!)
    loadIssuerPrivateKey: async () => keyPairB.privateKey,
    recordCredentialStatus: async () => {
      statusRecorded = true
    },
    nowIso: () => '2026-10-15T18:00:00.000Z',
    generateId: () => 'uuid',
  }

  const req = new Request('http://localhost/issue-credential', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: 'Bearer admin.jwt',
    },
    body: JSON.stringify({
      subjectId: 'student-1',
      studentStatus: 'active',
      expiresAt: '2027-10-15T18:00:00.000Z',
    }),
  })

  const res = await issueCredentialHandler(req, mockDeps)
  assert.strictEqual(res.status, 500)

  const errBody = (await res.json()) as { error: { code: string; message: string } }
  assert.strictEqual(errBody.error.code, 'ISSUANCE_FAILED')
  assert.strictEqual(
    errBody.error.message,
    'Configured server signing key does not correspond to the registered issuer public key.'
  )

  // Assert no side-effects in status storage
  assert.strictEqual(statusRecorded, false, 'No status record should be created when key consistency fails')
})

test('9. Key consistency: Corrupt or invalid private key configuration returns HTTP 500 ISSUANCE_FAILED', async () => {
  const keyPair = await generateEd25519KeyPair()
  const pubBase64Url = await exportPublicKeyToBase64Url(keyPair.publicKey)

  const activeIssuer: IssuerRecord = {
    id: 'issuer-mit-01',
    name: 'MIT',
    public_key: pubBase64Url,
    key_id: 'mit-key-2026',
    active: true,
  }

  const mockDeps: IssueCredentialDependencies = {
    authenticateAndAuthorize: async () => ({
      userId: 'user-admin-1',
      issuerId: 'issuer-mit-01',
      role: 'issuer_admin',
    }),
    loadIssuer: async () => activeIssuer,
    loadIssuerPrivateKey: async () => {
      // Simulate failure importing malformed private key bytes
      throw new ApiError('ISSUANCE_FAILED', 'Failed to import server signing key.', 500)
    },
    recordCredentialStatus: async () => {},
    nowIso: () => '2026-10-15T18:00:00.000Z',
    generateId: () => 'uuid',
  }

  const req = new Request('http://localhost/issue-credential', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: 'Bearer admin.jwt',
    },
    body: JSON.stringify({
      subjectId: 'student-1',
      studentStatus: 'active',
      expiresAt: '2027-10-15T18:00:00.000Z',
    }),
  })

  const res = await issueCredentialHandler(req, mockDeps)
  assert.strictEqual(res.status, 500)

  const errBody = (await res.json()) as { error: { code: string; message: string } }
  assert.strictEqual(errBody.error.code, 'ISSUANCE_FAILED')
  assert.strictEqual(errBody.error.message, 'Failed to import server signing key.')
})

test('10. Key consistency: Unconfigured private key on server returns HTTP 500 ISSUANCE_FAILED', async () => {
  const keyPair = await generateEd25519KeyPair()
  const pubBase64Url = await exportPublicKeyToBase64Url(keyPair.publicKey)

  const activeIssuer: IssuerRecord = {
    id: 'issuer-mit-01',
    name: 'MIT',
    public_key: pubBase64Url,
    key_id: 'mit-key-2026',
    active: true,
  }

  const mockDeps: IssueCredentialDependencies = {
    authenticateAndAuthorize: async () => ({
      userId: 'user-admin-1',
      issuerId: 'issuer-mit-01',
      role: 'issuer_admin',
    }),
    loadIssuer: async () => activeIssuer,
    loadIssuerPrivateKey: async () => {
      // Missing environment variable
      throw new ApiError('ISSUANCE_FAILED', 'Issuer signing key is not configured on server.', 500)
    },
    recordCredentialStatus: async () => {},
    nowIso: () => '2026-10-15T18:00:00.000Z',
    generateId: () => 'uuid',
  }

  const req = new Request('http://localhost/issue-credential', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: 'Bearer admin.jwt',
    },
    body: JSON.stringify({
      subjectId: 'student-1',
      studentStatus: 'active',
      expiresAt: '2027-10-15T18:00:00.000Z',
    }),
  })

  const res = await issueCredentialHandler(req, mockDeps)
  assert.strictEqual(res.status, 500)

  const errBody = (await res.json()) as { error: { code: string; message: string } }
  assert.strictEqual(errBody.error.code, 'ISSUANCE_FAILED')
  assert.strictEqual(errBody.error.message, 'Issuer signing key is not configured on server.')
})

