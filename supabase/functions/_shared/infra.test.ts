import test from 'node:test'
import assert from 'node:assert/strict'
import { ApiError } from './errors.ts'
import {
  corsHeaders,
  handleCorsPreflight,
  assertMethod,
  jsonResponse,
  errorResponse,
  parseJsonBody,
} from './http.ts'
import {
  extractBearerToken,
  checkIssuerAdminAuthorization,
} from './auth.ts'

test('1. Missing Authorization header throws UNAUTHENTICATED (401)', () => {
  const req = new Request('http://localhost/issue', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
  })

  assert.throws(
    () => extractBearerToken(req),
    (err: unknown) => {
      assert.ok(err instanceof ApiError)
      assert.strictEqual(err.code, 'UNAUTHENTICATED')
      assert.strictEqual(err.statusCode, 401)
      assert.strictEqual(err.message, 'Missing Authorization header.')
      return true
    }
  )
})

test('2. Malformed Bearer tokens throw UNAUTHENTICATED (401)', () => {
  const malformedCases = [
    'Basic dXNlcjpwYXNz', // wrong scheme
    'Bearer', // missing token
    'Bearer   ', // whitespace only
    'Token xyz123', // wrong keyword
    'bearer', // lowercase without token
  ]

  for (const headerVal of malformedCases) {
    const req = new Request('http://localhost/issue', {
      headers: { Authorization: headerVal },
    })

    assert.throws(
      () => extractBearerToken(req),
      (err: unknown) => {
        assert.ok(err instanceof ApiError)
        assert.strictEqual(err.code, 'UNAUTHENTICATED')
        assert.strictEqual(err.statusCode, 401)
        return true
      }
    )
  }

  // Valid Bearer token extracts cleanly
  const validReq = new Request('http://localhost/issue', {
    headers: { Authorization: 'Bearer valid.jwt.token' },
  })
  assert.strictEqual(extractBearerToken(validReq), 'valid.jwt.token')
})

test('3. Oversized requests throw INVALID_REQUEST (413)', async () => {
  // Test with small custom size limit of 50 bytes
  const smallLimit = 50
  const largePayload = JSON.stringify({
    description: 'This payload definitely exceeds the 50 byte test limit easily',
  })

  const req = new Request('http://localhost/issue', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': String(new TextEncoder().encode(largePayload).byteLength),
    },
    body: largePayload,
  })

  await assert.rejects(
    async () => await parseJsonBody(req, smallLimit),
    (err: unknown) => {
      assert.ok(err instanceof ApiError)
      assert.strictEqual(err.code, 'INVALID_REQUEST')
      assert.strictEqual(err.statusCode, 413)
      return true
    }
  )
})

test('4. Malformed JSON and wrong Content-Type throw clean INVALID_REQUEST errors', async () => {
  // Wrong Content-Type
  const wrongTypeReq = new Request('http://localhost/issue', {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain' },
    body: 'plain text',
  })
  await assert.rejects(
    async () => await parseJsonBody(wrongTypeReq),
    (err: unknown) => {
      assert.ok(err instanceof ApiError)
      assert.strictEqual(err.code, 'INVALID_REQUEST')
      assert.strictEqual(err.statusCode, 415)
      return true
    }
  )

  // Malformed JSON
  const brokenJsonReq = new Request('http://localhost/issue', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{"unclosed": "brace"',
  })
  await assert.rejects(
    async () => await parseJsonBody(brokenJsonReq),
    (err: unknown) => {
      assert.ok(err instanceof ApiError)
      assert.strictEqual(err.code, 'INVALID_REQUEST')
      assert.strictEqual(err.statusCode, 400)
      assert.strictEqual(err.message, 'Malformed JSON payload in request body.')
      return true
    }
  )

  // Valid JSON parses successfully
  const validJsonReq = new Request('http://localhost/issue', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ testKey: 'testValue' }),
  })
  const parsed = await parseJsonBody<{ testKey: string }>(validJsonReq)
  assert.strictEqual(parsed.testKey, 'testValue')
})

