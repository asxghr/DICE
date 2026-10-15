import QRCode from 'qrcode'
import jsQR from 'jsqr'
import type { AnyStudentCredential } from '../../types'

export const DICE_QR_PREFIX = 'dice:credential:v1:'
export const MAX_QR_PAYLOAD_LENGTH = 16384 // 16 KB upper safety limit

export type QrDecodeErrorCode =
  | 'EMPTY_PAYLOAD'
  | 'OVERSIZED_PAYLOAD'
  | 'UNSUPPORTED_VERSION'
  | 'MALFORMED_FORMAT'
  | 'MALFORMED_BASE64'
  | 'MALFORMED_JSON'
  | 'INVALID_CREDENTIAL_SHAPE'

export interface QrDecodeError {
  code: QrDecodeErrorCode
  message: string
}

export type DecodeQrResult =
  | {
      success: true
      credential: AnyStudentCredential
      rawJson: string
      version: 'v1' | 'json'
    }
  | {
      success: false
      error: QrDecodeError
    }

/**
 * Universal UTF-8 aware Base64URL encoder.
 * Works seamlessly in Browser (using TextEncoder & btoa) and Node.js.
 */
export function base64UrlEncode(input: string): string {
  const bytes = new TextEncoder().encode(input)
  let base64: string
  if (typeof Buffer !== 'undefined') {
    base64 = Buffer.from(bytes).toString('base64')
  } else {
    let binary = ''
    for (let i = 0; i < bytes.length; i++) {
      binary += String.fromCharCode(bytes[i])
    }
    base64 = btoa(binary)
  }
  return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

/**
 * Universal UTF-8 aware Base64URL decoder.
 * Works seamlessly in Browser (using atob & TextDecoder) and Node.js.
 */
export function base64UrlDecode(base64Url: string): string {
  let base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/')
  while (base64.length % 4 !== 0) {
    base64 += '='
  }
  let bytes: Uint8Array
  if (typeof Buffer !== 'undefined') {
    bytes = Buffer.from(base64, 'base64')
  } else {
    const binary = atob(base64)
    bytes = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i)
    }
  }
  return new TextDecoder().decode(bytes)
}

/**
 * Validates the structural shape of a candidate credential object.
 * Confirms that required fields for D.I.C.E. verification are present.
 */
export function validateCredentialShape(data: unknown): {
  valid: true
  credential: AnyStudentCredential
} | {
  valid: false
  error: string
} {
  if (!data || typeof data !== 'object') {
    return { valid: false, error: 'Credential payload must be a non-null object.' }
  }

  const obj = data as Record<string, unknown>

  if (typeof obj.id !== 'string' || !obj.id.trim()) {
    return { valid: false, error: 'Missing or empty credential "id" field.' }
  }

  if (obj.type !== 'StudentCredential') {
    return { valid: false, error: 'Credential "type" must be "StudentCredential".' }
  }

  if (typeof obj.issuerId !== 'string' || !obj.issuerId.trim()) {
    return { valid: false, error: 'Missing or empty "issuerId" field.' }
  }

  if (!obj.subject || typeof obj.subject !== 'object') {
    return { valid: false, error: 'Missing or invalid "subject" object.' }
  }
  const subject = obj.subject as Record<string, unknown>
  if (typeof subject.id !== 'string' || !subject.id.trim()) {
    return { valid: false, error: 'Missing or empty "subject.id" field.' }
  }

  if (!obj.claims || typeof obj.claims !== 'object') {
    return { valid: false, error: 'Missing or invalid "claims" object.' }
  }
  const claims = obj.claims as Record<string, unknown>
  if (claims.studentStatus !== 'active' && claims.studentStatus !== 'inactive') {
    return { valid: false, error: '"claims.studentStatus" must be either "active" or "inactive".' }
  }

  if (typeof obj.issuedAt !== 'string' || !obj.issuedAt.trim()) {
    return { valid: false, error: 'Missing or empty "issuedAt" timestamp.' }
  }

  if (typeof obj.expiresAt !== 'string' || !obj.expiresAt.trim()) {
    return { valid: false, error: 'Missing or empty "expiresAt" timestamp.' }
  }

  if (!obj.proof || typeof obj.proof !== 'object') {
    return { valid: false, error: 'Missing or invalid "proof" object.' }
  }
  const proof = obj.proof as Record<string, unknown>
  if (proof.type !== 'Ed25519Signature' && proof.type !== 'DemoSimulationProof') {
    return {
      valid: false,
      error: 'Proof type must be "Ed25519Signature" or "DemoSimulationProof".',
    }
  }

  if (typeof proof.keyId !== 'string' || !proof.keyId.trim()) {
    return { valid: false, error: 'Missing or empty "proof.keyId".' }
  }

  if (typeof proof.signature !== 'string' || !proof.signature.trim()) {
    return { valid: false, error: 'Missing or empty "proof.signature".' }
  }

  return { valid: true, credential: data as AnyStudentCredential }
}

