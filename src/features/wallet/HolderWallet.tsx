import React, { useState, useEffect, useCallback } from 'react'
import { PageLayout } from '../../components/PageLayout'
import type { AnyStudentCredential, ActiveView } from '../../types'
import {
  getSavedCredential,
  clearCredential,
  DEMO_ISSUER_STORAGE_KEY,
} from '../../lib/demoStorage'
import {
  classifyWalletProof,
  getWalletStatusItems,
} from './walletState'
import { SpotlightCard } from '../../components/ui/react-bits/SpotlightCard'
import { DecryptedText } from '../../components/ui/react-bits/DecryptedText'

export interface HolderWalletProps {
  onSelectView?: (view: ActiveView) => void
}

export const HolderWallet: React.FC<HolderWalletProps> = ({ onSelectView }) => {
  const [credential, setCredential] = useState<AnyStudentCredential | null>(() =>
    getSavedCredential()
  )
  const [showJsonDetails, setShowJsonDetails] = useState(false)
  const [copied, setCopied] = useState(false)
  const [confirmClear, setConfirmClear] = useState(false)

  // Safe event-driven refresh without polling
  const syncFromStorage = useCallback(() => {
    setCredential(getSavedCredential())
  }, [])

  useEffect(() => {
    const handleStorageEvent = (e: StorageEvent) => {
      if (e.key === DEMO_ISSUER_STORAGE_KEY || e.key === null) {
        syncFromStorage()
      }
    }

    const handleCustomStorageEvent = () => {
      syncFromStorage()
    }

    window.addEventListener('storage', handleStorageEvent)
    window.addEventListener('dice:storage-change', handleCustomStorageEvent)

    return () => {
      window.removeEventListener('storage', handleStorageEvent)
      window.removeEventListener('dice:storage-change', handleCustomStorageEvent)
    }
  }, [syncFromStorage])

  // Handle Clear Local Credential (strictly local browser storage operation)
  const handleConfirmClear = () => {
    clearCredential()
    setCredential(null)
    setConfirmClear(false)
    setShowJsonDetails(false)
  }

  // Handle Copy JSON
  const handleCopyJson = async () => {
    if (!credential) return
    try {
      await navigator.clipboard.writeText(JSON.stringify(credential, null, 2))
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // Fallback
    }
  }

  const proofClassification = classifyWalletProof(credential)
  const isEd25519Proof = proofClassification === 'ed25519'
  const isSimulatedProof = proofClassification === 'simulated'
  const statusItems = getWalletStatusItems(credential)

  return (
    <PageLayout
      sectionNumeral="SEC 02"
      sectionCategory="Holder Identity Vault"
      title="Student Credential Vault"
      subtitle="Personal credential vault for inspecting student credentials stored in browser storage. Displays authentic academic credential records and cryptographic proofs."
      statusItems={statusItems}
    >
      {/* CONDITIONAL DISPLAY: Empty state vs Stored Credential Document */}
      {!credential ? (
        /* EMPTY STATE */
        <section
          aria-label="Empty Credential Vault"
          className="border border-[#D4CEBF] bg-[#FFFFFF] p-8 sm:p-14 text-center space-y-5 rounded-xs shadow-xs"
        >
          <div className="mx-auto flex h-14 w-14 items-center justify-center border border-[#D4CEBF] bg-[#FAF8F5] text-[#787E78] rounded-xs shadow-2xs">
            <svg
              width="26"
              height="26"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="square"
              strokeLinejoin="miter"
              aria-hidden="true"
            >
              <rect x="3" y="4" width="18" height="16" />
              <path d="M7 8h10" />
              <path d="M7 12h10" />
              <path d="M7 16h6" />
            </svg>
          </div>

          <div className="space-y-2 max-w-md mx-auto">
            <h2 className="text-base sm:text-lg font-semibold text-[#1C201D] tracking-tight">
              No Stored Credentials in Browser Vault
            </h2>
            <p className="text-xs sm:text-sm text-[#525753] leading-relaxed">
              Your browser storage currently contains zero credentials. To populate this personal vault, open the Issuer Administration workspace and issue an authentic student credential.
            </p>
          </div>

          <div className="pt-2 flex flex-col sm:flex-row items-center justify-center gap-3">
            {onSelectView && (
              <button
                type="button"
                onClick={() => onSelectView('issuer')}
                className="px-4 py-2 bg-[#264D3B] text-[#FFFFFF] text-xs font-mono uppercase tracking-wider font-semibold border border-[#1B382B] hover:bg-[#1B382B] transition-colors rounded-xs shadow-xs cursor-pointer focus-visible:ring-2 focus-visible:ring-[#264D3B] focus-visible:outline-none"
              >
                Go to Issuer Administration →
              </button>
            )}
            <button
              type="button"
              onClick={syncFromStorage}
              className="px-3.5 py-2 text-xs font-mono uppercase tracking-wider border border-[#D4CEBF] bg-[#FFFFFF] text-[#525753] hover:text-[#1C201D] hover:bg-[#FAF8F5] transition-colors rounded-xs cursor-pointer focus-visible:ring-2 focus-visible:ring-[#264D3B] focus-visible:outline-none"
            >
              Check Browser Storage
            </button>
          </div>
        </section>
      ) : (
        /* STORED CREDENTIAL DOCUMENT */
        <div className="space-y-6 sm:space-y-8">
          {/* Unverified Guidance & Verification Action Banner */}
          <section
            aria-label="Registry Verification Guidance"
            className="border border-[#E7E3DA] bg-[#FFFFFF] p-5 sm:p-6 rounded-xs shadow-xs flex flex-col md:flex-row md:items-center justify-between gap-4"
          >
            <div className="space-y-1.5 max-w-2xl">
              <div className="flex items-center gap-2">
                <span className="h-2 w-2 rounded-full bg-[#C4A44D]" aria-hidden="true" />
                <span className="font-mono text-xs font-semibold uppercase tracking-wider text-[#1C201D]">
                  Registry Status Unverified Locally • Audit Required
                </span>
              </div>
              <p className="text-xs text-[#525753] leading-relaxed">
                This vault stores the signed JSON-LD payload in your browser. Whether this credential has been revoked or remains valid on the central registrar registry cannot be determined from local storage alone. Submit this record to the Verification Desk for authoritative proof.
              </p>
              {isSimulatedProof && (
                <p className="text-[#A84835] font-mono text-[11px] pt-1">
                  Notice: This record contains a simulated demo proof (<code>DemoSimulationProof</code>) and is not registered in the authoritative institutional registry.
                </p>
              )}
            </div>

            <div className="flex flex-wrap items-center gap-2 shrink-0">
              {onSelectView && (
                <button
                  type="button"
                  onClick={() => onSelectView('verifier')}
                  className="px-4 py-2.5 bg-[#264D3B] text-[#FFFFFF] text-xs font-mono uppercase tracking-wider font-semibold border border-[#1B382B] hover:bg-[#1B382B] transition-colors rounded-xs shadow-xs cursor-pointer focus-visible:ring-2 focus-visible:ring-[#264D3B] focus-visible:outline-none"
                >
                  Verify at Verification Desk →
                </button>
              )}
            </div>
          </section>

          {/* Academic Credential Diploma Certificate (SpotlightCard) */}
          <SpotlightCard
            spotlightColor="rgba(196, 164, 77, 0.08)"
            borderColor="#D4CEBF"
            className="rounded-xs"
          >
            {/* Certificate Header Bar */}
            <div className="border-b border-[#E7E3DA] bg-[#FAF8F5] p-5 sm:p-6 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div className="flex items-start gap-3.5">
                <div className="flex h-11 w-11 shrink-0 items-center justify-center border border-[#D4CEBF] bg-[#FFFFFF] text-[#264D3B] font-semibold rounded-xs shadow-2xs">
                  <svg
                    width="22"
                    height="22"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.75"
                    strokeLinecap="square"
                    aria-hidden="true"
                  >
                    <rect x="3" y="3" width="18" height="18" />
                    <path d="M12 3v18" />
                    <path d="M3 12h18" />
                    <circle cx="12" cy="12" r="2" fill="currentColor" />
                  </svg>
                </div>

                <div className="space-y-0.5">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-mono text-xs font-semibold uppercase tracking-wider text-[#1C201D]">
                      Academic Credential Certificate
                    </span>
                    <span
                      className={`text-[10px] font-mono uppercase tracking-wider px-2 py-0.5 border rounded-2xs ${
                        isEd25519Proof
                          ? 'border-[#CADACF] bg-[#EDF3EE] text-[#264D3B] font-semibold'
                          : 'border-[#E7E3DA] bg-[#FAF8F5] text-[#787E78]'
                      }`}
                    >
                      {isEd25519Proof ? 'Ed25519 Signature' : 'Simulated Proof'}
                    </span>
                  </div>
                  <p className="text-xs text-[#787E78]">
                    Standard: {credential.type} • Canonical Academic Registry
                  </p>
                </div>
              </div>

              {/* Management Actions */}
              <div className="flex flex-wrap items-center gap-2 self-start sm:self-auto">
                <button
                  type="button"
                  onClick={syncFromStorage}
                  className="px-2.5 py-1.5 text-xs font-mono uppercase tracking-wider border border-[#D4CEBF] bg-[#FFFFFF] text-[#525753] hover:text-[#1C201D] hover:bg-[#FAF8F5] transition-colors rounded-xs cursor-pointer"
                  title="Reload credential payload from local browser storage"
                >
                  Refresh
                </button>

                {!confirmClear ? (
                  <button
                    type="button"
                    onClick={() => setConfirmClear(true)}
                    className="px-3 py-1.5 text-xs font-mono uppercase tracking-wider border border-[#E8C8C0] text-[#A84835] hover:bg-[#FAF0ED] transition-colors rounded-xs cursor-pointer"
                  >
                    Clear Local Record
                  </button>
                ) : (
                  <div className="flex items-center gap-2 bg-[#FAF0ED] border border-[#E8C8C0] p-1.5 rounded-xs">
                    <span className="text-[11px] font-mono text-[#A84835] px-1">
                      Confirm removal?
                    </span>
                    <button
                      type="button"
                      onClick={handleConfirmClear}
                      className="px-2 py-0.5 text-xs font-mono uppercase bg-[#A84835] text-[#FFFFFF] font-semibold hover:bg-[#8A3726] transition-colors rounded-2xs cursor-pointer"
                    >
                      Yes, Clear
                    </button>
                    <button
                      type="button"
                      onClick={() => setConfirmClear(false)}
                      className="px-2 py-0.5 text-xs font-mono uppercase border border-[#D4CEBF] bg-[#FFFFFF] text-[#525753] hover:text-[#1C201D] rounded-2xs cursor-pointer"
                    >
                      Cancel
                    </button>
                  </div>
                )}
              </div>
            </div>

            {/* Document Attributes Grid */}
            <div className="p-5 sm:p-6 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 text-xs">
              <div className="p-3 bg-[#FAF8F5]/80 border border-[#E7E3DA] rounded-xs space-y-1">
                <div className="font-mono text-[10px] uppercase tracking-wider text-[#787E78]">
                  Student Subject ID
                </div>
                <div className="font-mono text-sm font-semibold text-[#1C201D] truncate">
                  {credential.subject.id}
                </div>
              </div>

              <div className="p-3 bg-[#FAF8F5]/80 border border-[#E7E3DA] rounded-xs space-y-1">
                <div className="font-mono text-[10px] uppercase tracking-wider text-[#787E78]">
                  Claimed Enrollment Status
                </div>
                <div className="flex items-center gap-1.5 font-medium text-sm text-[#1C201D]">
                  <span
                    className={`h-2 w-2 rounded-full ${
                      credential.claims.studentStatus === 'active'
                        ? 'bg-[#264D3B]'
                        : 'bg-[#A84835]'
                    }`}
                  />
                  <span className="uppercase font-mono text-xs font-semibold">
                    {credential.claims.studentStatus}
                  </span>
                </div>
              </div>

              <div className="p-3 bg-[#FAF8F5]/80 border border-[#E7E3DA] rounded-xs space-y-1">
                <div className="font-mono text-[10px] uppercase tracking-wider text-[#787E78]">
                  Issuing Authority
                </div>
                <div className="font-mono text-xs text-[#1C201D] font-medium truncate">
                  {credential.issuerId}
                </div>
              </div>

              <div className="p-3 bg-[#FAF8F5]/80 border border-[#E7E3DA] rounded-xs space-y-1">
                <div className="font-mono text-[10px] uppercase tracking-wider text-[#787E78]">
                  Expiration Date (UTC)
                </div>
                <div className="font-mono text-xs text-[#525753]">
                  {credential.expiresAt}
                </div>
              </div>
            </div>

            {/* Credential Proof Details */}
            <div className="border-t border-[#E7E3DA] bg-[#FAF8F5]/90 p-5 sm:p-6 text-xs space-y-3">
              <div className="flex items-center justify-between">
                <span className="font-mono text-[11px] font-semibold uppercase tracking-wider text-[#525753]">
                  {isEd25519Proof
                    ? 'Ed25519 Proof Format (RFC 8032)'
                    : isSimulatedProof
                    ? 'Simulated Proof (Local Demo)'
                    : 'Credential Proof'}
                </span>
                <span className="text-[10px] font-mono text-[#787E78]">
                  {isEd25519Proof ? 'RFC 8032 Signature' : 'Local Mock'}
                </span>
              </div>

              <div className="font-mono text-[11px] text-[#525753] break-all bg-[#FFFFFF] border border-[#E7E3DA] p-3 rounded-xs space-y-1">
                <div>
                  <span className="text-[#787E78]">Proof Type:</span>{' '}
                  <span className="text-[#1C201D] font-medium">{credential.proof.type}</span>
                </div>
                <div>
                  <span className="text-[#787E78]">Key ID:</span>{' '}
                  <DecryptedText text={credential.proof.keyId} speed={25} className="text-[#1C201D]" />
                </div>
                <div>
                  <span className="text-[#787E78]">Signature:</span>{' '}
                  <DecryptedText text={credential.proof.signature} speed={15} className="text-[#264D3B]" />
                </div>
                {'simulationNote' in credential.proof && credential.proof.simulationNote && (
                  <div>
                    <span className="text-[#787E78]">Note:</span> {credential.proof.simulationNote}
                  </div>
                )}
              </div>

              <p className="text-[11px] text-[#787E78]">
                {isEd25519Proof
                  ? 'Contains an authoritative Ed25519 signature. Signature validity, issuer trust, and revocation status must be audited via the Verification Desk.'
                  : 'Demonstration simulation proof for offline preview. Real cryptographic audit requires an authentic Ed25519 credential.'}
              </p>
            </div>

            {/* Detail View Toggle & Copy Actions */}
            <div className="border-t border-[#E7E3DA] px-5 sm:px-6 py-3 flex flex-wrap items-center justify-between gap-3 bg-[#FFFFFF]">
              <button
                type="button"
                onClick={() => setShowJsonDetails((prev) => !prev)}
                className="inline-flex items-center gap-1.5 text-xs font-mono uppercase tracking-wider text-[#264D3B] hover:text-[#1B382B] font-semibold underline underline-offset-4 cursor-pointer"
              >
                <span>{showJsonDetails ? 'Hide credential details' : 'View credential details'}</span>
                <span>{showJsonDetails ? '↑' : '↓'}</span>
              </button>

              <button
                type="button"
                onClick={handleCopyJson}
                className="px-3 py-1.5 text-xs font-mono uppercase tracking-wider border border-[#D4CEBF] bg-[#FAF8F5] text-[#525753] hover:text-[#1C201D] hover:bg-[#FFFFFF] transition-colors rounded-xs cursor-pointer"
              >
                {copied ? 'Copied to Clipboard' : 'Copy JSON'}
              </button>
            </div>

            {/* Raw JSON Details Viewer */}
            {showJsonDetails && (
              <div className="border-t border-[#E7E3DA] bg-[#1C201D] text-[#EDF3EE] p-4 text-[11px] font-mono overflow-x-auto space-y-2">
                <div className="flex items-center justify-between text-[10px] text-[#787E78] border-b border-[#383F39] pb-2">
                  <span>RAW CREDENTIAL RECORD</span>
                  <span>JSON FORMAT</span>
                </div>
                <pre className="overflow-x-auto leading-relaxed max-h-72">
                  {JSON.stringify(credential, null, 2)}
                </pre>
              </div>
            )}
          </SpotlightCard>
        </div>
      )}
    </PageLayout>
  )
}