test('5. Stable error response shape adheres strictly to D.I.C.E. specification', async () => {
  const customError = new ApiError('ISSUANCE_FAILED', 'Signature key unavailable.', 400)
  const res = errorResponse(customError)

  assert.strictEqual(res.status, 400)
  assert.strictEqual(res.headers.get('content-type'), 'application/json')
  assert.strictEqual(res.headers.get('access-control-allow-origin'), 'http://localhost:5173')

  const body = await res.json()
  assert.deepStrictEqual(body, {
    error: {
      code: 'ISSUANCE_FAILED',
      message: 'Signature key unavailable.',
    },
  })

  // Unhandled internal exception fallback (hides internal stacks)
  const internalRes = errorResponse(new Error('Sensitive database timeout at 10.0.0.1'))
  assert.strictEqual(internalRes.status, 500)
  const internalBody = await internalRes.json()
  assert.deepStrictEqual(internalBody, {
    error: {
      code: 'INTERNAL_ERROR',
      message: 'An unexpected server error occurred.',
    },
  })
})

test('6. CORS and OPTIONS preflight behavior is safe and permissive', () => {
  // Preflight OPTIONS returns 200 with secure CORS origin headers
  const optionsReq = new Request('http://localhost/issue', {
    method: 'OPTIONS',
    headers: { Origin: 'http://localhost:5173' },
  })
  const preflightRes = handleCorsPreflight(optionsReq)
  assert.ok(preflightRes !== null)
  assert.strictEqual(preflightRes.status, 200)
  assert.strictEqual(preflightRes.headers.get('access-control-allow-origin'), 'http://localhost:5173')
  assert.ok(preflightRes.headers.get('access-control-allow-methods')?.includes('POST'))
  assert.strictEqual(preflightRes.headers.get('vary'), 'Origin')

  // Direct corsHeaders and jsonResponse checks with fallback
  assert.strictEqual(corsHeaders['Access-Control-Allow-Origin'], 'http://localhost:5173')
  const sampleJsonRes = jsonResponse({ status: 'ok' })
  assert.strictEqual(sampleJsonRes.status, 200)
  assert.strictEqual(sampleJsonRes.headers.get('content-type'), 'application/json')
  assert.strictEqual(sampleJsonRes.headers.get('access-control-allow-origin'), 'http://localhost:5173')

  // Configured ALLOWED_ORIGIN overrides default
  process.env.ALLOWED_ORIGIN = 'https://dice-demo.vercel.app'
  const customOriginRes = jsonResponse({ status: 'ok' })
  assert.strictEqual(customOriginRes.headers.get('access-control-allow-origin'), 'https://dice-demo.vercel.app')
  delete process.env.ALLOWED_ORIGIN

  // Non-OPTIONS requests pass through
  const postReq = new Request('http://localhost/issue', { method: 'POST' })
  assert.strictEqual(handleCorsPreflight(postReq), null)

  // Method assertion
  assert.throws(
    () => assertMethod(new Request('http://localhost/issue', { method: 'GET' }), ['POST']),
    /HTTP method GET is not allowed/
  )
  assert.doesNotThrow(() => assertMethod(postReq, ['POST']))
})

test('7. Ordinary user_metadata is REJECTED as an admin authorization source', () => {
  // Malicious / ordinary user who edited their own user_metadata
  const deceptiveUser = {
    id: 'user-hacker-001',
    user_metadata: {
      role: 'issuer_admin',
      issuer_id: 'univ-mit-01',
    },
    // app_metadata is empty
    app_metadata: {},
  }

  assert.throws(
    () => checkIssuerAdminAuthorization(deceptiveUser),
    (err: unknown) => {
      assert.ok(err instanceof ApiError)
      assert.strictEqual(err.code, 'NOT_AUTHORIZED')
      assert.strictEqual(err.statusCode, 403)
      assert.strictEqual(err.message, 'Access denied: user does not hold the issuer_admin role.')
      return true
    }
  )

  // Legitimate user with server-controlled app_metadata
  const authorizedUser = {
    id: 'user-admin-001',
    app_metadata: {
      role: 'issuer_admin',
      issuer_id: 'univ-mit-01',
    },
  }

  const claims = checkIssuerAdminAuthorization(authorizedUser)
  assert.strictEqual(claims.userId, 'user-admin-001')
  assert.strictEqual(claims.issuerId, 'univ-mit-01')
  assert.strictEqual(claims.role, 'issuer_admin')

  // User attempting to act on unauthorized target issuer
  assert.throws(
    () => checkIssuerAdminAuthorization(authorizedUser, 'univ-harvard-02'),
    (err: unknown) => {
      assert.ok(err instanceof ApiError)
      assert.strictEqual(err.code, 'NOT_AUTHORIZED')
      assert.strictEqual(err.statusCode, 403)
      assert.ok(err.message.includes('not \'univ-harvard-02\''))
      return true
    }
  )
})
