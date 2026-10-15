// =============================================================================
// D.I.C.E. Cryptographic Engine (Web Crypto API + Ed25519)
// Location: supabase/functions/_shared/crypto.ts
//
// Pure Web Standards Ed25519 cryptographic signing and verification utilities.
// Zero external dependencies; 100% compatible with Deno/Supabase and Node.js.
//
// Formats:
// - Public Key: Raw 32-byte Ed25519 key (RFC 8032) -> base64url encoded
// - Private Key: PKCS#8 DER 48-byte key (RFC 8410) -> base64url encoded
// - Signature: Raw 64-byte Ed25519 signature (RFC 8032) -> base64url encoded
// =============================================================================

import {
  base64UrlToUint8Array,
  canonicalizeCredentialToBytes,
  uint8ArrayToBase64Url,
} from './canonicalize.ts'
import type {
  StudentCredential,
  UnsignedStudentCredential,
} from './types.ts'

const ED25519_ALGORITHM = { name: 'Ed25519' }

/**
 * Generates an ephemeral in-memory Ed25519 key pair using the Web Crypto API.
 */
export async function generateEd25519KeyPair(): Promise<CryptoKeyPair> {
  return (await crypto.subtle.generateKey(
    ED25519_ALGORITHM,
    true,
    ['sign', 'verify']
  )) as CryptoKeyPair
}

/**
 * Exports a public CryptoKey to raw 32-byte Ed25519 public key.
 */
export async function exportPublicKeyRaw(publicKey: CryptoKey): Promise<Uint8Array> {
  if (publicKey.type !== 'public' || publicKey.algorithm.name !== 'Ed25519') {
    throw new TypeError('Invalid key: expected Ed25519 public CryptoKey')
  }
  const buffer = await crypto.subtle.exportKey('raw', publicKey)
  return new Uint8Array(buffer)
}

/**
 * Exports a public CryptoKey to base64url-encoded string (for storage in issuers.public_key).
 */
export async function exportPublicKeyToBase64Url(publicKey: CryptoKey): Promise<string> {
  const bytes = await exportPublicKeyRaw(publicKey)
  return uint8ArrayToBase64Url(bytes)
}

/**
 * Imports an Ed25519 public CryptoKey from raw 32 bytes.
 */
export async function importPublicKeyRaw(bytes: Uint8Array): Promise<CryptoKey> {
  if (!bytes || bytes.byteLength !== 32) {
    throw new TypeError(`Invalid Ed25519 public key: expected 32 bytes, received ${bytes?.byteLength ?? 0}`)
  }
  return await crypto.subtle.importKey(
    'raw',
    bytes,
    ED25519_ALGORITHM,
    true,
    ['verify']
  )
}

/**
 * Imports an Ed25519 public CryptoKey from a base64url-encoded string.
 */
export async function importPublicKeyFromBase64Url(base64url: string): Promise<CryptoKey> {
  const bytes = base64UrlToUint8Array(base64url)
  return await importPublicKeyRaw(bytes)
}

/**
 * Exports a private CryptoKey to PKCS#8 DER bytes.
 */
export async function exportPrivateKeyPkcs8(privateKey: CryptoKey): Promise<Uint8Array> {
  if (privateKey.type !== 'private' || privateKey.algorithm.name !== 'Ed25519') {
    throw new TypeError('Invalid key: expected Ed25519 private CryptoKey')
  }
  const buffer = await crypto.subtle.exportKey('pkcs8', privateKey)
  return new Uint8Array(buffer)
}

/**
 * Exports a private CryptoKey to base64url-encoded PKCS#8 string.
 */
export async function exportPrivateKeyToBase64Url(privateKey: CryptoKey): Promise<string> {
  const bytes = await exportPrivateKeyPkcs8(privateKey)
  return uint8ArrayToBase64Url(bytes)
}

/**
 * Imports an Ed25519 private CryptoKey from PKCS#8 DER bytes.
 */
export async function importPrivateKeyPkcs8(bytes: Uint8Array): Promise<CryptoKey> {
  if (!bytes || bytes.byteLength === 0) {
    throw new TypeError('Invalid Ed25519 private key: empty byte array')
  }
  return await crypto.subtle.importKey(
    'pkcs8',
    bytes,
    ED25519_ALGORITHM,
    true,
    ['sign']
  )
}

/**
 * Imports an Ed25519 private CryptoKey from a base64url-encoded PKCS#8 string.
 */
export async function importPrivateKeyFromBase64Url(base64url: string): Promise<CryptoKey> {
  const bytes = base64UrlToUint8Array(base64url)
  return await importPrivateKeyPkcs8(bytes)
}

