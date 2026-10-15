import test from 'node:test'
import assert from 'node:assert/strict'
import {
  revokeCredentialHandler,
  validateRevokeCredentialRequest,
  type CredentialStatusRow,
  type RevokeCredentialDependencies,
  type RevokeCredentialResponse,
} from './index.ts'
import { ApiError } from '../_shared/errors.ts'

test('1. Authorized revocation succeeds and updates status', async () => {
  const existingRow: CredentialStatusRow = {
    credential_id: 'urn:uuid:credential-revoke-001',
    issuer_id: 'issuer-mit-01',
    revoked: false,
    updated_at: '2026-10-15T18:00:00.000Z',
  }

  let capturedUpdate: { id: string; issuerId: string; updatedAt: string } | null = null

  const mockDeps: RevokeCredentialDependencies = {
    authenticateAndAuthorize: async () => ({
      userId: 'admin-mit-user',
      issuerId: 'issuer-mit-01',
      role: 'issuer_admin',
    }),
    loadCredentialStatus: async (id) => (id === existingRow.credential_id ? existingRow : null),
    updateRevocationStatus: async (id, issuerId, updatedAt) => {
      capturedUpdate = { id, issuerId, updatedAt }
      return true
    },
    nowIso: () => '2026-10-15T20:00:00.000Z',
  }

  const req = new Request('http://localhost/revoke-credential', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: 'Bearer valid.jwt.token',
    },
    body: JSON.stringify({
      credentialId: 'urn:uuid:credential-revoke-001',
      reasonCode: 'ISSUED_IN_ERROR',
    }),
  })

  const res = await revokeCredentialHandler(req, mockDeps)
  assert.strictEqual(res.status, 200)

  const body = (await res.json()) as RevokeCredentialResponse
  assert.deepStrictEqual(body, {
    credentialId: 'urn:uuid:credential-revoke-001',
    revoked: true,
    updatedAt: '2026-10-15T20:00:00.000Z',
  })

  // Verify minimal status update
  assert.ok(capturedUpdate !== null)
  assert.deepStrictEqual(capturedUpdate, {
    id: 'urn:uuid:credential-revoke-001',
    issuerId: 'issuer-mit-01',
    updatedAt: '2026-10-15T20:00:00.000Z',
  })
  // Ensure NO student claims or credential payloads were touched or stored
  assert.strictEqual('claims' in capturedUpdate, false)
  assert.strictEqual('subject' in capturedUpdate, false)
})

test('2. Unauthenticated request returns 401 UNAUTHENTICATED', async () => {
  const mockDeps: RevokeCredentialDependencies = {
    authenticateAndAuthorize: async () => {
      throw new ApiError('UNAUTHENTICATED', 'Missing Authorization header.', 401)
    },
    loadCredentialStatus: async () => null,
    updateRevocationStatus: async () => true,
    nowIso: () => '2026-10-15T20:00:00.000Z',
  }

  const req = new Request('http://localhost/revoke-credential', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      credentialId: 'urn:uuid:credential-revoke-001',
      reasonCode: 'ISSUED_IN_ERROR',
    }),
  })

  const res = await revokeCredentialHandler(req, mockDeps)
  assert.strictEqual(res.status, 401)
  const body = (await res.json()) as { error: { code: string; message: string } }
  assert.strictEqual(body.error.code, 'UNAUTHENTICATED')
})

test('3. Unauthorized caller returns 403 NOT_AUTHORIZED', async () => {
  const mockDeps: RevokeCredentialDependencies = {
    authenticateAndAuthorize: async () => {
      throw new ApiError('NOT_AUTHORIZED', 'Access denied: user does not hold the issuer_admin role.', 403)
    },
    loadCredentialStatus: async () => null,
    updateRevocationStatus: async () => true,
    nowIso: () => '2026-10-15T20:00:00.000Z',
  }

  const req = new Request('http://localhost/revoke-credential', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: 'Bearer student.jwt',
    },
    body: JSON.stringify({
      credentialId: 'urn:uuid:credential-revoke-001',
      reasonCode: 'ISSUED_IN_ERROR',
    }),
  })

  const res = await revokeCredentialHandler(req, mockDeps)
  assert.strictEqual(res.status, 403)
  const body = (await res.json()) as { error: { code: string } }
  assert.strictEqual(body.error.code, 'NOT_AUTHORIZED')
})

