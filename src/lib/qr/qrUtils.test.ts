import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  base64UrlEncode,
  base64UrlDecode,
  encodeCredentialToQr,
  decodeCredentialFromQr,
  validateCredentialShape,
  DICE_QR_PREFIX,
  MAX_QR_PAYLOAD_LENGTH,
} from './qrUtils.ts'
import type { StudentCredential, DemoStudentCredential } from '../../types'

const mockAuthenticCredential: StudentCredential = {
  id: 'cred-univ-2026-auth-001',
  type: 'StudentCredential',
  issuerId: 'svce-registrar',
  subject: {
    id: 'student-2026-alpha',
  },
  claims: {
    studentStatus: 'active',
  },
  issuedAt: '2026-10-15T12:00:00Z',
  expiresAt: '2027-10-15T12:00:00Z',
  proof: {
    type: 'Ed25519Signature',
    keyId: 'svce-key-01',
    signature: 'mock_signature_bytes_base64url_string',
  },
}

const mockSimulatedCredential: DemoStudentCredential = {
  id: 'cred-univ-2026-sim-002',
  type: 'StudentCredential',
  issuerId: 'svce-registrar',
  subject: {
    id: 'student-2026-beta',
  },
  claims: {
    studentStatus: 'inactive',
  },
  issuedAt: '2026-10-15T12:00:00Z',
  expiresAt: '2027-10-15T12:00:00Z',
  proof: {
    type: 'DemoSimulationProof',
    keyId: 'demo-key',
    signature: 'demo_sig',
    simulationNote: 'Offline preview proof',
  },
}

describe('QR Utilities - Base64URL and Unicode Encoding', () => {
  it('1. Correctly encodes and decodes ASCII strings', () => {
    const raw = 'Hello World!'
    const encoded = base64UrlEncode(raw)
    assert.strictEqual(base64UrlDecode(encoded), raw)
    assert.ok(!encoded.includes('+'))
    assert.ok(!encoded.includes('/'))
    assert.ok(!encoded.includes('='))
  })

  it('2. Correctly encodes and decodes complex Unicode characters and emoji', () => {
    const raw = 'SVCE Registrar • Student: Añita Núñez 🎓 (ID: std-ø-1234)'
    const encoded = base64UrlEncode(raw)
    const decoded = base64UrlDecode(encoded)
    assert.strictEqual(decoded, raw)
  })
})

describe('QR Utilities - Credential Encoding & Round Trips', () => {
  it('3. Encodes an authentic credential with versioned dice prefix', () => {
    const qrString = encodeCredentialToQr(mockAuthenticCredential)
    assert.ok(qrString.startsWith(DICE_QR_PREFIX))

    const decoded = decodeCredentialFromQr(qrString)
    assert.strictEqual(decoded.success, true)
    if (decoded.success) {
      assert.strictEqual(decoded.version, 'v1')
      assert.strictEqual(decoded.credential.id, mockAuthenticCredential.id)
      assert.strictEqual(decoded.credential.proof.type, 'Ed25519Signature')
      assert.deepStrictEqual(decoded.credential, mockAuthenticCredential)
    }
  })

  it('4. Encodes and decodes a simulated credential round trip', () => {
    const qrString = encodeCredentialToQr(mockSimulatedCredential)
    assert.ok(qrString.startsWith(DICE_QR_PREFIX))

    const decoded = decodeCredentialFromQr(qrString)
    assert.strictEqual(decoded.success, true)
    if (decoded.success) {
      assert.strictEqual(decoded.version, 'v1')
      assert.strictEqual(decoded.credential.id, mockSimulatedCredential.id)
      assert.strictEqual(decoded.credential.proof.type, 'DemoSimulationProof')
      assert.deepStrictEqual(decoded.credential, mockSimulatedCredential)
    }
  })

  it('5. Handles Unicode subject IDs in round-trip encoding', () => {
    const unicodeCred: StudentCredential = {
      ...mockAuthenticCredential,
      id: 'cred-unicode-001',
      subject: {
        id: 'student-🎓-añita-ñuñez-ø42',
      },
    }

    const qrString = encodeCredentialToQr(unicodeCred)
    const decoded = decodeCredentialFromQr(qrString)
    assert.strictEqual(decoded.success, true)
    if (decoded.success) {
      assert.strictEqual(decoded.credential.subject.id, 'student-🎓-añita-ñuñez-ø42')
    }
  })

  it('6. Accepts direct raw JSON strings as fallback', () => {
    const jsonString = JSON.stringify(mockAuthenticCredential, null, 2)
    const decoded = decodeCredentialFromQr(jsonString)
    assert.strictEqual(decoded.success, true)
    if (decoded.success) {
      assert.strictEqual(decoded.version, 'json')
      assert.strictEqual(decoded.credential.id, mockAuthenticCredential.id)
    }
  })
})

