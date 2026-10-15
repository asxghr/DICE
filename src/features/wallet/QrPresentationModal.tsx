import React, { useState, useEffect } from 'react'
import type { AnyStudentCredential } from '../../types'
import { encodeCredentialToQr, generateCredentialQrDataUrl } from '../../lib/qr/qrUtils'
import { SpotlightCard } from '../../components/ui/react-bits/SpotlightCard'
import { DecryptedText } from '../../components/ui/react-bits/DecryptedText'

export interface QrPresentationModalProps {
  isOpen: boolean
  onClose: () => void
  credential: AnyStudentCredential | null
}

export const QrPresentationModal: React.FC<QrPresentationModalProps> = ({
  isOpen,
  onClose,
  credential,
}) => {
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [copiedPayload, setCopiedPayload] = useState(false)
  const [copiedJson, setCopiedJson] = useState(false)
  const [generationError, setGenerationError] = useState<string | null>(null)

  // Derive QR payload string directly during render
  const qrString = credential ? encodeCredentialToQr(credential) : ''

  useEffect(() => {
    if (!isOpen || !credential) {
      return
    }

    let isMounted = true

    generateCredentialQrDataUrl(credential, { width: 360 })
      .then((url) => {
        if (isMounted) {
          setQrDataUrl(url)
          setIsLoading(false)
        }
      })
      .catch((err) => {
        if (isMounted) {
          setGenerationError(err instanceof Error ? err.message : 'Failed to generate QR code.')
          setIsLoading(false)
        }
      })

    return () => {
      isMounted = false
    }
  }, [isOpen, credential])

  // Escape key listener for accessibility
  useEffect(() => {
    if (!isOpen) return
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [isOpen, onClose])

  if (!isOpen || !credential) return null

  const handleCopyPayload = async () => {
    if (!qrString) return
    try {
      await navigator.clipboard.writeText(qrString)
      setCopiedPayload(true)
      setTimeout(() => setCopiedPayload(false), 2000)
    } catch {
      // Fallback
    }
  }

  const handleCopyJson = async () => {
    try {
      await navigator.clipboard.writeText(JSON.stringify(credential, null, 2))
      setCopiedJson(true)
      setTimeout(() => setCopiedJson(false), 2000)
    } catch {
      // Fallback
    }
  }

  const handleRetry = () => {
    setIsLoading(true)
    setGenerationError(null)
    generateCredentialQrDataUrl(credential, { width: 360 })
      .then((url) => {
        setQrDataUrl(url)
        setIsLoading(false)
      })
      .catch((err) => {
        setGenerationError(err instanceof Error ? err.message : 'Failed to generate QR code.')
        setIsLoading(false)
      })
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="qr-modal-title"
      className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-5 bg-[#1C201D]/70 backdrop-blur-xs overflow-y-auto"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div className="relative w-full max-w-xl my-auto bg-[#FFFFFF] border border-[#D4CEBF] rounded-xs shadow-2xl overflow-hidden focus:outline-none">
        {/* Modal Header */}
        <div className="flex items-center justify-between border-b border-[#E7E3DA] bg-[#FAF8F5] px-5 py-3.5">
          <div className="flex items-center gap-2">
            <span className="h-2 w-2 rounded-full bg-[#264D3B]" aria-hidden="true" />
            <h2
              id="qr-modal-title"
              className="font-mono text-xs font-semibold uppercase tracking-wider text-[#1C201D]"
            >
              Academic Credential QR Presentation
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close QR presentation"
            className="flex h-7 w-7 items-center justify-center rounded-xs border border-[#D4CEBF] bg-[#FFFFFF] text-[#525753] hover:text-[#1C201D] hover:bg-[#FAF8F5] transition-colors cursor-pointer focus-visible:ring-2 focus-visible:ring-[#264D3B] focus-visible:outline-none"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="square">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        {/* Modal Body */}
        <div className="p-5 sm:p-6 space-y-5 max-h-[82vh] overflow-y-auto">
          {/* Spotlight Presentation Card */}
          <SpotlightCard
            spotlightColor="rgba(38, 77, 59, 0.08)"
            borderColor="#D4CEBF"
            className="rounded-xs p-5 bg-[#FAF8F5]/80 flex flex-col items-center justify-center text-center space-y-4"
          >
            {isLoading ? (
              <div className="h-64 w-64 flex flex-col items-center justify-center space-y-3 bg-[#FFFFFF] border border-[#E7E3DA] rounded-xs">
                <svg className="animate-spin h-6 w-6 text-[#264D3B]" fill="none" viewBox="0 0 24 24" aria-hidden="true">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                </svg>
                <span className="font-mono text-xs text-[#525753]">Encoding Credential QR...</span>
              </div>
            ) : generationError ? (
              <div className="h-64 w-full flex flex-col items-center justify-center space-y-3 bg-[#FAF0ED] border border-[#E8C8C0] p-4 rounded-xs">
                <p className="text-xs text-[#A84835] font-semibold">{generationError}</p>
                <button
                  type="button"
                  onClick={handleRetry}
                  className="px-3 py-1.5 bg-[#FFFFFF] border border-[#E8C8C0] text-xs font-mono text-[#A84835] hover:bg-[#FAF8F5] rounded-xs cursor-pointer"
                >
                  Retry Render
                </button>
              </div>
            ) : qrDataUrl ? (
              <div className="p-3 bg-[#FFFFFF] border border-[#D4CEBF] rounded-xs shadow-xs inline-block">
                <img
                  src={qrDataUrl}
                  alt={`QR code for student credential ${credential.id}`}
                  className="w-56 h-56 sm:w-64 sm:h-64 object-contain mx-auto block"
                />
              </div>
            ) : null}

            {/* Prefix & Format Tag */}
            <div className="space-y-1">
              <div className="inline-flex items-center gap-2 px-2.5 py-1 bg-[#FFFFFF] border border-[#E7E3DA] rounded-2xs text-[11px] font-mono text-[#525753]">
                <span>FORMAT:</span>
                <span className="text-[#264D3B] font-bold">dice:credential:v1</span>
                <span>•</span>
                <span>BASE64URL UTF-8</span>
              </div>
              <p className="text-[11px] text-[#787E78]">
                Position phone camera or Verification Desk scanner directly in front of this barcode.
              </p>
            </div>
          </SpotlightCard>

          {/* Security Disclaimer Panel */}
          <div className="p-3.5 bg-[#FAF8F5] border border-[#E7E3DA] rounded-xs text-xs space-y-1.5">
            <div className="flex items-center gap-1.5 text-[#C4A44D] font-mono text-[11px] uppercase tracking-wider font-semibold">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                <circle cx="12" cy="12" r="10" />
                <line x1="12" y1="8" x2="12" y2="12" />
                <line x1="12" y1="16" x2="12.01" y2="16" />
              </svg>
              <span>Cryptographic Presentation Disclaimer</span>
            </div>
            <p className="text-[#525753] leading-relaxed">
              This QR code securely transmits your complete signed credential record. <strong>Presenting a QR code does not itself prove validity</strong>: the receiving verifier must cryptographically evaluate the Ed25519 signature and query the registrar registry for revocation before granting official trust.
            </p>
          </div>

          {/* Human-Readable Summary of Shared Claims */}
          <div className="border border-[#E7E3DA] rounded-xs bg-[#FFFFFF] divide-y divide-[#E7E3DA] text-xs">
            <div className="px-4 py-2.5 bg-[#FAF8F5] font-mono text-[11px] font-semibold uppercase tracking-wider text-[#1C201D] flex items-center justify-between">
              <span>Transmitted Credential Claims</span>
              <span className="text-[10px] text-[#787E78]">UNENCRYPTED PUBLIC CLAIMS</span>
            </div>

            <div className="px-4 py-2.5 grid grid-cols-1 sm:grid-cols-3 gap-1 sm:gap-4">
              <span className="text-[#787E78] font-mono text-[11px]">Credential ID</span>
              <span className="sm:col-span-2 font-mono text-[11px] text-[#1C201D] font-semibold break-all">
                {credential.id}
              </span>
            </div>

            <div className="px-4 py-2.5 grid grid-cols-1 sm:grid-cols-3 gap-1 sm:gap-4">
              <span className="text-[#787E78] font-mono text-[11px]">Subject ID</span>
              <span className="sm:col-span-2 font-mono text-[11px] text-[#264D3B] font-semibold break-all">
                {credential.subject.id}
              </span>
            </div>

            <div className="px-4 py-2.5 grid grid-cols-1 sm:grid-cols-3 gap-1 sm:gap-4">
              <span className="text-[#787E78] font-mono text-[11px]">Academic Standing</span>
              <span className="sm:col-span-2">
                <span
                  className={`inline-block px-2 py-0.5 font-mono text-[10px] uppercase font-semibold border rounded-2xs ${
                    credential.claims.studentStatus === 'active'
                      ? 'border-[#CADACF] bg-[#EDF3EE] text-[#264D3B]'
                      : 'border-[#E8C8C0] bg-[#FAF0ED] text-[#A84835]'
                  }`}
                >
                  {credential.claims.studentStatus.toUpperCase()}
                </span>
              </span>
            </div>

            <div className="px-4 py-2.5 grid grid-cols-1 sm:grid-cols-3 gap-1 sm:gap-4">
              <span className="text-[#787E78] font-mono text-[11px]">Issuing Authority</span>
              <span className="sm:col-span-2 font-mono text-[11px] text-[#1C201D]">
                {credential.issuerId}
              </span>
            </div>

            <div className="px-4 py-2.5 grid grid-cols-1 sm:grid-cols-3 gap-1 sm:gap-4">
              <span className="text-[#787E78] font-mono text-[11px]">Validity Window</span>
              <span className="sm:col-span-2 font-mono text-[11px] text-[#525753]">
                {credential.issuedAt} → {credential.expiresAt}
              </span>
            </div>

            <div className="px-4 py-2.5 grid grid-cols-1 sm:grid-cols-3 gap-1 sm:gap-4">
              <span className="text-[#787E78] font-mono text-[11px]">Proof Mechanism</span>
              <div className="sm:col-span-2 space-y-1">
                <div className="flex items-center gap-2">
                  <span className="font-mono text-[11px] text-[#1C201D] font-semibold">
                    {credential.proof.type}
                  </span>
                  <span className="text-[10px] font-mono text-[#787E78]">
                    (Key: {credential.proof.keyId})
                  </span>
                </div>
                <div className="font-mono text-[10px] text-[#264D3B] truncate max-w-sm">
                  Sig: <DecryptedText text={credential.proof.signature} speed={15} />
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Modal Actions Footer */}
        <div className="border-t border-[#E7E3DA] bg-[#FAF8F5] px-5 py-3.5 flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={handleCopyPayload}
              disabled={!qrString}
              className="px-3.5 py-1.5 text-xs font-mono uppercase tracking-wider font-semibold border border-[#D4CEBF] bg-[#FFFFFF] text-[#1C201D] hover:bg-[#FAF8F5] transition-colors rounded-xs cursor-pointer focus-visible:ring-2 focus-visible:ring-[#264D3B] focus-visible:outline-none disabled:opacity-50"
            >
              {copiedPayload ? '✓ Payload Copied' : 'Copy QR Payload'}
            </button>

            <button
              type="button"
              onClick={handleCopyJson}
              className="px-3 py-1.5 text-xs font-mono uppercase tracking-wider border border-[#D4CEBF] bg-[#FFFFFF] text-[#525753] hover:text-[#1C201D] hover:bg-[#FAF8F5] transition-colors rounded-xs cursor-pointer focus-visible:ring-2 focus-visible:ring-[#264D3B] focus-visible:outline-none"
            >
              {copiedJson ? '✓ JSON Copied' : 'Copy Raw JSON'}
            </button>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="px-4 py-1.5 text-xs font-mono uppercase tracking-wider font-semibold bg-[#1C201D] text-[#FFFFFF] hover:bg-[#383F39] transition-colors rounded-xs cursor-pointer focus-visible:ring-2 focus-visible:ring-[#264D3B] focus-visible:outline-none"
          >
            Close Presentation
          </button>
        </div>
      </div>
    </div>
  )
}
