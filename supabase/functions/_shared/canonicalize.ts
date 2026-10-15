// =============================================================================
// D.I.C.E. Canonicalization & Serialization Engine
// Location: supabase/functions/_shared/canonicalize.ts
//
// Ensures deterministic, lexicographical serialization of credential payloads.
// Explicitly separates generic canonicalization from credential unsigned payload extraction.
// Timestamps are strictly constrained to valid ISO-8601 UTC strings ending in 'Z'.
// =============================================================================

import type {
  StudentCredential,
  UnsignedStudentCredential,
} from './types.ts'

const textEncoder = new TextEncoder()
const textDecoder = new TextDecoder()

/**
 * Validates ISO-8601 UTC timestamp format.
 * Strictly accepts only timestamps ending in 'Z'.
 * Rejects '+00:00', other offsets, timezone-less timestamps, and invalid dates.
 */
export function isIsoUtcTimestamp(timestamp: string): boolean {
  if (typeof timestamp !== 'string') return false
  // Strict ISO-8601 UTC pattern requiring 'Z' suffix: YYYY-MM-DDTHH:MM:SS(.sss)?Z
  const utcRegex = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/
  if (!utcRegex.test(timestamp)) return false
  const time = Date.parse(timestamp)
  return !Number.isNaN(time)
}

/**
 * Explicitly extracts and validates only the unsigned credential payload fields.
 * Any proof object or signature value is intentionally excluded from the returned payload.
 */
export function toUnsignedPayload(
  credential: UnsignedStudentCredential | StudentCredential
): UnsignedStudentCredential {
  if (!credential || typeof credential !== 'object') {
    throw new TypeError('Invalid credential: must be a non-null object')
  }

  // Validate required field presence and formats
  if (typeof credential.id !== 'string' || !credential.id.trim()) {
    throw new TypeError('Credential id must be a non-empty string')
  }
  if (credential.type !== 'StudentCredential') {
    throw new TypeError(`Invalid credential type: expected 'StudentCredential', received '${String(credential.type)}'`)
  }
  if (typeof credential.issuerId !== 'string' || !credential.issuerId.trim()) {
    throw new TypeError('Credential issuerId must be a non-empty string')
  }
  if (!credential.subject || typeof credential.subject !== 'object' || typeof credential.subject.id !== 'string') {
    throw new TypeError('Credential subject must be an object with string id')
  }
  if (!credential.claims || typeof credential.claims !== 'object') {
    throw new TypeError('Credential claims must be an object')
  }
  if (credential.claims.studentStatus !== 'active' && credential.claims.studentStatus !== 'inactive') {
    throw new TypeError(`Credential claims.studentStatus must be 'active' or 'inactive'`)
  }
  if (!isIsoUtcTimestamp(credential.issuedAt)) {
    throw new TypeError(`Credential issuedAt must be a valid ISO-8601 UTC string ending in 'Z' (got: ${credential.issuedAt})`)
  }
  if (!isIsoUtcTimestamp(credential.expiresAt)) {
    throw new TypeError(`Credential expiresAt must be a valid ISO-8601 UTC string ending in 'Z' (got: ${credential.expiresAt})`)
  }

  // Return strictly the signed fields (proof is explicitly omitted)
  return {
    id: credential.id,
    type: credential.type,
    issuerId: credential.issuerId,
    subject: {
      id: credential.subject.id,
    },
    claims: {
      studentStatus: credential.claims.studentStatus,
    },
    issuedAt: credential.issuedAt,
    expiresAt: credential.expiresAt,
  }
}

/**
 * Generic deterministic JSON serializer with recursive lexicographically sorted keys.
 * Does NOT silently remove or omit arbitrary fields (such as 'proof').
 * Rejects unsupported types: undefined, functions, symbols, BigInts, NaN, Infinity.
 */
export function canonicalizeValue(val: unknown, path = '$'): string {
  if (val === undefined) {
    throw new TypeError(`Unsupported value 'undefined' at ${path}`)
  }
  if (typeof val === 'function' || typeof val === 'symbol') {
    throw new TypeError(`Unsupported type '${typeof val}' at ${path}`)
  }
  if (typeof val === 'bigint') {
    throw new TypeError(`Unsupported type 'bigint' at ${path}`)
  }
  if (val === null) {
    return 'null'
  }
  if (typeof val === 'boolean') {
    return val ? 'true' : 'false'
  }
  if (typeof val === 'number') {
    if (!Number.isFinite(val)) {
      throw new TypeError(`Unsupported non-finite number (NaN/Infinity) at ${path}`)
    }
    return val.toString()
  }
  if (typeof val === 'string') {
    return JSON.stringify(val)
  }
  if (Array.isArray(val)) {
    const items = val.map((item, idx) => canonicalizeValue(item, `${path}[${idx}]`))
    return `[${items.join(',')}]`
  }
  if (typeof val === 'object') {
    const obj = val as Record<string, unknown>
    // Sort keys lexicographically without dropping any fields
    const sortedKeys = Object.keys(obj).sort()
    const entries: string[] = []

    for (const key of sortedKeys) {
      const entryVal = obj[key]
      if (entryVal === undefined) {
        throw new TypeError(`Unsupported value 'undefined' at property '${path}.${key}'`)
      }
      entries.push(`${JSON.stringify(key)}:${canonicalizeValue(entryVal, `${path}.${key}`)}`)
    }

    return `{${entries.join(',')}}`
  }

  throw new TypeError(`Unknown value type at ${path}`)
}

/**
 * Prepares the unsigned credential payload and serializes it to a deterministic UTF-8 canonical string.
 * Proof exclusion occurs strictly via toUnsignedPayload.
 */
export function canonicalizeCredentialToUtf8(
  credential: UnsignedStudentCredential | StudentCredential
): string {
  const unsignedPayload = toUnsignedPayload(credential)
  return canonicalizeValue(unsignedPayload, '$')
}

/**
 * Encodes the canonicalized unsigned credential string into UTF-8 bytes for cryptographic signing/verification.
 */
export function canonicalizeCredentialToBytes(
  credential: UnsignedStudentCredential | StudentCredential
): Uint8Array {
  const utf8 = canonicalizeCredentialToUtf8(credential)
  return textEncoder.encode(utf8)
}

/**
 * Decodes UTF-8 bytes back to string for inspection.
 */
export function canonicalBytesToUtf8(bytes: Uint8Array): string {
  return textDecoder.decode(bytes)
}

/**
 * Encodes a Uint8Array to base64url string (RFC 4648 §5, URL and filename safe, no padding).
 */
export function uint8ArrayToBase64Url(bytes: Uint8Array): string {
  let binary = ''
  const len = bytes.byteLength
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(bytes[i])
  }
  return btoa(binary)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')
}

/**
 * Decodes a base64url string to Uint8Array.
 */
export function base64UrlToUint8Array(base64url: string): Uint8Array {
  if (typeof base64url !== 'string') {
    throw new TypeError('Input must be a base64url string')
  }
  let base64 = base64url.replace(/-/g, '+').replace(/_/g, '/')
  const mod4 = base64.length % 4
  if (mod4 === 2) {
    base64 += '=='
  } else if (mod4 === 3) {
    base64 += '='
  } else if (mod4 === 1) {
    throw new Error('Invalid base64url string length')
  }

  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i)
  }
  return bytes
}