test('4. Issuer CANNOT revoke another issuer’s credential (403 NOT_AUTHORIZED)', async () => {
  // Credential belongs to Harvard
  const harvardRow: CredentialStatusRow = {
    credential_id: 'urn:uuid:harvard-credential-123',
    issuer_id: 'issuer-harvard-02',
    revoked: false,
    updated_at: '2026-10-15T18:00:00.000Z',
  }

  // Caller is MIT admin
  const mockDeps: RevokeCredentialDependencies = {
    authenticateAndAuthorize: async () => ({
      userId: 'admin-mit-user',
      issuerId: 'issuer-mit-01',
      role: 'issuer_admin',
    }),
    loadCredentialStatus: async (id) => (id === harvardRow.credential_id ? harvardRow : null),
    updateRevocationStatus: async () => true,
    nowIso: () => '2026-10-15T20:00:00.000Z',
  }

  const req = new Request('http://localhost/revoke-credential', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: 'Bearer mit.admin.jwt',
    },
    body: JSON.stringify({
      credentialId: 'urn:uuid:harvard-credential-123',
      reasonCode: 'ISSUED_IN_ERROR',
    }),
  })

  const res = await revokeCredentialHandler(req, mockDeps)
  assert.strictEqual(res.status, 403)
  const body = (await res.json()) as { error: { code: string; message: string } }
  assert.strictEqual(body.error.code, 'NOT_AUTHORIZED')
  assert.strictEqual(body.error.message, 'Access denied: you are not authorized to revoke credentials issued by another authority.')
})

test('5. Missing credential returns 404 CREDENTIAL_NOT_FOUND', async () => {
  const mockDeps: RevokeCredentialDependencies = {
    authenticateAndAuthorize: async () => ({
      userId: 'admin-mit-user',
      issuerId: 'issuer-mit-01',
      role: 'issuer_admin',
    }),
    loadCredentialStatus: async () => null, // does not exist
    updateRevocationStatus: async () => true,
    nowIso: () => '2026-10-15T20:00:00.000Z',
  }

  const req = new Request('http://localhost/revoke-credential', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: 'Bearer mit.admin.jwt',
    },
    body: JSON.stringify({
      credentialId: 'urn:uuid:non-existent-id',
      reasonCode: 'ISSUED_IN_ERROR',
    }),
  })

  const res = await revokeCredentialHandler(req, mockDeps)
  assert.strictEqual(res.status, 404)
  const body = (await res.json()) as { error: { code: string; message: string } }
  assert.strictEqual(body.error.code, 'CREDENTIAL_NOT_FOUND')
  assert.ok(body.error.message.includes('non-existent-id'))
})

test('6. Already revoked credential returns 409 ALREADY_REVOKED', async () => {
  const alreadyRevokedRow: CredentialStatusRow = {
    credential_id: 'urn:uuid:credential-revoke-001',
    issuer_id: 'issuer-mit-01',
    revoked: true, // already revoked
    updated_at: '2026-10-15T18:00:00.000Z',
  }

  const mockDeps: RevokeCredentialDependencies = {
    authenticateAndAuthorize: async () => ({
      userId: 'admin-mit-user',
      issuerId: 'issuer-mit-01',
      role: 'issuer_admin',
    }),
    loadCredentialStatus: async () => alreadyRevokedRow,
    updateRevocationStatus: async () => true,
    nowIso: () => '2026-10-15T20:00:00.000Z',
  }

  const req = new Request('http://localhost/revoke-credential', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: 'Bearer mit.admin.jwt',
    },
    body: JSON.stringify({
      credentialId: 'urn:uuid:credential-revoke-001',
      reasonCode: 'ISSUED_IN_ERROR',
    }),
  })

  const res = await revokeCredentialHandler(req, mockDeps)
  assert.strictEqual(res.status, 409)
  const body = (await res.json()) as { error: { code: string; message: string } }
  assert.strictEqual(body.error.code, 'ALREADY_REVOKED')
  assert.ok(body.error.message.includes('already been revoked'))
})

