import test from 'node:test'
import assert from 'node:assert/strict'
import {
  generateEd25519KeyPair,
  exportPublicKeyToBase64Url,
  importPublicKeyFromBase64Url,
  exportPrivateKeyToBase64Url,
  importPrivateKeyFromBase64Url,
  exportPrivateKeyPkcs8,
  importPrivateKeyPkcs8,
  signCanonicalBytes,
  signCanonicalBytesToBase64Url,
  verifySignature,
  verifyBase64UrlSignature,
  signCredential,
  verifyCredentialSignature,
  verifyKeyCorrespondence,
} from './crypto.ts'
import { canonicalizeCredentialToBytes } from './canonicalize.ts'
import type { StudentCredential, UnsignedStudentCredential } from './types.ts'

const sampleUnsigned: UnsignedStudentCredential = {
  id: 'urn:uuid:12345678-1234-1234-1234-123456789abc',
  type: 'StudentCredential',
  issuerId: 'institution-stanford-01',
  subject: {
    id: 'student-id-456',
  },
  claims: {
    studentStatus: 'active',
  },
  issuedAt: '2026-10-15T18:00:00.000Z',
  expiresAt: '2027-10-15T18:00:00.000Z',
}

test('1. Generates ephemeral Ed25519 key pair with valid algorithm metadata', async () => {
  const keyPair = await generateEd25519KeyPair()

  assert.strictEqual(keyPair.publicKey.algorithm.name, 'Ed25519')
  assert.strictEqual(keyPair.privateKey.algorithm.name, 'Ed25519')
  assert.strictEqual(keyPair.publicKey.type, 'public')
  assert.strictEqual(keyPair.privateKey.type, 'private')
})

test('2. Public and private keys export and import cleanly via base64url format', async () => {
  const keyPair = await generateEd25519KeyPair()

  // Export public key to base64url and re-import
  const pubBase64Url = await exportPublicKeyToBase64Url(keyPair.publicKey)
  assert.strictEqual(typeof pubBase64Url, 'string')
  assert.strictEqual(pubBase64Url.length > 0, true)
  const importedPub = await importPublicKeyFromBase64Url(pubBase64Url)
  assert.strictEqual(importedPub.algorithm.name, 'Ed25519')

  // Export private key to base64url and re-import (PKCS#8)
  const privBase64Url = await exportPrivateKeyToBase64Url(keyPair.privateKey)
  assert.strictEqual(typeof privBase64Url, 'string')
  assert.strictEqual(privBase64Url.length > 0, true)
  const importedPriv = await importPrivateKeyFromBase64Url(privBase64Url)
  assert.strictEqual(importedPriv.algorithm.name, 'Ed25519')
  assert.strictEqual(importedPriv.extractable, false)

  // Verify functional equivalence with imported keys
  const message = new TextEncoder().encode('Test verification message')
  const sig = await signCanonicalBytes(message, importedPriv)
  const valid = await verifySignature(sig, message, importedPub)
  assert.strictEqual(valid, true)

  const sigBase64Url = await signCanonicalBytesToBase64Url(message, importedPriv)
  const validBase64Url = await verifyBase64UrlSignature(sigBase64Url, message, importedPub)
  assert.strictEqual(validBase64Url, true)
})

test('3. Signs and verifies canonical credential correctly', async () => {
  const keyPair = await generateEd25519KeyPair()
  const keyId = 'stanford-key-2026'

  const signedCredential = await signCredential(sampleUnsigned, keyPair.privateKey, keyId)

  assert.strictEqual(signedCredential.proof.type, 'Ed25519Signature')
  assert.strictEqual(signedCredential.proof.keyId, keyId)
  assert.strictEqual(typeof signedCredential.proof.signature, 'string')

  const isValid = await verifyCredentialSignature(signedCredential, keyPair.publicKey)
  assert.strictEqual(isValid, true)
})