/**
 * Encodes a complete signed credential payload into a versioned QR code string.
 * Format: `dice:credential:v1:<base64url(JSON)>`
 */
export function encodeCredentialToQr(credential: AnyStudentCredential): string {
  const json = JSON.stringify(credential)
  const encoded = base64UrlEncode(json)
  return `${DICE_QR_PREFIX}${encoded}`
}

/**
 * Decodes and validates a QR payload (or raw JSON fallback string).
 * Handles version detection, base64url decoding, JSON parsing, and schema validation.
 */
export function decodeCredentialFromQr(input: string): DecodeQrResult {
  if (!input || typeof input !== 'string' || !input.trim()) {
    return {
      success: false,
      error: {
        code: 'EMPTY_PAYLOAD',
        message: 'The presented QR code payload is empty.',
      },
    }
  }

  const trimmed = input.trim()

  if (trimmed.length > MAX_QR_PAYLOAD_LENGTH) {
    return {
      success: false,
      error: {
        code: 'OVERSIZED_PAYLOAD',
        message: `Payload exceeds safety limit (${trimmed.length} > ${MAX_QR_PAYLOAD_LENGTH} bytes).`,
      },
    }
  }

  // Case 1: Standard versioned D.I.C.E. URI prefix
  if (trimmed.startsWith('dice:credential:')) {
    if (!trimmed.startsWith(DICE_QR_PREFIX)) {
      // Version mismatch or unrecognized version tag
      const match = trimmed.match(/^dice:credential:([^:]+):/)
      const versionTag = match ? match[1] : 'unknown'
      return {
        success: false,
        error: {
          code: 'UNSUPPORTED_VERSION',
          message: `Unsupported credential presentation version "${versionTag}". Expected "${DICE_QR_PREFIX}".`,
        },
      }
    }

    const base64Part = trimmed.slice(DICE_QR_PREFIX.length).trim()
    if (!base64Part) {
      return {
        success: false,
        error: {
          code: 'EMPTY_PAYLOAD',
          message: 'The QR code contains a D.I.C.E. prefix but no payload data.',
        },
      }
    }

    let jsonString: string
    try {
      jsonString = base64UrlDecode(base64Part)
    } catch (err) {
      return {
        success: false,
        error: {
          code: 'MALFORMED_BASE64',
          message: `Unable to decode Base64URL payload: ${err instanceof Error ? err.message : 'Invalid characters'}.`,
        },
      }
    }

    let parsed: unknown
    try {
      parsed = JSON.parse(jsonString)
    } catch (err) {
      return {
        success: false,
        error: {
          code: 'MALFORMED_JSON',
          message: `QR payload is not valid JSON: ${err instanceof Error ? err.message : 'Syntax error'}.`,
        },
      }
    }

    const validation = validateCredentialShape(parsed)
    if (!validation.valid) {
      return {
        success: false,
        error: {
          code: 'INVALID_CREDENTIAL_SHAPE',
          message: `Invalid credential structure: ${validation.error}`,
        },
      }
    }

    return {
      success: true,
      credential: validation.credential,
      rawJson: jsonString,
      version: 'v1',
    }
  }

  // Case 2: Direct JSON payload (fallback paste or non-prefixed QR)
  if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
    let parsed: unknown
    try {
      parsed = JSON.parse(trimmed)
    } catch (err) {
      return {
        success: false,
        error: {
          code: 'MALFORMED_JSON',
          message: `Pasted string is not valid JSON: ${err instanceof Error ? err.message : 'Syntax error'}.`,
        },
      }
    }

    const validation = validateCredentialShape(parsed)
    if (!validation.valid) {
      return {
        success: false,
        error: {
          code: 'INVALID_CREDENTIAL_SHAPE',
          message: `Pasted JSON is not a valid credential: ${validation.error}`,
        },
      }
    }

    return {
      success: true,
      credential: validation.credential,
      rawJson: trimmed,
      version: 'json',
    }
  }

  // Case 3: Unrecognized format
  return {
    success: false,
    error: {
      code: 'MALFORMED_FORMAT',
      message:
        'Unrecognized QR payload format. Expected "dice:credential:v1:<base64>" or valid credential JSON.',
    },
  }
}

/**
 * Generates a high-contrast Data URL image for a credential QR presentation.
 */
export async function generateCredentialQrDataUrl(
  credential: AnyStudentCredential,
  options?: { width?: number }
): Promise<string> {
  const qrText = encodeCredentialToQr(credential)
  return QRCode.toDataURL(qrText, {
    width: options?.width || 320,
    margin: 2,
    errorCorrectionLevel: 'M',
    color: {
      dark: '#1C201D', // Primary academic dark ink
      light: '#FAF8F5', // Warm paper canvas background
    },
  })
}

/**
 * Decodes a QR code directly from raw RGBA pixel data using jsQR.
 */
export function decodeQrFromImageData(
  data: Uint8ClampedArray,
  width: number,
  height: number
): string | null {
  const result = jsQR(data, width, height, {
    inversionAttempts: 'dontInvert',
  })
  return result ? result.data : null
}