test('7. Invalid reason code or free-text reason returns 400 INVALID_REQUEST', () => {
  // Free-text reason
  assert.throws(
    () =>
      validateRevokeCredentialRequest({
        credentialId: 'id-1',
        reasonCode: 'Student cheated on finals',
      }),
    (err: unknown) => {
      assert.ok(err instanceof ApiError)
      assert.strictEqual(err.code, 'INVALID_REQUEST')
      assert.strictEqual(err.statusCode, 400)
      assert.ok(err.message.includes('approved enum value'))
      return true
    }
  )

  // Empty credentialId
  assert.throws(
    () =>
      validateRevokeCredentialRequest({
        credentialId: '   ',
        reasonCode: 'ISSUED_IN_ERROR',
      }),
    (err: unknown) => {
      assert.ok(err instanceof ApiError)
      assert.strictEqual(err.code, 'INVALID_REQUEST')
      assert.strictEqual(err.statusCode, 400)
      return true
    }
  )

  // Unknown extra fields rejected
  assert.throws(
    () =>
      validateRevokeCredentialRequest({
        credentialId: 'id-1',
        reasonCode: 'ISSUED_IN_ERROR',
        extraNote: 'injected note',
      }),
    (err: unknown) => {
      assert.ok(err instanceof ApiError)
      assert.strictEqual(err.code, 'INVALID_REQUEST')
      assert.strictEqual(err.statusCode, 400)
      assert.ok(err.message.includes("Unexpected field 'extraNote'"))
      return true
    }
  )
})

test('8. Regression: Credential-status lookup database failure during revocation returns HTTP 500 REVOCATION_FAILED', async () => {
  const mockDeps: RevokeCredentialDependencies = {
    authenticateAndAuthorize: async () => ({
      userId: 'admin-mit-user',
      issuerId: 'issuer-mit-01',
      role: 'issuer_admin',
    }),
    loadCredentialStatus: async () => {
      throw new Error('Postgres connection terminated abnormally; select * from credential_status')
    },
    updateRevocationStatus: async () => true,
    nowIso: () => '2026-10-15T20:00:00.000Z',
  }

  const req = new Request('http://localhost/revoke-credential', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: 'Bearer mit.admin.jwt',
    },
    body: JSON.stringify({
      credentialId: 'urn:uuid:credential-revoke-001',
      reasonCode: 'ISSUED_IN_ERROR',
    }),
  })

  const res = await revokeCredentialHandler(req, mockDeps)
  assert.strictEqual(res.status, 500)
  const body = (await res.json()) as { error: { code: string; message: string } }
  assert.strictEqual(body.error.code, 'REVOCATION_FAILED')
  assert.strictEqual(body.error.message, 'Failed to query credential status from database.')
  // Verify no raw database details are leaked
  assert.strictEqual(body.error.message.includes('Postgres connection'), false)
  assert.strictEqual(body.error.message.includes('select *'), false)
  assert.strictEqual(body.error.message.includes('credential_status'), false)
})

test('9. Regression: Revocation update database failure during revocation returns HTTP 500 REVOCATION_FAILED', async () => {
  const existingRow: CredentialStatusRow = {
    credential_id: 'urn:uuid:credential-revoke-001',
    issuer_id: 'issuer-mit-01',
    revoked: false,
    updated_at: '2026-10-15T18:00:00.000Z',
  }

  const mockDeps: RevokeCredentialDependencies = {
    authenticateAndAuthorize: async () => ({
      userId: 'admin-mit-user',
      issuerId: 'issuer-mit-01',
      role: 'issuer_admin',
    }),
    loadCredentialStatus: async () => existingRow,
    updateRevocationStatus: async () => {
      throw new Error('DB write failed: exclusive lock timeout on update credential_status')
    },
    nowIso: () => '2026-10-15T20:00:00.000Z',
  }

  const req = new Request('http://localhost/revoke-credential', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: 'Bearer mit.admin.jwt',
    },
    body: JSON.stringify({
      credentialId: 'urn:uuid:credential-revoke-001',
      reasonCode: 'ISSUED_IN_ERROR',
    }),
  })

  const res = await revokeCredentialHandler(req, mockDeps)
  assert.strictEqual(res.status, 500)
  const body = (await res.json()) as { error: { code: string; message: string } }
  assert.strictEqual(body.error.code, 'REVOCATION_FAILED')
  assert.strictEqual(body.error.message, 'Failed to update credential status in database.')
  // Verify no raw database details are leaked
  assert.strictEqual(body.error.message.includes('DB write failed'), false)
  assert.strictEqual(body.error.message.includes('lock timeout'), false)
  assert.strictEqual(body.error.message.includes('credential_status'), false)
})

