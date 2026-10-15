import React, { useState } from 'react'
import { PageLayout, type StatusItem } from '../../components/PageLayout'
import type { DemoStudentCredential } from '../../types'
import { getSavedDemoCredential, clearDemoCredential } from '../../lib/demoStorage'

export const HolderWallet: React.FC = () => {
  const [credential, setCredential] = useState<DemoStudentCredential | null>(() =>
    getSavedDemoCredential()
  )
  const [showJsonDetails, setShowJsonDetails] = useState(false)
  const [copied, setCopied] = useState(false)
  const [confirmClear, setConfirmClear] = useState(false)

  // Handle Clear Local Credential
  const handleConfirmClear = () => {
    clearDemoCredential()
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

  const statusItems: StatusItem[] = [
    { label: 'Vault Custody', value: 'Browser Storage', badge: 'neutral' },
    {
      label: 'Proof Status',
      value: credential ? 'Proof Object Present' : 'No Credential Loaded',
      badge: credential ? 'forest' : 'neutral',
    },
    { label: 'Privacy Mode', value: 'Complete Credential Record', badge: 'neutral' },
    {
      label: 'Stored Records',
      value: credential ? '1 Credential Record' : '0 Records',
      badge: credential ? 'forest' : 'neutral',
    },
  ]

  return (
    <PageLayout
      sectionNumeral="SEC 02"
      sectionCategory="Holder Identity Vault"
      title="Student Credential Vault"
      subtitle="Holder interface for inspecting student credentials stored in browser storage. Displays the academic credential record and credential proof."
      statusItems={statusItems}
    >
      {/* CONDITIONAL DISPLAY: Empty state vs Stored Credential Document */}
      {!credential ? (
        /* EMPTY STATE */
        <section
          aria-label="Empty Credential Vault"
          className="border border-[#E7E3DA] bg-[#FFFFFF] p-8 sm:p-12 text-center space-y-4"
        >
          <div className="mx-auto flex h-12 w-12 items-center justify-center border border-[#D4CEBF] bg-[#FAF8F5] text-[#787E78]">
            <svg
              width="24"
              height="24"
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

          <div className="space-y-1.5 max-w-md mx-auto">
            <h2 className="text-base font-semibold text-[#1C201D] tracking-tight">
              No Stored Credentials in Browser Vault
            </h2>
            <p className="text-xs text-[#525753] leading-relaxed">
              Your browser storage currently contains zero credentials. To populate this vault, open the Issuer Administration workspace and issue a student credential.
            </p>
          </div>

          <div className="pt-2">
            <span className="inline-block font-mono text-[11px] text-[#787E78] border border-[#E7E3DA] bg-[#FAF8F5] px-3 py-1">
              STATUS: VAULT_EMPTY
            </span>
          </div>
        </section>
      ) : (
        /* RESTRAINED CREDENTIAL DOCUMENT */
        <section
          aria-label="Stored Credential Document"
          className="border border-[#E7E3DA] bg-[#FFFFFF] space-y-0"
        >
          {/* Document Header Bar */}
          <div className="border-b border-[#E7E3DA] bg-[#FAF8F5] p-5 sm:p-6 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="space-y-0.5">
              <div className="flex items-center gap-2">
                <span className="font-mono text-xs font-semibold uppercase tracking-wider text-[#1C201D]">
                  Academic Credential Record
                </span>
              </div>
              <p className="text-xs text-[#787E78]">
                Standard: StudentCredential • Credential Proof Object
              </p>
            </div>

            {/* Management Actions */}
            <div className="flex items-center gap-2">
              {!confirmClear ? (
                <button
                  type="button"
                  onClick={() => setConfirmClear(true)}
                  className="px-3 py-1.5 text-xs font-mono uppercase tracking-wider border border-[#E8C8C0] text-[#A84835] hover:bg-[#FAF0ED] transition-colors"
                >
                  Clear Local Credential
                </button>
              ) : (
                <div className="flex items-center gap-2 bg-[#FAF0ED] border border-[#E8C8C0] p-1.5">
                  <span className="text-[11px] font-mono text-[#A84835] px-1">
                    Confirm deletion?
                  </span>
                  <button
                    type="button"
                    onClick={handleConfirmClear}
                    className="px-2 py-0.5 text-xs font-mono uppercase bg-[#A84835] text-[#FFFFFF] font-semibold hover:bg-[#8A3726] transition-colors"
                  >
                    Yes, Clear
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfirmClear(false)}
                    className="px-2 py-0.5 text-xs font-mono uppercase border border-[#D4CEBF] bg-[#FFFFFF] text-[#525753] hover:text-[#1C201D]"
                  >
                    Cancel
                  </button>
                </div>
              )}
            </div>
          </div>

          {/* Editorial Certificate / Document Body */}
          <div className="p-6 sm:p-8 space-y-6">
            {/* Certificate Header Stamp */}
            <div className="border border-[#E7E3DA] bg-[#FAF8F5] p-4 sm:p-6 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div className="space-y-1">
                <span className="font-mono text-[10px] uppercase tracking-wider text-[#787E78]">
                  ACADEMIC CREDENTIAL RECORD
                </span>
                <h3 className="text-xl font-semibold tracking-tight text-[#1C201D]">
                  {credential.type}
                </h3>
                <p className="text-xs text-[#525753]">
                  Issued by: <strong className="font-medium text-[#1C201D]">{credential.issuerId}</strong> (Institutional Authority)
                </p>
              </div>

              <div className="text-right sm:border-l sm:border-[#E7E3DA] sm:pl-6 space-y-0.5 self-start sm:self-auto">
                <div className="font-mono text-[10px] uppercase tracking-wider text-[#787E78]">
                  CLAIMED STATUS
                </div>
                <div className="flex items-center gap-1.5 text-xs font-mono font-semibold">
                  <span
                    className={`h-2 w-2 rounded-full ${
                      credential.claims.studentStatus === 'active'
                        ? 'bg-[#264D3B]'
                        : 'bg-[#A84835]'
                    }`}
                  />
                  <span className="uppercase text-[#1C201D]">
                    {credential.claims.studentStatus}
                  </span>
                </div>
              </div>
            </div>

            {/* Document Attributes Grid */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-y-4 gap-x-8 text-xs border-b border-[#E7E3DA] pb-6">
              <div className="space-y-1">
                <div className="font-mono text-[11px] uppercase tracking-wider text-[#787E78]">
                  Subject Identifier
                </div>
                <div className="font-mono text-xs text-[#1C201D] font-medium bg-[#FAF8F5] border border-[#E7E3DA] p-2 break-all">
                  {credential.subject.id}
                </div>
              </div>

              <div className="space-y-1">
                <div className="font-mono text-[11px] uppercase tracking-wider text-[#787E78]">
                  Credential Identifier
                </div>
                <div className="font-mono text-xs text-[#1C201D] font-medium bg-[#FAF8F5] border border-[#E7E3DA] p-2 break-all">
                  {credential.id}
                </div>
              </div>

              <div className="space-y-1">
                <div className="font-mono text-[11px] uppercase tracking-wider text-[#787E78]">
                  Issuance Timestamp (UTC)
                </div>
                <div className="font-mono text-xs text-[#525753] p-2">
                  {credential.issuedAt}
                </div>
              </div>

              <div className="space-y-1">
                <div className="font-mono text-[11px] uppercase tracking-wider text-[#787E78]">
                  Expiration Timestamp (UTC)
                </div>
                <div className="font-mono text-xs text-[#525753] p-2">
                  {credential.expiresAt}
                </div>
              </div>
            </div>

            {/* Credential Proof Details */}
            <div className="border border-[#E7E3DA] bg-[#FAF8F5] p-4 text-xs space-y-1.5">
              <div className="flex items-center justify-between">
                <span className="font-mono text-[11px] font-semibold uppercase tracking-wider text-[#525753]">
                  Credential Proof
                </span>
              </div>
              <div className="font-mono text-[11px] text-[#525753] break-all bg-[#FFFFFF] border border-[#E7E3DA] p-2 space-y-0.5">
                <div><span className="text-[#787E78]">Type:</span> {credential.proof.type}</div>
                <div><span className="text-[#787E78]">KeyID:</span> {credential.proof.keyId}</div>
                <div><span className="text-[#787E78]">Signature:</span> {credential.proof.signature}</div>
              </div>
            </div>

            {/* Detail View Toggle & Copy Actions */}
            <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
              <button
                type="button"
                onClick={() => setShowJsonDetails((prev) => !prev)}
                className="inline-flex items-center gap-1.5 text-xs font-mono uppercase tracking-wider text-[#264D3B] hover:text-[#1B382B] font-semibold underline underline-offset-4"
              >
                <span>{showJsonDetails ? 'Hide credential details' : 'View credential details'}</span>
                <span>{showJsonDetails ? '↑' : '↓'}</span>
              </button>

              <button
                type="button"
                onClick={handleCopyJson}
                className="px-3 py-1.5 text-xs font-mono uppercase tracking-wider border border-[#D4CEBF] bg-[#FAF8F5] text-[#525753] hover:text-[#1C201D] hover:bg-[#FFFFFF] transition-colors"
              >
                {copied ? 'Copied to Clipboard' : 'Copy JSON'}
              </button>
            </div>

            {/* Raw JSON Details Viewer */}
            {showJsonDetails && (
              <div className="border border-[#E7E3DA] bg-[#FAF8F5] p-4 space-y-2">
                <div className="flex items-center justify-between text-[11px] font-mono text-[#787E78] border-b border-[#E7E3DA] pb-2">
                  <span>RAW CREDENTIAL RECORD</span>
                  <span>JSON FORMAT</span>
                </div>
                <pre className="font-mono text-[11px] text-[#1C201D] overflow-x-auto p-2 leading-relaxed bg-[#FFFFFF] border border-[#E7E3DA]">
                  {JSON.stringify(credential, null, 2)}
                </pre>
              </div>
            )}
          </div>
        </section>
      )}
    </PageLayout>
  )
}