test('4. Verification FAILS when payload changes (tampered credential)', async () => {
  const keyPair = await generateEd25519KeyPair()
  const keyId = 'stanford-key-2026'

  const signedCredential = await signCredential(sampleUnsigned, keyPair.privateKey, keyId)

  // Tamper with claims: active -> inactive
  const tamperedClaims: StudentCredential = {
    ...signedCredential,
    claims: { studentStatus: 'inactive' },
  }
  const isClaimsValid = await verifyCredentialSignature(tamperedClaims, keyPair.publicKey)
  assert.strictEqual(isClaimsValid, false, 'Tampered claims must fail verification')

  // Tamper with subject
  const tamperedSubject: StudentCredential = {
    ...signedCredential,
    subject: { id: 'impostor-student-999' },
  }
  const isSubjectValid = await verifyCredentialSignature(tamperedSubject, keyPair.publicKey)
  assert.strictEqual(isSubjectValid, false, 'Tampered subject must fail verification')

  // Tamper with expiration date
  const tamperedExpiry: StudentCredential = {
    ...signedCredential,
    expiresAt: '2029-10-15T18:00:00.000Z',
  }
  const isExpiryValid = await verifyCredentialSignature(tamperedExpiry, keyPair.publicKey)
  assert.strictEqual(isExpiryValid, false, 'Tampered expiration must fail verification')
})

test('5. Verification FAILS when signature is modified or corrupted', async () => {
  const keyPair = await generateEd25519KeyPair()
  const keyId = 'stanford-key-2026'

  const signedCredential = await signCredential(sampleUnsigned, keyPair.privateKey, keyId)

  // Corrupt a character in the base64url signature
  const originalSig = signedCredential.proof.signature
  const corruptedChar = originalSig[0] === 'A' ? 'B' : 'A'
  const corruptedSig = corruptedChar + originalSig.slice(1)

  const tamperedSignature: StudentCredential = {
    ...signedCredential,
    proof: {
      ...signedCredential.proof,
      signature: corruptedSig,
    },
  }

  const isValid = await verifyCredentialSignature(tamperedSignature, keyPair.publicKey)
  assert.strictEqual(isValid, false, 'Corrupted signature must fail verification')
})

test('6. Verification FAILS when wrong public key is used', async () => {
  const legitimateIssuerKeyPair = await generateEd25519KeyPair()
  const unrelatedThirdPartyKeyPair = await generateEd25519KeyPair()
  const keyId = 'stanford-key-2026'

  // Signed by legitimate issuer
  const signedCredential = await signCredential(
    sampleUnsigned,
    legitimateIssuerKeyPair.privateKey,
    keyId
  )

  // Verified against unrelated public key
  const isValid = await verifyCredentialSignature(
    signedCredential,
    unrelatedThirdPartyKeyPair.publicKey
  )
  assert.strictEqual(isValid, false, 'Wrong public key must fail verification')
})

test('7. verifyBase64UrlSignature gracefully handles malformed inputs without throwing', async () => {
  const keyPair = await generateEd25519KeyPair()
  const canonicalBytes = canonicalizeCredentialToBytes(sampleUnsigned)

  // Malformed signature strings
  assert.strictEqual(
    await verifyBase64UrlSignature('not-valid-base64!', canonicalBytes, keyPair.publicKey),
    false
  )
  assert.strictEqual(
    await verifyBase64UrlSignature('', canonicalBytes, keyPair.publicKey),
    false
  )
  assert.strictEqual(
    await verifyBase64UrlSignature('dG9vLXNob3J0', canonicalBytes, keyPair.publicKey),
    false
  )
})

test('8. verifyKeyCorrespondence correctly proves key pair correspondence', async () => {
  const keyPairA = await generateEd25519KeyPair()
  const keyPairB = await generateEd25519KeyPair()

  // 1. Matching private and public keys must return true
  const isMatch = await verifyKeyCorrespondence(keyPairA.privateKey, keyPairA.publicKey)
  assert.strictEqual(isMatch, true, 'Matching keypair must verify successfully')

  // 2. Mismatched private key A and public key B must return false
  const isMismatch = await verifyKeyCorrespondence(keyPairA.privateKey, keyPairB.publicKey)
  assert.strictEqual(isMismatch, false, 'Mismatched keypair must fail verification')

  // 3. Invalid or wrong key types gracefully return false without throwing
  const wrongType = await verifyKeyCorrespondence(
    keyPairA.publicKey as unknown as CryptoKey,
    keyPairA.publicKey
  )
  assert.strictEqual(wrongType, false)
})

