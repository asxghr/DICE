import test from 'node:test'
import assert from 'node:assert/strict'
import {
  canonicalizeCredentialToBytes,
  canonicalizeCredentialToUtf8,
  canonicalizeValue,
  toUnsignedPayload,
  uint8ArrayToBase64Url,
  base64UrlToUint8Array,
  canonicalBytesToUtf8,
  isIsoUtcTimestamp,
} from './canonicalize.ts'
import type { StudentCredential, UnsignedStudentCredential } from './types.ts'

const sampleUnsignedCredential: UnsignedStudentCredential = {
  id: 'urn:uuid:f81d4fae-7dec-11d0-a765-00a0c91e6bf6',
  type: 'StudentCredential',
  issuerId: 'univ-mit-01',
  subject: {
    id: 'student-98765',
  },
  claims: {
    studentStatus: 'active',
  },
  issuedAt: '2026-10-15T18:00:00.000Z',
  expiresAt: '2027-10-15T18:00:00.000Z',
}

test('1. The same payload always produces identical canonical bytes', () => {
  const bytes1 = canonicalizeCredentialToBytes(sampleUnsignedCredential)
  const bytes2 = canonicalizeCredentialToBytes(sampleUnsignedCredential)
  const utf8 = canonicalizeCredentialToUtf8(sampleUnsignedCredential)

  assert.deepStrictEqual(bytes1, bytes2)
  assert.strictEqual(canonicalBytesToUtf8(bytes1), canonicalBytesToUtf8(bytes2))
  assert.strictEqual(canonicalBytesToUtf8(bytes1), utf8)
})

test('2. Different object key insertion orders produce identical canonical bytes', () => {
  const scrambled = JSON.parse(
    JSON.stringify({
      expiresAt: '2027-10-15T18:00:00.000Z',
      type: 'StudentCredential',
      subject: {
        id: 'student-98765',
      },
      issuerId: 'univ-mit-01',
      id: 'urn:uuid:f81d4fae-7dec-11d0-a765-00a0c91e6bf6',
      issuedAt: '2026-10-15T18:00:00.000Z',
      claims: {
        studentStatus: 'active',
      },
    })
  )

  const bytesStandard = canonicalizeCredentialToBytes(sampleUnsignedCredential)
  const bytesScrambled = canonicalizeCredentialToBytes(scrambled)

  assert.deepStrictEqual(bytesStandard, bytesScrambled)

  // Verify deterministic lexicographical order of root keys:
  // claims, expiresAt, id, issuedAt, issuerId, subject, type
  const utf8 = canonicalBytesToUtf8(bytesStandard)
  const expectedKeyOrder = [
    '"claims"',
    '"expiresAt"',
    '"id"',
    '"issuedAt"',
    '"issuerId"',
    '"subject"',
    '"type"',
  ]
  let lastIndex = -1
  for (const key of expectedKeyOrder) {
    const idx = utf8.indexOf(key)
    assert.ok(idx > lastIndex, `Key ${key} should appear in sorted order`)
    lastIndex = idx
  }
})

test('3. Changing studentStatus changes the canonical bytes', () => {
  const activePayload = { ...sampleUnsignedCredential }
  const inactivePayload: UnsignedStudentCredential = {
    ...sampleUnsignedCredential,
    claims: { studentStatus: 'inactive' },
  }

  const bytesActive = canonicalizeCredentialToBytes(activePayload)
  const bytesInactive = canonicalizeCredentialToBytes(inactivePayload)

  assert.notDeepStrictEqual(bytesActive, bytesInactive)
  assert.notStrictEqual(
    canonicalBytesToUtf8(bytesActive),
    canonicalBytesToUtf8(bytesInactive)
  )
})

test('4. Changing expiresAt changes the canonical bytes', () => {
  const payload1 = { ...sampleUnsignedCredential }
  const payload2: UnsignedStudentCredential = {
    ...sampleUnsignedCredential,
    expiresAt: '2028-10-15T18:00:00.000Z',
  }

  const bytes1 = canonicalizeCredentialToBytes(payload1)
  const bytes2 = canonicalizeCredentialToBytes(payload2)

  assert.notDeepStrictEqual(bytes1, bytes2)
  assert.notStrictEqual(canonicalBytesToUtf8(bytes1), canonicalBytesToUtf8(bytes2))
})

