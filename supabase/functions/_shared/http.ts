// =============================================================================
// D.I.C.E. Edge Function HTTP & Request Validation Helpers
// Location: supabase/functions/_shared/http.ts
//
// Provides safe CORS handling, deterministic JSON responses, and strict
// input validation guarding against oversized payloads and malformed JSON.
//
// CORS Policy:
// - Restricted to configured ALLOWED_ORIGIN in production.
// - Explicitly defaults to http://localhost:5173 for local development.
// - Never exposes unrestricted wildcard '*' with credentials.
// =============================================================================

import { ApiError } from './errors.ts'
import { getServerEnv } from './supabaseServer.ts'

export const DEFAULT_MAX_REQUEST_SIZE = 64 * 1024 // 64 KB

/**
 * Explicit allowlist of recognized origin domains:
 * - Localhost development server
 * - Production Vercel deployment & aliases
 * - Feature branch preview deployment & aliases
 */
export const STATIC_ALLOWED_ORIGINS: readonly string[] = Object.freeze([
  'http://localhost:5173',
  'http://127.0.0.1:5173',
  // Production Vercel origins
  'https://d-i-c-e.vercel.app',
  'https://d-i-c-e-asxghr.vercel.app',
  'https://d-i-c-e-git-main-asxghr.vercel.app',
  // QR feature branch preview origin
  'https://d-i-c-e-git-feat-frontend-next-step-asxghr.vercel.app',
  // Known active preview deployment aliases
  'https://d-i-c-kmyseeafl-asxghr.vercel.app',
  'https://d-i-c-mf2yonrnc-asxghr.vercel.app',
])

/**
 * Regular expressions matching valid Vercel preview deployments for this project.
 */
export const ALLOWED_ORIGIN_PATTERNS: readonly RegExp[] = Object.freeze([
  // Vercel deployment hashes for this project and user: https://d-i-c-<hash>-asxghr.vercel.app
  /^https:\/\/d-i-c-[a-z0-9]+-asxghr\.vercel\.app$/,
  // Vercel branch preview URLs: https://d-i-c-e-git-*-asxghr.vercel.app
  /^https:\/\/d-i-c-e-git-[a-z0-9-]+-asxghr\.vercel\.app$/,
  // Vercel project deployment hashes: https://d-i-c-e-[a-z0-9]+-asxghr\.vercel\.app
  /^https:\/\/d-i-c-e-[a-z0-9]+-asxghr\.vercel\.app$/,
])

/**
 * Normalizes an origin string by trimming whitespace and removing trailing slashes.
 */
function normalizeOrigin(origin: string): string {
  return origin.trim().replace(/\/+$/, '')
}

/**
 * Determines whether a given origin is permitted under the D.I.C.E. CORS policy.
 * 1. Checks against static allowlist.
 * 2. Checks against Vercel preview deployment patterns.
 * 3. Checks against environment-configured ALLOWED_ORIGIN / ALLOWED_ORIGINS.
 */
export function isAllowedOrigin(rawOrigin?: string | null): boolean {
  if (!rawOrigin || typeof rawOrigin !== 'string') {
    return false
  }

  const origin = normalizeOrigin(rawOrigin)
  if (!origin) {
    return false
  }

  // 1. Static allowlist
  if (STATIC_ALLOWED_ORIGINS.includes(origin)) {
    return true
  }

  // 2. Pattern allowlist (Vercel previews for d-i-c-e)
  if (ALLOWED_ORIGIN_PATTERNS.some((pattern) => pattern.test(origin))) {
    return true
  }

  // 3. Environment-configured origins
  const configured = getServerEnv('ALLOWED_ORIGIN') || getServerEnv('ALLOWED_ORIGINS')
  if (configured && configured.trim()) {
    const customList = configured
      .split(/[\s,]+/)
      .map((item) => normalizeOrigin(item))
      .filter(Boolean)
    if (customList.includes(origin)) {
      return true
    }
  }

  return false
}

/**
 * Resolves the allowed origin for CORS headers.
 * 1. Checks request Origin header against the explicit allowlist.
 *    If allowed, reflects the requesting origin.
 * 2. If an Origin header is present but rejected (not in allowlist), returns null.
 * 3. If no Origin header is present (non-browser or server-to-server):
 *    Falls back to configured ALLOWED_ORIGIN if set, or default localhost for local dev.
 */
export function getCorsOrigin(req?: Request): string | null {
  const requestOrigin = req?.headers?.get('origin')?.trim()

  if (requestOrigin) {
    if (isAllowedOrigin(requestOrigin)) {
      return normalizeOrigin(requestOrigin)
    }
    // Explicitly rejected origin: never reflect
    return null
  }

  // Fallback when no Origin header is sent (e.g. CLI, direct script, or test calls without request object):
  const configured = getServerEnv('ALLOWED_ORIGIN') || getServerEnv('ALLOWED_ORIGINS')
  if (configured && configured.trim()) {
    const firstConfigured = configured
      .split(/[\s,]+/)[0]
      ?.trim()
      ?.replace(/\/+$/, '')
    if (firstConfigured) {
      return firstConfigured
    }
  }

  return STATIC_ALLOWED_ORIGINS[0] // 'http://localhost:5173'
}