test('9. Server-imported Ed25519 private keys are non-extractable, can sign, and fail export', async () => {
  const keyPair = await generateEd25519KeyPair()
  assert.strictEqual(keyPair.privateKey.extractable, true, 'Ephemeral generated key should remain extractable')

  const privBase64Url = await exportPrivateKeyToBase64Url(keyPair.privateKey)
  const privPkcs8Bytes = await exportPrivateKeyPkcs8(keyPair.privateKey)

  // 1. Prove imported private key from base64url has extractable === false
  const importedPrivB64 = await importPrivateKeyFromBase64Url(privBase64Url)
  assert.strictEqual(importedPrivB64.extractable, false, 'Imported private key from base64url must have extractable === false')
  assert.strictEqual(importedPrivB64.type, 'private')
  assert.strictEqual(importedPrivB64.algorithm.name, 'Ed25519')

  // 2. Prove imported private key from raw PKCS#8 bytes has extractable === false
  const importedPrivBytes = await importPrivateKeyPkcs8(privPkcs8Bytes)
  assert.strictEqual(importedPrivBytes.extractable, false, 'Imported private key from PKCS#8 bytes must have extractable === false')
  assert.strictEqual(importedPrivBytes.type, 'private')
  assert.strictEqual(importedPrivBytes.algorithm.name, 'Ed25519')

  // 3. Prove non-extractable imported key can still sign successfully
  const testMessage = new TextEncoder().encode('Non-extractable key test payload')

  const sigB64 = await signCanonicalBytes(testMessage, importedPrivB64)
  assert.strictEqual(sigB64.byteLength, 64)
  const isValidB64 = await verifySignature(sigB64, testMessage, keyPair.publicKey)
  assert.strictEqual(isValidB64, true, 'Signature produced by base64url-imported key must verify')

  const sigBytes = await signCanonicalBytes(testMessage, importedPrivBytes)
  assert.strictEqual(sigBytes.byteLength, 64)
  const isValidBytes = await verifySignature(sigBytes, testMessage, keyPair.publicKey)
  assert.strictEqual(isValidBytes, true, 'Signature produced by bytes-imported key must verify')

  // 4. Prove signCredential and verifyCredentialSignature work with non-extractable key
  const signedCred = await signCredential(sampleUnsigned, importedPrivB64, 'server-signing-key-01')
  assert.strictEqual(typeof signedCred.proof.signature, 'string')
  const isCredValid = await verifyCredentialSignature(signedCred, keyPair.publicKey)
  assert.strictEqual(isCredValid, true, 'Credential signed by non-extractable key must verify')

  // 5. Prove verifyKeyCorrespondence works with non-extractable key
  const isConsistent = await verifyKeyCorrespondence(importedPrivB64, keyPair.publicKey)
  assert.strictEqual(isConsistent, true, 'verifyKeyCorrespondence must succeed with non-extractable key')

  // 6. Prove exporting fails
  // 6a. exportPrivateKeyPkcs8 fails with InvalidAccessError
  await assert.rejects(
    async () => {
      await exportPrivateKeyPkcs8(importedPrivB64)
    },
    (err: unknown) => {
      assert.ok(err instanceof Error)
      assert.strictEqual((err as { name: string }).name, 'InvalidAccessError')
      return true
    },
    'exportPrivateKeyPkcs8 must fail when key is non-extractable'
  )

  // 6b. exportPrivateKeyToBase64Url fails with InvalidAccessError
  await assert.rejects(
    async () => {
      await exportPrivateKeyToBase64Url(importedPrivB64)
    },
    (err: unknown) => {
      assert.ok(err instanceof Error)
      assert.strictEqual((err as { name: string }).name, 'InvalidAccessError')
      return true
    },
    'exportPrivateKeyToBase64Url must fail when key is non-extractable'
  )

  // 6c. Web Crypto subtle.exportKey directly fails with InvalidAccessError
  await assert.rejects(
    async () => {
      await crypto.subtle.exportKey('pkcs8', importedPrivB64)
    },
    (err: unknown) => {
      assert.ok(err instanceof Error)
      assert.strictEqual((err as { name: string }).name, 'InvalidAccessError')
      return true
    },
    'crypto.subtle.exportKey must fail when key is non-extractable'
  )

  // 6d. Direct export of bytes-imported key also fails
  await assert.rejects(
    async () => {
      await exportPrivateKeyPkcs8(importedPrivBytes)
    },
    (err: unknown) => {
      assert.ok(err instanceof Error)
      assert.strictEqual((err as { name: string }).name, 'InvalidAccessError')
      return true
    },
    'exportPrivateKeyPkcs8 must fail for key imported from PKCS#8 bytes'
  )
})