test('5. Proof exclusion occurs explicitly via toUnsignedPayload and never in generic canonicalizeValue', () => {
  const signedCredential: StudentCredential = {
    ...sampleUnsignedCredential,
    proof: {
      type: 'Ed25519Signature',
      keyId: 'univ-mit-key-01',
      signature: 'dGhpcy1pcy1hLW1vY2stc2lnbmF0dXJlLXZhbHVl',
    },
  }

  // 1. Generic canonicalizeValue must NOT remove 'proof'
  const genericOutput = canonicalizeValue(signedCredential)
  assert.ok(genericOutput.includes('"proof"'), 'Generic canonicalizeValue must preserve proof field')
  assert.ok(genericOutput.includes('"dGhpcy1pcy1hLW1vY2stc2lnbmF0dXJlLXZhbHVl"'), 'Generic canonicalizeValue must preserve signature')

  // 2. toUnsignedPayload and canonicalizeCredentialToBytes explicitly exclude proof
  const unsigned = toUnsignedPayload(signedCredential)
  assert.strictEqual('proof' in unsigned, false, 'toUnsignedPayload must strictly omit proof')

  const bytesFromUnsigned = canonicalizeCredentialToBytes(sampleUnsignedCredential)
  const bytesFromSigned = canonicalizeCredentialToBytes(signedCredential)

  assert.deepStrictEqual(bytesFromUnsigned, bytesFromSigned)

  const utf8 = canonicalBytesToUtf8(bytesFromSigned)
  assert.strictEqual(utf8.includes('proof'), false)
  assert.strictEqual(utf8.includes('Ed25519Signature'), false)
  assert.strictEqual(utf8.includes('dGhpcy1pcy1hLW1vY2stc2lnbmF0dXJlLXZhbHVl'), false)
})

test('6. Base64url encoding and decoding round-trip correctly', () => {
  const testCases = [
    new Uint8Array([]), // empty
    new Uint8Array([0, 1, 2, 3]), // mod 4 == 0
    new Uint8Array([42]), // 1 byte
    new Uint8Array([255, 254]), // 2 bytes
    new Uint8Array([10, 20, 30]), // 3 bytes
    new TextEncoder().encode('Hello, D.I.C.E. Decentralized Identity!'),
    new Uint8Array([251, 255, 254, 253, 252, 251]), // values requiring url-safe characters - and _
  ]

  for (const originalBytes of testCases) {
    const encoded = uint8ArrayToBase64Url(originalBytes)
    assert.strictEqual(encoded.includes('+'), false)
    assert.strictEqual(encoded.includes('/'), false)
    assert.strictEqual(encoded.includes('='), false)

    const decoded = base64UrlToUint8Array(encoded)
    assert.deepStrictEqual(decoded, originalBytes)
  }
})

test('7. Timestamps must strictly end in Z; +00:00, other offsets, and invalid dates are rejected', () => {
  // Reject +00:00 offset
  assert.throws(
    () =>
      canonicalizeCredentialToBytes({
        ...sampleUnsignedCredential,
        issuedAt: '2026-10-15T18:00:00+00:00',
      }),
    /ending in 'Z'/
  )

  // Reject +05:30 offset
  assert.throws(
    () =>
      canonicalizeCredentialToBytes({
        ...sampleUnsignedCredential,
        issuedAt: '2026-10-15T18:00:00+05:30',
      }),
    /ending in 'Z'/
  )

  // Reject local time without timezone
  assert.throws(
    () =>
      canonicalizeCredentialToBytes({
        ...sampleUnsignedCredential,
        expiresAt: '2027-10-15 18:00:00',
      }),
    /ending in 'Z'/
  )

  // Reject invalid date string
  assert.throws(
    () =>
      canonicalizeCredentialToBytes({
        ...sampleUnsignedCredential,
        expiresAt: '2027-99-99T99:99:99Z',
      }),
    /ending in 'Z'/
  )
})

test('8. isIsoUtcTimestamp validator behaves strictly for Z-only timestamps', () => {
  assert.strictEqual(isIsoUtcTimestamp('2026-10-15T18:00:00.000Z'), true)
  assert.strictEqual(isIsoUtcTimestamp('2026-10-15T18:00:00Z'), true)
  assert.strictEqual(isIsoUtcTimestamp('2026-10-15T18:00:00+00:00'), false, '+00:00 must be rejected')
  assert.strictEqual(isIsoUtcTimestamp('2026-10-15T18:00:00-00:00'), false, '-00:00 must be rejected')
  assert.strictEqual(isIsoUtcTimestamp('2026-10-15T18:00:00+05:30'), false, 'local offset must be rejected')
  assert.strictEqual(isIsoUtcTimestamp('2026-10-15 18:00:00'), false, 'timezone-less must be rejected')
  assert.strictEqual(isIsoUtcTimestamp('invalid'), false)
})
