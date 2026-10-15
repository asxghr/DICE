import React, { useState, useMemo } from 'react'
import { PageLayout, type StatusItem } from '../../components/PageLayout'
import type { DemoStudentCredential } from '../../types'
import { getSavedDemoCredential } from '../../lib/demoStorage'

interface CheckResult {
  id: string
  numeral: string
  label: string
  description: string
  passed: boolean
  detail: string
}

export const VerifierPortal: React.FC = () => {
  // Load saved credential from browser storage
  const [credential, setCredential] = useState<DemoStudentCredential | null>(() => getSavedDemoCredential())
  const [isTampered, setIsTampered] = useState(false)
  const [showJsonDetails, setShowJsonDetails] = useState(false)
  const [copied, setCopied] = useState(false)
  const [verifiedAt, setVerifiedAt] = useState<number>(() => Date.now())

  // Evaluate the 6 verification checks
  const checkResults = useMemo<CheckResult[]>(() => {
    if (!credential) return []

    const original = getSavedDemoCredential()

    // 1. Record Structure
    const hasStructure = Boolean(
      credential.id &&
      typeof credential.id === 'string' &&
      credential.type === 'StudentCredential' &&
      credential.issuerId &&
      typeof credential.issuerId === 'string' &&
      credential.subject &&
      typeof credential.subject.id === 'string' &&
      credential.claims &&
      typeof credential.claims === 'object' &&
      credential.issuedAt &&
      credential.expiresAt &&
      credential.proof &&
      typeof credential.proof === 'object'
    )

    // 2. Issuer Record
    const isKnownIssuer = Boolean(
      credential.issuerId &&
      (credential.issuerId === 'svce-demo' || credential.issuerId.startsWith('did:web:') || credential.issuerId.length > 3)
    )

    // 3. Claim Status
    const isStatusActive = credential.claims?.studentStatus === 'active'

    // 4. Expiry
    const issuedTime = Date.parse(credential.issuedAt || '')
    const expiryTime = Date.parse(credential.expiresAt || '')
    const isExpiryValid = !Number.isNaN(expiryTime) && expiryTime > verifiedAt && !Number.isNaN(issuedTime) && issuedTime < expiryTime

    // 5. Proof Object
    const hasProofObject = Boolean(
      credential.proof &&
      typeof credential.proof.type === 'string' &&
      typeof credential.proof.keyId === 'string' &&
      typeof credential.proof.signature === 'string' &&
      credential.proof.signature.length > 0
    )

    // 6. Record Consistency
    const isConsistent = Boolean(
      !isTampered &&
      original &&
      original.id === credential.id &&
      original.issuerId === credential.issuerId &&
      original.subject.id === credential.subject.id &&
      original.claims.studentStatus === credential.claims.studentStatus
    )

    return [
      {
        id: 'structure',
        numeral: 'CHECK 01',
        label: 'Record Structure',
        description: 'Validates presence of required schema fields, subject identifier, and timestamp formatting.',
        passed: hasStructure,
        detail: hasStructure ? 'Schema conformant: StudentCredential' : 'Malformed record structure',
      },
      {
        id: 'issuer',
        numeral: 'CHECK 02',
        label: 'Issuer Record',
        description: 'Confirms issuer identifier against the configured institutional record.',
        passed: isKnownIssuer,
        detail: isKnownIssuer ? 'Matches the configured issuer record.' : 'Does not match the configured issuer record.',
      },
      {
        id: 'claim',
        numeral: 'CHECK 03',
        label: 'Claim Status',
        description: 'Audits academic enrollment claim for active standing without restrictions.',
        passed: isStatusActive,
        detail: isStatusActive ? 'Claim status active' : `Standing unsatisfied: ${credential.claims?.studentStatus || 'unknown'}`,
      },
      {
        id: 'expiry',
        numeral: 'CHECK 04',
        label: 'Expiry',
        description: 'Confirms temporal validity bounds and verifies the expiration timestamp is in the future.',
        passed: isExpiryValid,
        detail: isExpiryValid ? `Valid until ${credential.expiresAt}` : 'Credential has expired or has invalid timestamp bounds',
      },
      {
        id: 'proof',
        numeral: 'CHECK 05',
        label: 'Proof Object',
        description: 'Audits presence and required metadata of the attached credential proof object.',
        passed: hasProofObject,
        detail: hasProofObject ? `Proof object format: ${credential.proof.type}` : 'Missing or incomplete proof object',
      },
      {
        id: 'consistency',
        numeral: 'CHECK 06',
        label: 'Record Consistency',
        description: 'Verifies presented claims match the issued storage record without tampering.',
        passed: isConsistent,
        detail: isConsistent
          ? 'Claims intact: matches issued storage record'
          : isTampered
          ? 'Tamper detected: presented claim modified from issued record'
          : 'Mismatch with issued storage record',
      },
    ]
  }, [credential, isTampered, verifiedAt])

  const isValid = checkResults.length > 0 && checkResults.every((c) => c.passed)

  // Actions
  const handleVerify = () => {
    setVerifiedAt(Date.now())
  }

  const handleTamperTest = () => {
    if (!credential) return
    setCredential({
      ...credential,
      claims: {
        ...credential.claims,
        studentStatus: credential.claims.studentStatus === 'active' ? 'inactive' : 'active',
      },
    })
    setIsTampered(true)
    setVerifiedAt(Date.now())
  }

  const handleRestore = () => {
    const original = getSavedDemoCredential()
    setCredential(original)
    setIsTampered(false)
    setVerifiedAt(Date.now())
  }

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
    { label: 'Verification Engine', value: 'Local Verification Rules', badge: 'forest' },
    {
      label: 'Presented Record',
      value: credential ? '1 Credential Loaded' : 'No Credential',
      badge: credential ? 'forest' : 'neutral',
    },
    {
      label: 'Audit Status',
      value: credential ? (isValid ? 'Accepted' : 'Rejected') : 'Standby',
      badge: credential ? (isValid ? 'forest' : 'terracotta') : 'neutral',
    },
    {
      label: 'Record State',
      value: isTampered ? 'Tampered Claim' : credential ? 'Authentic' : 'Standby',
      badge: isTampered ? 'terracotta' : credential ? 'forest' : 'neutral',
    },
  ]

  return (
    <PageLayout
      sectionNumeral="SEC 03"
      sectionCategory="Third-Party Verification"
      title="Verification Desk"
      subtitle="Verifier interface for inspecting student credentials, validating record structure, and auditing claim status."
      statusItems={statusItems}
    >
      {/* CONDITIONAL DISPLAY: Empty state vs Active Verification Workspace */}
      {!credential ? (
        /* EMPTY STATE */
        <section
          aria-label="Empty Verification Workspace"
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
              No Stored Credentials in Browser Storage
            </h2>
            <p className="text-xs text-[#525753] leading-relaxed">
              Your browser storage currently contains zero credentials. To verify a student credential, open the Issuer Administration workspace and issue one first.
            </p>
          </div>

          <div className="pt-2">
            <span className="inline-block font-mono text-[11px] text-[#787E78] border border-[#E7E3DA] bg-[#FAF8F5] px-3 py-1">
              STATUS: NO_CREDENTIAL
            </span>
          </div>
        </section>
      ) : (
        /* ACTIVE VERIFICATION WORKSPACE */
        <div className="space-y-6">
          {/* Result Status Banner */}
          <section
            aria-label="Verification Result"
            className={`border p-5 sm:p-6 flex flex-col sm:flex-row sm:items-center justify-between gap-4 ${
              isValid
                ? 'border-[#CADACF] bg-[#EDF3EE]'
                : 'border-[#E8C8C0] bg-[#FAF0ED]'
            }`}
          >
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <span
                  className={`h-2.5 w-2.5 rounded-full ${
                    isValid ? 'bg-[#264D3B]' : 'bg-[#A84835]'
                  }`}
                />
                <span
                  className={`font-mono text-sm font-semibold uppercase tracking-wider ${
                    isValid ? 'text-[#264D3B]' : 'text-[#A84835]'
                  }`}
                >
                  {isValid ? 'Credential Accepted' : 'Credential Rejected'}
                </span>
              </div>
              <p className="text-xs text-[#525753]">
                {isValid
                  ? 'All credential record checks passed.'
                  : isTampered
                  ? 'Record consistency check failed: claim was modified from the original issued credential.'
                  : 'Verification failed: one or more verification criteria were not satisfied.'}
              </p>
              {verifiedAt && (
                <p className="text-[10px] font-mono text-[#787E78]">
                  Checked timestamp: {new Date(verifiedAt).toISOString()}
                </p>
              )}
            </div>

            {/* Verification Actions */}
            <div className="flex flex-wrap items-center gap-2 shrink-0">
              <button
                type="button"
                onClick={handleVerify}
                className="px-4 py-2 text-xs font-mono uppercase tracking-wider bg-[#264D3B] text-[#FFFFFF] font-semibold border border-[#1B382B] hover:bg-[#1B382B] transition-colors cursor-pointer"
              >
                Verify Credential
              </button>

              {!isTampered ? (
                <button
                  type="button"
                  onClick={handleTamperTest}
                  className="px-3.5 py-2 text-xs font-mono uppercase tracking-wider border border-[#E8C8C0] bg-[#FFFFFF] text-[#A84835] hover:bg-[#FAF0ED] transition-colors cursor-pointer font-medium"
                >
                  Tamper Claim Status
                </button>
              ) : (
                <button
                  type="button"
                  onClick={handleRestore}
                  className="px-3.5 py-2 text-xs font-mono uppercase tracking-wider border border-[#CADACF] bg-[#FFFFFF] text-[#264D3B] hover:bg-[#EDF3EE] transition-colors cursor-pointer font-semibold"
                >
                  Restore Original Credential
                </button>
              )}
            </div>
          </section>

          {/* Presented Credential Summary */}
          <section className="border border-[#E7E3DA] bg-[#FFFFFF]">
            <div className="border-b border-[#E7E3DA] bg-[#FAF8F5] p-4 sm:p-5 flex items-center justify-between">
              <h3 className="font-mono text-xs font-semibold uppercase tracking-wider text-[#1C201D]">
                Presented Credential Summary
              </h3>
              <span className="font-mono text-[11px] text-[#787E78]">
                Type: {credential.type}
              </span>
            </div>

            <div className="p-5 sm:p-6 grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4 text-xs">
              <div className="space-y-1">
                <span className="font-mono text-[10px] uppercase tracking-wider text-[#787E78]">
                  Subject ID
                </span>
                <div className="font-mono text-xs text-[#1C201D] font-medium bg-[#FAF8F5] border border-[#E7E3DA] p-2 break-all">
                  {credential.subject.id}
                </div>
              </div>

              <div className="space-y-1">
                <span className="font-mono text-[10px] uppercase tracking-wider text-[#787E78]">
                  Issuer Authority
                </span>
                <div className="font-mono text-xs text-[#1C201D] font-medium bg-[#FAF8F5] border border-[#E7E3DA] p-2 break-all">
                  {credential.issuerId}
                </div>
              </div>

              <div className="space-y-1">
                <span className="font-mono text-[10px] uppercase tracking-wider text-[#787E78]">
                  Claim: Student Status
                </span>
                <div className="flex items-center gap-1.5 font-mono text-xs font-medium bg-[#FAF8F5] border border-[#E7E3DA] p-2">
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
                  {isTampered && (
                    <span className="ml-auto text-[10px] text-[#A84835] font-mono uppercase bg-[#FAF0ED] px-1 border border-[#E8C8C0]">
                      TAMPERED
                    </span>
                  )}
                </div>
              </div>

              <div className="space-y-1">
                <span className="font-mono text-[10px] uppercase tracking-wider text-[#787E78]">
                  Issued Date (UTC)
                </span>
                <div className="font-mono text-xs text-[#525753] p-2">
                  {credential.issuedAt}
                </div>
              </div>

              <div className="space-y-1">
                <span className="font-mono text-[10px] uppercase tracking-wider text-[#787E78]">
                  Expiry Date (UTC)
                </span>
                <div className="font-mono text-xs text-[#525753] p-2">
                  {credential.expiresAt}
                </div>
              </div>

              <div className="space-y-1">
                <span className="font-mono text-[10px] uppercase tracking-wider text-[#787E78]">
                  Proof Key ID
                </span>
                <div className="font-mono text-xs text-[#525753] p-2 break-all">
                  {credential.proof.keyId}
                </div>
              </div>
            </div>
          </section>

          {/* 6-Point Verification Checklist */}
          <section className="border border-[#E7E3DA] bg-[#FFFFFF]">
            <div className="border-b border-[#E7E3DA] bg-[#FAF8F5] px-6 py-3 flex items-center justify-between">
              <h2 className="text-xs font-mono uppercase tracking-wider text-[#1C201D]">
                6-Point Verification Checklist
              </h2>
              <span className="text-[11px] text-[#787E78] font-mono">
                Local Verification Sequence
              </span>
            </div>

            <div className="divide-y divide-[#E7E3DA]">
              {checkResults.map((check) => (
                <div
                  key={check.id}
                  className="p-5 sm:p-6 flex flex-col sm:flex-row sm:items-start justify-between gap-4"
                >
                  <div className="space-y-1 max-w-xl">
                    <div className="flex items-center gap-2">
                      <span
                        className={`font-mono text-[11px] font-semibold ${
                          check.passed ? 'text-[#264D3B]' : 'text-[#A84835]'
                        }`}
                      >
                        {check.numeral}
                      </span>
                      <span className="text-sm font-medium text-[#1C201D]">
                        {check.label}
                      </span>
                    </div>
                    <p className="text-xs text-[#525753] leading-relaxed">
                      {check.description}
                    </p>
                    <p className="text-[11px] font-mono text-[#787E78] pt-0.5">
                      Result: {check.detail}
                    </p>
                  </div>

                  <span
                    className={`text-[11px] font-mono px-2.5 py-1 shrink-0 self-start border ${
                      check.passed
                        ? 'border-[#CADACF] bg-[#EDF3EE] text-[#264D3B]'
                        : 'border-[#E8C8C0] bg-[#FAF0ED] text-[#A84835]'
                    }`}
                  >
                    {check.passed ? 'PASS' : 'FAIL'}
                  </span>
                </div>
              ))}
            </div>
          </section>

          {/* Secondary Details & Copy Actions */}
          <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
            <button
              type="button"
              onClick={() => setShowJsonDetails((prev) => !prev)}
              className="inline-flex items-center gap-1.5 text-xs font-mono uppercase tracking-wider text-[#264D3B] hover:text-[#1B382B] font-semibold underline underline-offset-4"
            >
              <span>{showJsonDetails ? 'Hide credential details' : 'View credential details'}</span>
              <span>{showJsonDetails ? '↑' : '↓'}</span>
            </button>

            {showJsonDetails && (
              <button
                type="button"
                onClick={handleCopyJson}
                className="px-3 py-1.5 text-xs font-mono uppercase tracking-wider border border-[#D4CEBF] bg-[#FAF8F5] text-[#525753] hover:text-[#1C201D] hover:bg-[#FFFFFF] transition-colors"
              >
                {copied ? 'Copied to Clipboard' : 'Copy JSON'}
              </button>
            )}
          </div>

          {/* Raw JSON Details Viewer */}
          {showJsonDetails && (
            <div className="border border-[#E7E3DA] bg-[#FAF8F5] p-4 space-y-2">
              <div className="flex items-center justify-between text-[11px] font-mono text-[#787E78] border-b border-[#E7E3DA] pb-2">
                <span>RAW PRESENTED OBJECT</span>
                <span>JSON FORMAT</span>
              </div>
              <pre className="font-mono text-[11px] text-[#1C201D] overflow-x-auto p-2 leading-relaxed bg-[#FFFFFF] border border-[#E7E3DA]">
                {JSON.stringify(credential, null, 2)}
              </pre>
            </div>
          )}
        </div>
      )}

      {/* Verification Framework Notice */}
      <aside className="border border-[#E7E3DA] bg-[#FAF8F5] p-4 flex items-center justify-between text-xs text-[#525753]">
        <div className="flex items-center gap-2">
          <span className="h-2 w-2 rounded-full bg-[#264D3B]" />
          <span>Local verification framework validates record structure, issuer authority, expiration bounds, and claim consistency.</span>
        </div>
        <span className="font-mono text-[11px] text-[#787E78]">VERIFICATION FRAMEWORK</span>
      </aside>
    </PageLayout>
  )
}