/**
 * Signs canonical credential bytes using an Ed25519 private key.
 * Returns raw 64-byte digital signature.
 */
export async function signCanonicalBytes(
  unsignedBytes: Uint8Array,
  privateKey: CryptoKey
): Promise<Uint8Array> {
  if (!unsignedBytes || unsignedBytes.byteLength === 0) {
    throw new TypeError('unsignedBytes cannot be empty')
  }
  const sigBuffer = await crypto.subtle.sign(
    ED25519_ALGORITHM,
    privateKey,
    unsignedBytes
  )
  return new Uint8Array(sigBuffer)
}

/**
 * Signs canonical credential bytes and returns the signature encoded as base64url.
 */
export async function signCanonicalBytesToBase64Url(
  unsignedBytes: Uint8Array,
  privateKey: CryptoKey
): Promise<string> {
  const sigBytes = await signCanonicalBytes(unsignedBytes, privateKey)
  return uint8ArrayToBase64Url(sigBytes)
}

/**
 * Verifies an Ed25519 signature against canonical bytes and an active public key.
 */
export async function verifySignature(
  signature: Uint8Array,
  unsignedBytes: Uint8Array,
  publicKey: CryptoKey
): Promise<boolean> {
  if (!signature || signature.byteLength !== 64) {
    return false
  }
  if (!unsignedBytes || unsignedBytes.byteLength === 0) {
    return false
  }
  try {
    return await crypto.subtle.verify(
      ED25519_ALGORITHM,
      publicKey,
      signature,
      unsignedBytes
    )
  } catch {
    return false
  }
}

/**
 * Verifies a base64url-encoded Ed25519 signature against canonical bytes.
 */
export async function verifyBase64UrlSignature(
  signatureBase64Url: string,
  unsignedBytes: Uint8Array,
  publicKey: CryptoKey
): Promise<boolean> {
  try {
    const signatureBytes = base64UrlToUint8Array(signatureBase64Url)
    return await verifySignature(signatureBytes, unsignedBytes, publicKey)
  } catch {
    return false
  }
}

const KEY_CHALLENGE_BYTES = new TextEncoder().encode('D.I.C.E. Key Correspondence Challenge v1')

/**
 * Proves that an Ed25519 private key corresponds to an Ed25519 public key
 * using an internal fixed challenge signature and verification.
 * Never logs or exposes key material or signature bytes.
 */
export async function verifyKeyCorrespondence(
  privateKey: CryptoKey,
  publicKey: CryptoKey
): Promise<boolean> {
  if (!privateKey || privateKey.type !== 'private' || privateKey.algorithm.name !== 'Ed25519') {
    return false
  }
  if (!publicKey || publicKey.type !== 'public' || publicKey.algorithm.name !== 'Ed25519') {
    return false
  }
  try {
    const challengeSig = await signCanonicalBytes(KEY_CHALLENGE_BYTES, privateKey)
    return await verifySignature(challengeSig, KEY_CHALLENGE_BYTES, publicKey)
  } catch {
    return false
  }
}

/**
 * Signs an unsigned credential payload and attaches the Ed25519 proof object.
 */
export async function signCredential(
  unsignedPayload: UnsignedStudentCredential,
  privateKey: CryptoKey,
  keyId: string
): Promise<StudentCredential> {
  if (!keyId || typeof keyId !== 'string') {
    throw new TypeError('keyId must be a non-empty string')
  }
  const canonicalBytes = canonicalizeCredentialToBytes(unsignedPayload)
  const signatureBase64Url = await signCanonicalBytesToBase64Url(canonicalBytes, privateKey)

  return {
    ...unsignedPayload,
    proof: {
      type: 'Ed25519Signature',
      keyId,
      signature: signatureBase64Url,
    },
  }
}

/**
 * Verifies a complete student credential's digital signature against the issuer's public key.
 */
export async function verifyCredentialSignature(
  credential: StudentCredential,
  publicKey: CryptoKey
): Promise<boolean> {
  if (!credential || typeof credential !== 'object') {
    return false
  }
  if (!credential.proof || credential.proof.type !== 'Ed25519Signature') {
    return false
  }
  if (typeof credential.proof.signature !== 'string') {
    return false
  }

  try {
    const canonicalBytes = canonicalizeCredentialToBytes(credential)
    return await verifyBase64UrlSignature(
      credential.proof.signature,
      canonicalBytes,
      publicKey
    )
  } catch {
    return false
  }
}
