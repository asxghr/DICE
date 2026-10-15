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
  isAllowedOrigin,
  STATIC_ALLOWED_ORIGINS,
} from './http.ts'
import {
  extractBearerToken,
  checkIssuerAdminAuthorization,
} from './auth.ts'
import { issueCredentialHandler } from '../issue-credential/index.ts'
import { verifyCredentialHandler } from '../verify-credential/index.ts'
import { revokeCredentialHandler } from '../revoke-credential/index.ts'

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

test('6. CORS allowlist, origin reflection, and OPTIONS preflight behavior', async () => {
  const allowedOrigins = [
    'http://localhost:5173',
    'http://127.0.0.1:5173',
    'https://d-i-c-e.vercel.app',
    'https://d-i-c-e-asxghr.vercel.app',
    'https://d-i-c-e-git-main-asxghr.vercel.app',
    'https://d-i-c-e-git-feat-frontend-next-step-asxghr.vercel.app',
    'https://d-i-c-kmyseeafl-asxghr.vercel.app',
    'https://d-i-c-mf2yonrnc-asxghr.vercel.app',
  ]

  const rejectedOrigins = [
    'https://malicious-site.com',
    'https://attacker-origin.example.org',
    'http://localhost:3000',
    'https://another-project.vercel.app',
    'https://d-i-c-e.evil.com',
  ]

  // A. Allowed origins: Preflight OPTIONS reflects requesting origin exactly, never '*'
  for (const origin of allowedOrigins) {
    const optionsReq = new Request('http://localhost/issue', {
      method: 'OPTIONS',
      headers: { Origin: origin },
    })
    const preflightRes = handleCorsPreflight(optionsReq)
    assert.ok(preflightRes !== null, `Preflight response should not be null for ${origin}`)
    assert.strictEqual(preflightRes.status, 200)
    assert.strictEqual(
      preflightRes.headers.get('access-control-allow-origin'),
      origin,
      `Should reflect allowed origin ${origin}`
    )
    assert.notStrictEqual(
      preflightRes.headers.get('access-control-allow-origin'),
      '*',
      'Must never use wildcard origin "*"'
    )
    assert.ok(preflightRes.headers.get('access-control-allow-methods')?.includes('POST'))
    assert.ok(preflightRes.headers.get('access-control-allow-headers')?.includes('authorization'))
    assert.strictEqual(preflightRes.headers.get('vary'), 'Origin')

    // Standard JSON response reflects allowed origin
    const postReq = new Request('http://localhost/issue', {
      method: 'POST',
      headers: { Origin: origin },
    })
    const jsonRes = jsonResponse({ status: 'ok' }, 200, undefined, postReq)
    assert.strictEqual(jsonRes.headers.get('access-control-allow-origin'), origin)

    // Error response reflects allowed origin
    const errRes = errorResponse(new ApiError('INVALID_REQUEST', 'Bad request', 400), 400, postReq)
    assert.strictEqual(errRes.headers.get('access-control-allow-origin'), origin)
  }

  // B. Rejected origins: Never reflected in CORS headers
  for (const rejectedOrigin of rejectedOrigins) {
    const optionsReq = new Request('http://localhost/issue', {
      method: 'OPTIONS',
      headers: { Origin: rejectedOrigin },
    })
    const preflightRes = handleCorsPreflight(optionsReq)
    assert.ok(preflightRes !== null)
    assert.strictEqual(preflightRes.status, 200)
    assert.strictEqual(
      preflightRes.headers.get('access-control-allow-origin'),
      null,
      `Rejected origin ${rejectedOrigin} must NOT be reflected`
    )
    assert.notStrictEqual(preflightRes.headers.get('access-control-allow-origin'), rejectedOrigin)

    // JSON response does not reflect rejected origin
    const postReq = new Request('http://localhost/issue', {
      method: 'POST',
      headers: { Origin: rejectedOrigin },
    })
    const jsonRes = jsonResponse({ status: 'ok' }, 200, undefined, postReq)
    assert.strictEqual(jsonRes.headers.get('access-control-allow-origin'), null)
    assert.notStrictEqual(jsonRes.headers.get('access-control-allow-origin'), rejectedOrigin)

    // Error response does not reflect rejected origin
    const errRes = errorResponse(new ApiError('INVALID_REQUEST', 'Bad request', 400), 400, postReq)
    assert.strictEqual(errRes.headers.get('access-control-allow-origin'), null)
    assert.notStrictEqual(errRes.headers.get('access-control-allow-origin'), rejectedOrigin)
  }

  // C. Fallback when request has no Origin header (CLI, server-to-server, unit tests)
  assert.strictEqual(corsHeaders['Access-Control-Allow-Origin'], 'http://localhost:5173')
  const defaultJsonRes = jsonResponse({ status: 'ok' })
  assert.strictEqual(defaultJsonRes.headers.get('access-control-allow-origin'), 'http://localhost:5173')

  // D. Environment variable ALLOWED_ORIGIN configuration support
  process.env.ALLOWED_ORIGIN = 'https://dice-demo.vercel.app'
  const customOriginReq = new Request('http://localhost/issue', {
    method: 'OPTIONS',
    headers: { Origin: 'https://dice-demo.vercel.app' },
  })
  const customPreflight = handleCorsPreflight(customOriginReq)
  assert.strictEqual(
    customPreflight?.headers.get('access-control-allow-origin'),
    'https://dice-demo.vercel.app'
  )
  const customOriginRes = jsonResponse({ status: 'ok' })
  assert.strictEqual(
    customOriginRes.headers.get('access-control-allow-origin'),
    'https://dice-demo.vercel.app'
  )
  delete process.env.ALLOWED_ORIGIN

  // E. Non-OPTIONS requests pass through preflight handler
  const postReq = new Request('http://localhost/issue', { method: 'POST' })
  assert.strictEqual(handleCorsPreflight(postReq), null)

  // F. Method assertion
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

test('8. isAllowedOrigin correctly identifies localhost, production, preview, and rejected origins', () => {
  // Explicit static allowlist exports
  assert.ok(STATIC_ALLOWED_ORIGINS.includes('http://localhost:5173'))
  assert.ok(STATIC_ALLOWED_ORIGINS.includes('https://d-i-c-e.vercel.app'))
  assert.ok(STATIC_ALLOWED_ORIGINS.includes('https://d-i-c-e-git-feat-frontend-next-step-asxghr.vercel.app'))

  // Localhost development origins
  assert.strictEqual(isAllowedOrigin('http://localhost:5173'), true)
  assert.strictEqual(isAllowedOrigin('http://127.0.0.1:5173'), true)
  assert.strictEqual(isAllowedOrigin('http://localhost:5173/'), true) // trailing slash normalized

  // Production Vercel origins
  assert.strictEqual(isAllowedOrigin('https://d-i-c-e.vercel.app'), true)
  assert.strictEqual(isAllowedOrigin('https://d-i-c-e-asxghr.vercel.app'), true)
  assert.strictEqual(isAllowedOrigin('https://d-i-c-e-git-main-asxghr.vercel.app'), true)

  // QR feature branch preview origin
  assert.strictEqual(isAllowedOrigin('https://d-i-c-e-git-feat-frontend-next-step-asxghr.vercel.app'), true)

  // Known and pattern-based Vercel preview deployment aliases
  assert.strictEqual(isAllowedOrigin('https://d-i-c-kmyseeafl-asxghr.vercel.app'), true)
  assert.strictEqual(isAllowedOrigin('https://d-i-c-mf2yonrnc-asxghr.vercel.app'), true)
  assert.strictEqual(isAllowedOrigin('https://d-i-c-preview999-asxghr.vercel.app'), true)
  assert.strictEqual(isAllowedOrigin('https://d-i-c-e-git-some-branch-asxghr.vercel.app'), true)

  // Rejected origins
  assert.strictEqual(isAllowedOrigin('https://malicious.com'), false)
  assert.strictEqual(isAllowedOrigin('http://localhost:3000'), false)
  assert.strictEqual(isAllowedOrigin('https://attacker.vercel.app'), false)
  assert.strictEqual(isAllowedOrigin('https://d-i-c-e.vercel.app.evil.com'), false)
  assert.strictEqual(isAllowedOrigin(''), false)
  assert.strictEqual(isAllowedOrigin(null), false)
  assert.strictEqual(isAllowedOrigin(undefined), false)
})

test('9. Edge Functions (issue, verify, revoke) apply CORS consistently across preflight and error responses', async () => {
  const handlers = [
    { name: 'issue-credential', handler: issueCredentialHandler },
    { name: 'verify-credential', handler: verifyCredentialHandler },
    { name: 'revoke-credential', handler: revokeCredentialHandler },
  ]

  const testOrigins = [
    { origin: 'http://localhost:5173', expectedAllowed: true },
    { origin: 'https://d-i-c-e.vercel.app', expectedAllowed: true },
    { origin: 'https://d-i-c-e-git-feat-frontend-next-step-asxghr.vercel.app', expectedAllowed: true },
    { origin: 'https://d-i-c-kmyseeafl-asxghr.vercel.app', expectedAllowed: true },
    { origin: 'https://malicious-attacker.com', expectedAllowed: false },
    { origin: 'http://localhost:3000', expectedAllowed: false },
  ]

  for (const { name, handler } of handlers) {
    for (const { origin, expectedAllowed } of testOrigins) {
      // 1. OPTIONS Preflight
      const optionsReq = new Request(`http://localhost/${name}`, {
        method: 'OPTIONS',
        headers: { Origin: origin },
      })
      const preflightRes = await handler(optionsReq)
      assert.strictEqual(preflightRes.status, 200, `${name} preflight must return 200`)
      assert.strictEqual(preflightRes.headers.get('vary'), 'Origin')

      if (expectedAllowed) {
        assert.strictEqual(
          preflightRes.headers.get('access-control-allow-origin'),
          origin,
          `${name} preflight should reflect allowed origin ${origin}`
        )
        assert.notStrictEqual(
          preflightRes.headers.get('access-control-allow-origin'),
          '*',
          `${name} preflight must not use wildcard '*'`
        )
        assert.ok(
          preflightRes.headers.get('access-control-allow-methods')?.includes('POST'),
          `${name} preflight should allow POST`
        )
      } else {
        assert.strictEqual(
          preflightRes.headers.get('access-control-allow-origin'),
          null,
          `${name} preflight must NOT reflect rejected origin ${origin}`
        )
      }

      // 2. Actual Request Error Response (e.g., missing body / invalid method)
      const postReq = new Request(`http://localhost/${name}`, {
        method: 'POST',
        headers: {
          Origin: origin,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({}),
      })
      const postRes = await handler(postReq)
      assert.strictEqual(postRes.headers.get('vary'), 'Origin')

      if (expectedAllowed) {
        assert.strictEqual(
          postRes.headers.get('access-control-allow-origin'),
          origin,
          `${name} response should reflect allowed origin ${origin}`
        )
        assert.notStrictEqual(
          postRes.headers.get('access-control-allow-origin'),
          '*',
          `${name} response must not use wildcard '*'`
        )
      } else {
        assert.strictEqual(
          postRes.headers.get('access-control-allow-origin'),
          null,
          `${name} response must NOT reflect rejected origin ${origin}`
        )
      }
    }
  }
})