describe('QR Utilities - Negative & Error Classification', () => {
  it('7. Rejects empty string or whitespace-only inputs as EMPTY_PAYLOAD', () => {
    const r1 = decodeCredentialFromQr('')
    assert.strictEqual(r1.success, false)
    if (!r1.success) assert.strictEqual(r1.error.code, 'EMPTY_PAYLOAD')

    const r2 = decodeCredentialFromQr('    ')
    assert.strictEqual(r2.success, false)
    if (!r2.success) assert.strictEqual(r2.error.code, 'EMPTY_PAYLOAD')

    const r3 = decodeCredentialFromQr(DICE_QR_PREFIX)
    assert.strictEqual(r3.success, false)
    if (!r3.success) assert.strictEqual(r3.error.code, 'EMPTY_PAYLOAD')
  })

  it('8. Rejects oversized payloads as OVERSIZED_PAYLOAD', () => {
    const bigString = 'x'.repeat(MAX_QR_PAYLOAD_LENGTH + 10)
    const res = decodeCredentialFromQr(bigString)
    assert.strictEqual(res.success, false)
    if (!res.success) {
      assert.strictEqual(res.error.code, 'OVERSIZED_PAYLOAD')
    }
  })

  it('9. Rejects unsupported versions as UNSUPPORTED_VERSION', () => {
    const r1 = decodeCredentialFromQr('dice:credential:v2:somebase64data')
    assert.strictEqual(r1.success, false)
    if (!r1.success) assert.strictEqual(r1.error.code, 'UNSUPPORTED_VERSION')

    const r2 = decodeCredentialFromQr('dice:credential:v0:somebase64data')
    assert.strictEqual(r2.success, false)
    if (!r2.success) assert.strictEqual(r2.error.code, 'UNSUPPORTED_VERSION')
  })

  it('10. Rejects invalid base64url data as MALFORMED_BASE64', () => {
    // String with characters not in standard base64/base64url
    const badBase64 = `${DICE_QR_PREFIX}!!!not_base64_symbols@@@`
    const res = decodeCredentialFromQr(badBase64)
    assert.strictEqual(res.success, false)
    if (!res.success) {
      assert.ok(
        res.error.code === 'MALFORMED_BASE64' || res.error.code === 'MALFORMED_JSON'
      )
    }
  })

  it('11. Rejects malformed JSON syntax as MALFORMED_JSON', () => {
    const brokenJson = '{ "id": "test", unquoted: true '
    const encodedBroken = `${DICE_QR_PREFIX}${base64UrlEncode(brokenJson)}`
    const res = decodeCredentialFromQr(encodedBroken)
    assert.strictEqual(res.success, false)
    if (!res.success) {
      assert.strictEqual(res.error.code, 'MALFORMED_JSON')
    }

    const rawBroken = decodeCredentialFromQr(brokenJson + '}')
    assert.strictEqual(rawBroken.success, false)
  })

  it('12. Rejects random text format as MALFORMED_FORMAT', () => {
    const res = decodeCredentialFromQr('https://example.com/unrelated/link')
    assert.strictEqual(res.success, false)
    if (!res.success) {
      assert.strictEqual(res.error.code, 'MALFORMED_FORMAT')
    }
  })

  it('13. Rejects tampered / structurally invalid credentials as INVALID_CREDENTIAL_SHAPE', () => {
    // Missing proof
    const noProof = { ...mockAuthenticCredential, proof: undefined }
    const r1 = decodeCredentialFromQr(encodeCredentialToQr(noProof as unknown as StudentCredential))
    assert.strictEqual(r1.success, false)
    if (!r1.success) assert.strictEqual(r1.error.code, 'INVALID_CREDENTIAL_SHAPE')

    // Wrong type
    const wrongType = { ...mockAuthenticCredential, type: 'DriversLicense' }
    const r2 = decodeCredentialFromQr(encodeCredentialToQr(wrongType as unknown as StudentCredential))
    assert.strictEqual(r2.success, false)
    if (!r2.success) assert.strictEqual(r2.error.code, 'INVALID_CREDENTIAL_SHAPE')

    // Invalid student status claim
    const badStatus = {
      ...mockAuthenticCredential,
      claims: { studentStatus: 'graduated_honorary' },
    }
    const r3 = decodeCredentialFromQr(badStatus as unknown as string)
    assert.strictEqual(r3.success, false)

    // Missing subject.id
    const noSubjectId = { ...mockAuthenticCredential, subject: { id: '' } }
    const shapeValidation = validateCredentialShape(noSubjectId)
    assert.strictEqual(shapeValidation.valid, false)
  })
})
