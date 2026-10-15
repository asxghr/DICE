import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import QRCode from 'qrcode'
import {
  encodeCredentialToQr,
  decodeCredentialFromQr,
  decodeQrFromImageData,
} from './qrUtils.ts'
import type { StudentCredential } from '../../types'

const sampleCredential: StudentCredential = {
  id: 'urn:uuid:test-cred-end-to-end-01',
  type: 'StudentCredential',
  issuerId: 'institution-svce-registrar',
  subject: {
    id: 'student-charlie-2026',
  },
  claims: {
    studentStatus: 'active',
  },
  issuedAt: '2026-10-15T00:00:00Z',
  expiresAt: '2027-10-15T00:00:00Z',
  proof: {
    type: 'Ed25519Signature',
    keyId: 'svce-master-2026',
    signature: 'valid_base64url_sig_sample',
  },
}

describe('QR End-to-End Pipeline & Visual Pixel Decoding', () => {
  it('1. Holder encodes credential -> QRCode renders raw pixel matrix -> jsQR decodes matrix -> Verifier receives exact credential', async () => {
    // 1. Holder encodes
    const qrString = encodeCredentialToQr(sampleCredential)
    assert.ok(qrString.startsWith('dice:credential:v1:'))

    // 2. Generate raw RGBA image buffer via QRCode library (simulates drawing to canvas)
    const qrImage = QRCode.create(qrString, { errorCorrectionLevel: 'M' })
    const size = qrImage.modules.size
    const scale = 4
    const width = size * scale
    const height = size * scale
    const rgba = new Uint8ClampedArray(width * height * 4)

    // Fill white background
    rgba.fill(255)

    // Render modules
    for (let row = 0; row < size; row++) {
      for (let col = 0; col < size; col++) {
        if (qrImage.modules.get(row, col)) {
          for (let y = 0; y < scale; y++) {
            for (let x = 0; x < scale; x++) {
              const pixelIndex = ((row * scale + y) * width + (col * scale + x)) * 4
              rgba[pixelIndex] = 0 // R
              rgba[pixelIndex + 1] = 0 // G
              rgba[pixelIndex + 2] = 0 // B
              rgba[pixelIndex + 3] = 255 // A
            }
          }
        }
      }
    }

    // 3. Verifier scans frame via jsQR
    const decodedRaw = decodeQrFromImageData(rgba, width, height)
    assert.ok(decodedRaw, 'jsQR must decode the generated pixel matrix')
    assert.strictEqual(decodedRaw, qrString)

    // 4. Verifier parses QR payload
    const decodedCred = decodeCredentialFromQr(decodedRaw)
    assert.strictEqual(decodedCred.success, true)
    if (decodedCred.success) {
      assert.strictEqual(decodedCred.version, 'v1')
      assert.strictEqual(decodedCred.credential.id, sampleCredential.id)
      assert.strictEqual(decodedCred.credential.subject.id, 'student-charlie-2026')
      assert.strictEqual(decodedCred.credential.claims.studentStatus, 'active')
      assert.strictEqual(decodedCred.credential.proof.keyId, 'svce-master-2026')
    }
  })

  it('2. Tampered QR barcode payload is detected and rejected on decode', () => {
    const qrString = encodeCredentialToQr(sampleCredential)
    // Flip characters in the base64 portion
    const prefix = 'dice:credential:v1:'
    const base64 = qrString.slice(prefix.length)
    const tamperedBase64 = base64.slice(0, 10) + 'INVALID_BYTES' + base64.slice(23)
    const tamperedQrString = `${prefix}${tamperedBase64}`

    const result = decodeCredentialFromQr(tamperedQrString)
    assert.strictEqual(result.success, false)
  })

  it('3. Paste fallback accepts both dice:credential:v1 and formatted JSON', () => {
    const qrString = encodeCredentialToQr(sampleCredential)
    const res1 = decodeCredentialFromQr(qrString)
    assert.strictEqual(res1.success, true)

    const jsonString = JSON.stringify(sampleCredential, null, 2)
    const res2 = decodeCredentialFromQr(jsonString)
    assert.strictEqual(res2.success, true)
    if (res2.success) {
      assert.strictEqual(res2.version, 'json')
      assert.strictEqual(res2.credential.id, sampleCredential.id)
    }
  })

  it('4. Rejects tampered claims in JSON fallback', () => {
    const tamperedJson = JSON.stringify({
      ...sampleCredential,
      claims: { studentStatus: 'unregistered_status' },
    })
    const res = decodeCredentialFromQr(tamperedJson)
    assert.strictEqual(res.success, false)
    if (!res.success) {
      assert.strictEqual(res.error.code, 'INVALID_CREDENTIAL_SHAPE')
    }
  })
})