test('10. Concurrent race safety: Conditional update affecting zero rows returns HTTP 409 ALREADY_REVOKED', async () => {
  const existingRow: CredentialStatusRow = {
    credential_id: 'urn:uuid:credential-revoke-001',
    issuer_id: 'issuer-mit-01',
    revoked: false,
    updated_at: '2026-10-15T18:00:00.000Z',
  }

  let updateCalledWith: { id: string; issuerId: string; updatedAt: string } | null = null

  const mockDeps: RevokeCredentialDependencies = {
    authenticateAndAuthorize: async () => ({
      userId: 'admin-mit-user',
      issuerId: 'issuer-mit-01',
      role: 'issuer_admin',
    }),
    loadCredentialStatus: async () => existingRow,
    // Simulate conditional update affecting 0 rows (e.g. concurrent race winner already updated row)
    updateRevocationStatus: async (id, issuerId, updatedAt) => {
      updateCalledWith = { id, issuerId, updatedAt }
      return false
    },
    nowIso: () => '2026-10-15T20:00:00.000Z',
  }

  const req = new Request('http://localhost/revoke-credential', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: 'Bearer mit.admin.jwt',
    },
    body: JSON.stringify({
      credentialId: 'urn:uuid:credential-revoke-001',
      reasonCode: 'ISSUED_IN_ERROR',
    }),
  })

  const res = await revokeCredentialHandler(req, mockDeps)
  assert.strictEqual(res.status, 409)

  const body = (await res.json()) as { error: { code: string; message: string } }
  assert.strictEqual(body.error.code, 'ALREADY_REVOKED')
  assert.strictEqual(
    body.error.message,
    "Credential 'urn:uuid:credential-revoke-001' has already been revoked."
  )

  // Verify that conditional update was invoked with credential_id, issuer_id, and timestamp
  assert.deepStrictEqual(updateCalledWith, {
    id: 'urn:uuid:credential-revoke-001',
    issuerId: 'issuer-mit-01',
    updatedAt: '2026-10-15T20:00:00.000Z',
  })
})

test('11. Race condition simulation: Concurrent duplicate requests result in exactly one HTTP 200 and one HTTP 409', async () => {
  const rowState: CredentialStatusRow = {
    credential_id: 'urn:uuid:credential-race-002',
    issuer_id: 'issuer-mit-01',
    revoked: false,
    updated_at: '2026-10-15T18:00:00.000Z',
  }

  // Atomic conditional update simulation matching the database update WHERE constraints
  const mockDeps: RevokeCredentialDependencies = {
    authenticateAndAuthorize: async () => ({
      userId: 'admin-mit-user',
      issuerId: 'issuer-mit-01',
      role: 'issuer_admin',
    }),
    loadCredentialStatus: async () => ({ ...rowState }),
    updateRevocationStatus: async (credentialId, issuerId, updatedAt) => {
      // Atomic condition: only updates if credential_id, issuer_id match and revoked is false
      if (
        rowState.credential_id === credentialId &&
        rowState.issuer_id === issuerId &&
        !rowState.revoked
      ) {
        rowState.revoked = true
        rowState.updated_at = updatedAt
        return true
      }
      return false
    },
    nowIso: () => '2026-10-15T20:00:00.000Z',
  }

  const makeReq = () =>
    new Request('http://localhost/revoke-credential', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer mit.admin.jwt',
      },
      body: JSON.stringify({
        credentialId: 'urn:uuid:credential-race-002',
        reasonCode: 'ISSUED_IN_ERROR',
      }),
    })

  // Concurrently execute both requests
  const [resA, resB] = await Promise.all([
    revokeCredentialHandler(makeReq(), mockDeps),
    revokeCredentialHandler(makeReq(), mockDeps),
  ])

  const statuses = [resA.status, resB.status].sort()
  assert.deepStrictEqual(
    statuses,
    [200, 409],
    'Concurrent requests must result in exactly one 200 and one 409'
  )

  const bodies = await Promise.all([resA.json(), resB.json()])
  const successBody = bodies.find((b: unknown) => (b as RevokeCredentialResponse).revoked === true) as RevokeCredentialResponse | undefined
  const conflictBody = bodies.find((b: unknown) => (b as { error?: { code: string } }).error?.code === 'ALREADY_REVOKED') as { error: { code: string; message: string } } | undefined

  assert.ok(successBody, 'One response must be successful revocation payload')
  assert.strictEqual(successBody.credentialId, 'urn:uuid:credential-race-002')
  assert.strictEqual(successBody.revoked, true)
  assert.ok(conflictBody, 'One response must be ALREADY_REVOKED error')
  assert.strictEqual(conflictBody.error.code, 'ALREADY_REVOKED')
})