/**
 * Generates CORS headers tailored to the request origin and server environment.
 * Omits Access-Control-Allow-Origin if origin is rejected.
 */
export function getCorsHeaders(req?: Request): Record<string, string> {
  const origin = getCorsOrigin(req)
  const headers: Record<string, string> = {
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
    'Vary': 'Origin',
  }

  if (origin) {
    headers['Access-Control-Allow-Origin'] = origin
  }

  return headers
}

/**
 * Backward-compatible corsHeaders accessor referencing the secure origin.
 */
export const corsHeaders: Record<string, string> = new Proxy(
  {},
  {
    get(_target, prop: string) {
      const headers = getCorsHeaders()
      return headers[prop]
    },
    ownKeys() {
      return Reflect.ownKeys(getCorsHeaders())
    },
    getOwnPropertyDescriptor(_target, prop) {
      return Reflect.getOwnPropertyDescriptor(getCorsHeaders(), prop)
    },
  }
)

/**
 * Handles CORS OPTIONS preflight requests safely.
 * Returns a 200 Response if the request is an OPTIONS request, or null otherwise.
 */
export function handleCorsPreflight(req: Request): Response | null {
  if (req.method === 'OPTIONS') {
    return new Response('ok', {
      status: 200,
      headers: getCorsHeaders(req),
    })
  }
  return null
}

/**
 * Asserts that the request method matches one of the allowed HTTP methods.
 */
export function assertMethod(req: Request, allowedMethods: string[]): void {
  const method = req.method.toUpperCase()
  const allowed = allowedMethods.map((m) => m.toUpperCase())
  if (!allowed.includes(method)) {
    throw new ApiError(
      'INVALID_REQUEST',
      `HTTP method ${req.method} is not allowed. Allowed methods: ${allowed.join(', ')}.`,
      405
    )
  }
}

/**
 * Produces a JSON HTTP Response with standard CORS headers.
 */
export function jsonResponse(
  data: unknown,
  status = 200,
  customHeaders?: Record<string, string>,
  req?: Request
): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      ...getCorsHeaders(req),
      'Content-Type': 'application/json',
      ...customHeaders,
    },
  })
}

/**
 * Transforms any error or exception into a stable D.I.C.E. error response:
 * {
 *   "error": {
 *     "code": "ERROR_CODE",
 *     "message": "Safe user-facing message."
 *   }
 * }
 */
export function errorResponse(
  err: unknown,
  statusFallback = 400,
  req?: Request
): Response {
  if (err instanceof ApiError) {
    return jsonResponse(err.toResponseObject(), err.statusCode, undefined, req)
  }

  // Generic fallback for unhandled exceptions (never leak internal stack trace to client)
  const safeMessage = 'An unexpected server error occurred.'
  return jsonResponse(
    {
      error: {
        code: 'INTERNAL_ERROR',
        message: safeMessage,
      },
    },
    statusFallback >= 500 ? statusFallback : 500,
    undefined,
    req
  )
}

/**
 * Safely parses and validates JSON body from a Request.
 * Enforces:
 * 1. Content-Type is application/json
 * 2. Strict maximum request size limit
 * 3. Safe JSON parsing with clean error messages
 */
export async function parseJsonBody<T = unknown>(
  req: Request,
  maxSizeBytes = DEFAULT_MAX_REQUEST_SIZE
): Promise<T> {
  const contentType = req.headers.get('content-type') || ''
  if (!contentType.toLowerCase().includes('application/json')) {
    throw new ApiError(
      'INVALID_REQUEST',
      'Invalid Content-Type: request body must be application/json.',
      415
    )
  }

  // Validate Content-Length header if provided
  const contentLength = req.headers.get('content-length')
  if (contentLength) {
    const lengthNum = parseInt(contentLength, 10)
    if (!Number.isNaN(lengthNum) && lengthNum > maxSizeBytes) {
      throw new ApiError(
        'INVALID_REQUEST',
        `Request body size (${lengthNum} bytes) exceeds limit of ${maxSizeBytes} bytes.`,
        413
      )
    }
  }

  let text: string
  try {
    text = await req.text()
  } catch {
    throw new ApiError('INVALID_REQUEST', 'Failed to read request body stream.', 400)
  }

  const encodedLength = new TextEncoder().encode(text).byteLength
  if (encodedLength > maxSizeBytes) {
    throw new ApiError(
      'INVALID_REQUEST',
      `Request body size (${encodedLength} bytes) exceeds limit of ${maxSizeBytes} bytes.`,
      413
    )
  }

  if (!text.trim()) {
    throw new ApiError('INVALID_REQUEST', 'Request body cannot be empty.', 400)
  }

  try {
    return JSON.parse(text) as T
  } catch {
    throw new ApiError('INVALID_REQUEST', 'Malformed JSON payload in request body.', 400)
  }
}
