import React, { useState, useEffect, useMemo } from 'react'
import { PageLayout, type StatusItem } from '../../components/PageLayout'
import type { AnyStudentCredential, VerifyCredentialResponse } from '../../types'
import { getSavedCredential } from '../../lib/demoStorage'
import { verifyRemoteCredential, type VerificationError } from '../../lib/verifierApi'
import { SpotlightCard } from '../../components/ui/react-bits/SpotlightCard'
import { DecryptedText } from '../../components/ui/react-bits/DecryptedText'
import { AnimatedList } from '../../components/ui/react-bits/AnimatedList'
import { CountUp } from '../../components/ui/react-bits/CountUp'

export const VerifierPortal: React.FC = () => {
  // Load saved credential from browser storage
  const [credential, setCredential] = useState<AnyStudentCredential | null>(() => getSavedCredential())
  const [isTampered, setIsTampered] = useState(false)
  const isLegacySimulation = Boolean(credential?.proof?.type === 'DemoSimulationProof')

  const [isVerifying, setIsVerifying] = useState(
    () => Boolean(credential && credential.proof?.type !== 'DemoSimulationProof')
  )
  const [verificationResult, setVerificationResult] = useState<VerifyCredentialResponse | null>(null)
  const [verificationError, setVerificationError] = useState<VerificationError | null>(null)
  const [verifiedAt, setVerifiedAt] = useState<number | null>(null)
  const [verifyTrigger, setVerifyTrigger] = useState(0)
  const [showJsonDetails, setShowJsonDetails] = useState(false)
  const [copied, setCopied] = useState(false)

  // Single authoritative effect to execute remote verification on mount or credential updates
  useEffect(() => {
    let isCancelled = false

    if (!credential || credential.proof?.type === 'DemoSimulationProof') {
      return
    }

    verifyRemoteCredential(credential).then((res) => {
      if (isCancelled) return
      setIsVerifying(false)
      setVerifiedAt(Date.now())
      if (res.success) {
        setVerificationResult(res.data)
        setVerificationError(null)
      } else {
        setVerificationResult(null)
        setVerificationError(res.error)
      }
    })

    return () => {
      isCancelled = true
    }
  }, [credential, verifyTrigger])

  // Action: Manual verification re-check (triggers verification effect without mutating credential)
  const handleVerify = () => {
    if (!credential || credential.proof?.type === 'DemoSimulationProof') return
    setIsVerifying(true)
    setVerifyTrigger((prev) => prev + 1)
  }

  // Action: Tamper with presented claims in memory (triggers verification effect via credential state change)
  const handleTamperTest = () => {
    if (!credential) return
    const currentStatus = credential.claims?.studentStatus || 'active'
    const newStatus = currentStatus === 'active' ? 'inactive' : 'active'

    const tampered: AnyStudentCredential = {
      ...credential,
      claims: {
        ...credential.claims,
        studentStatus: newStatus,
      },
    }

    setIsVerifying(true)
    setIsTampered(true)
    setCredential(tampered)
  }

  // Action: Restore the original untampered credential from storage (triggers verification effect via credential state change)
  const handleRestore = () => {
    const original = getSavedCredential()
    setIsVerifying(Boolean(original && original.proof?.type !== 'DemoSimulationProof'))
    setIsTampered(false)
    setCredential(original)
  }

  // Action: Copy JSON representation
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

  // Map authoritative backend checks to presentation checklist items
  const checkResults = useMemo(() => {
    if (!verificationResult) return []

    const { checks } = verificationResult

    return [
      {
        id: 'issuer',
        numeral: 'CHECK 01',
        label: 'Issuer Authority & Trust Anchor',
        description: 'Audits the credential issuer identifier and signing key ID against the registered institutional authority.',
        passed: checks.issuerTrusted,
        detail: checks.issuerTrusted
          ? 'Issuer authority registered and active in institutional registry.'
          : 'Issuer is unknown, unverified, or inactive.',
      },
      {
        id: 'signature',
        numeral: 'CHECK 02',
        label: 'Ed25519 Cryptographic Signature (RFC 8032)',
        description: 'Verifies the Ed25519 digital signature over canonical unsigned credential payload using the registered public key.',
        passed: checks.signatureValid,
        detail: checks.signatureValid
          ? 'Cryptographic signature is mathematically valid over canonical payload.'
          : isTampered
          ? 'Signature verification failed: payload modified from original signature (in-memory tamper detected).'
          : 'Signature verification failed: invalid signature or payload mismatch.',
      },
      {
        id: 'expiry',
        numeral: 'CHECK 03',
        label: 'Temporal Validity & Expiration Window',
        description: 'Audits credential temporal validity to confirm the expiration timestamp has not elapsed.',
        passed: !checks.expired,
        detail: !checks.expired
          ? `Credential is within valid temporal bounds (expiresAt: ${credential?.expiresAt}).`
          : `Credential has expired (expiresAt: ${credential?.expiresAt}).`,
      },
      {
        id: 'status',
        numeral: 'CHECK 04',
        label: 'Status Registry (Authoritative Revocation)',
        description: 'Queries the centralized status registry to confirm the credential has not been revoked by the issuer.',
        passed: !checks.revoked,
        detail: !checks.revoked
          ? 'Credential is confirmed active in status registry (not revoked).'
          : 'Credential has been formally revoked by the issuing authority.',
      },
      {
        id: 'claim',
        numeral: 'CHECK 05',
        label: 'Academic Enrollment Standing',
        description: 'Audits the studentStatus claim to confirm active institutional enrollment.',
        passed: checks.claimSatisfied,
        detail: checks.claimSatisfied
          ? 'Student status claim satisfies active institutional enrollment.'
          : `Student status claim is unsatisfied (${credential?.claims?.studentStatus || 'inactive'}).`,
      },
    ]
  }, [verificationResult, credential, isTampered])

  // Distinct verification states
  const isAccepted = Boolean(verificationResult?.valid)
  const isRejected = Boolean(verificationResult && !verificationResult.valid)
  const isServiceError = Boolean(verificationError)

  // Granular rejection reason
  const rejectionKind = useMemo<'revoked' | 'expired' | 'signature' | 'issuer' | 'claim' | 'unknown'>(() => {
    if (!verificationResult || verificationResult.valid) return 'unknown'
    const { checks } = verificationResult
    if (checks.revoked) return 'revoked'
    if (!checks.signatureValid) return 'signature'
    if (checks.expired) return 'expired'
    if (!checks.issuerTrusted) return 'issuer'
    if (!checks.claimSatisfied) return 'claim'
    return 'unknown'
  }, [verificationResult])

  const passedChecksCount = useMemo(() => {
    return checkResults.filter((c) => c.passed).length
  }, [checkResults])

  const statusItems: StatusItem[] = [
    {
      label: 'Verification Engine',
      value: 'Remote Edge Function',
      badge: 'forest',
    },
    {
      label: 'Presented Record',
      value: credential
        ? isLegacySimulation
          ? 'Legacy Simulated Record'
          : '1 Presented Record'
        : 'No Credential',
      badge: credential && !isLegacySimulation ? 'forest' : 'neutral',
    },
    {
      label: 'Audit Status',
      value: isVerifying
        ? 'Verifying...'
        : isLegacySimulation
        ? 'Unsupported'
        : isAccepted
        ? 'Accepted'
        : isRejected
        ? 'Rejected'
        : isServiceError
        ? 'Service Error'
        : 'Standby',
      badge: isAccepted
        ? 'forest'
        : isRejected
        ? 'terracotta'
        : 'neutral',
    },
    {
      label: 'Record State',
      value: isTampered
        ? 'Tampered (In-Memory)'
        : isAccepted
        ? 'Authentic'
        : credential
        ? 'Presented'
        : 'Standby',
      badge: isTampered
        ? 'terracotta'
        : isAccepted
        ? 'forest'
        : 'neutral',
    },
  ]

  return (
    <PageLayout
      sectionNumeral="SEC 03"
      sectionCategory="Third-Party Verification"
      title="Verification Desk"
      subtitle="Authoritative audit of academic verifiable credentials against live Supabase Edge Functions, Ed25519 cryptographic signatures, and institutional revocation registry."
      statusItems={statusItems}
    >
      {/* 1. STATE: No Stored Credential in Browser Storage */}
      {!credential ? (
        <section
          aria-label="Empty Verification Workspace"
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

          <div className="space-y-1.5 max-w-md mx-auto">
            <h2 className="text-base sm:text-lg font-semibold text-[#1C201D] tracking-tight">
              No Stored Credentials in Browser Storage
            </h2>
            <p className="text-xs sm:text-sm text-[#525753] leading-relaxed">
              Your browser storage currently contains zero credentials. To verify a student credential, open the Issuer Administration workspace and issue one first.
            </p>
          </div>

          <div className="pt-2">
            <span className="inline-block font-mono text-[11px] text-[#787E78] border border-[#E7E3DA] bg-[#FAF8F5] px-3.5 py-1.5 rounded-xs">
              STATUS: NO_CREDENTIAL_PRESENTED
            </span>
          </div>
        </section>
      ) : isLegacySimulation ? (
        /* 2. STATE: Legacy Simulated Credential Notice */
        <section
          aria-label="Legacy Credential Warning"
          className="border border-[#E8C8C0] bg-[#FFFFFF] p-6 sm:p-8 space-y-4 rounded-xs shadow-xs"
        >
          <div className="flex items-center gap-2">
            <span className="h-2.5 w-2.5 rounded-full bg-[#A84835]" />
            <h2 className="text-base font-semibold text-[#1C201D] tracking-tight">
              Legacy Simulated Credential Detected
            </h2>
          </div>
          <p className="text-xs text-[#525753] leading-relaxed max-w-2xl">
            This credential was generated with a simulated proof (<code className="font-mono text-[11px] text-[#1C201D] bg-[#FAF8F5] px-1 py-0.5 border border-[#E7E3DA]">DemoSimulationProof</code>) and cannot be cryptographically verified by the deployed Edge Function. Live verification strictly requires an authentic <code className="font-mono text-[11px] text-[#1C201D] bg-[#FAF8F5] px-1 py-0.5 border border-[#E7E3DA]">Ed25519Signature</code> credential.
          </p>
          <p className="text-xs text-[#525753] leading-relaxed">
            Please navigate to the <strong>Issuer Administration</strong> portal and issue a new credential to verify it against the live backend.
          </p>
          <div className="text-[11px] font-mono text-[#A84835] border-t border-[#E8C8C0] pt-4">
            STATUS: UNSUPPORTED_LEGACY_PROOF • REMOTE_VERIFICATION_DISABLED
          </div>
        </section>
      ) : (
        /* 3. ACTIVE VERIFICATION WORKSPACE */
        <div className="space-y-6 sm:space-y-8">
          {/* Large, Immediate Verification Verdict Banner */}
          <section
            aria-label="Verification Verdict"
            aria-live="polite"
            className={`border rounded-xs shadow-xs transition-all p-5 sm:p-7 ${
              isVerifying
                ? 'border-[#D4CEBF] bg-[#FAF8F5]'
                : isAccepted
                ? 'border-[#CADACF] bg-[#EDF3EE]/80'
                : isRejected
                ? 'border-[#E8C8C0] bg-[#FAF0ED]'
                : 'border-[#D4CEBF] bg-[#FAF8F5]'
            }`}
          >
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-5">
              <div className="space-y-2 flex-1">
                {/* Status Indicator & Main Heading */}
                <div className="flex items-center gap-3">
                  <div
                    className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full border ${
                      isVerifying
                        ? 'border-[#D4CEBF] bg-[#FAF8F5] text-[#525753]'
                        : isAccepted
                        ? 'border-[#CADACF] bg-[#264D3B] text-[#FFFFFF]'
                        : isRejected
                        ? 'border-[#E8C8C0] bg-[#A84835] text-[#FFFFFF]'
                        : 'border-[#D4CEBF] bg-[#787E78] text-[#FFFFFF]'
                    }`}
                  >
                    {isVerifying ? (
                      <svg className="animate-spin h-4 w-4" fill="none" viewBox="0 0 24 24" aria-hidden="true">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" />
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                      </svg>
                    ) : isAccepted ? (
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                        <polyline points="20 6 9 17 4 12" />
                      </svg>
                    ) : isRejected ? (
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                        <line x1="18" y1="6" x2="6" y2="18" />
                        <line x1="6" y1="6" x2="18" y2="18" />
                      </svg>
                    ) : (
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                        <circle cx="12" cy="12" r="10" />
                        <line x1="12" y1="8" x2="12" y2="12" />
                        <line x1="12" y1="16" x2="12.01" y2="16" />
                      </svg>
                    )}
                  </div>

                  <div>
                    <div className="flex items-center gap-2 flex-wrap">
                      <h2
                        className={`font-mono text-base sm:text-lg font-bold tracking-tight uppercase ${
                          isVerifying
                            ? 'text-[#525753]'
                            : isAccepted
                            ? 'text-[#1B382B]'
                            : isRejected
                            ? 'text-[#8A3726]'
                            : 'text-[#1C201D]'
                        }`}
                      >
                        {isVerifying
                          ? 'Executing Cryptographic Audit...'
                          : isAccepted
                          ? 'Official Credential Accepted & Verified'
                          : rejectionKind === 'revoked'
                          ? 'Credential Formally Revoked by Issuer'
                          : rejectionKind === 'signature'
                          ? 'Signature Tampering Detected (Invalid Proof)'
                          : rejectionKind === 'expired'
                          ? 'Credential Expired (Outside Temporal Validity)'
                          : rejectionKind === 'issuer'
                          ? 'Untrusted Issuing Authority'
                          : isRejected
                          ? 'Credential Rejected'
                          : 'Verification Service Unavailable'}
                      </h2>
                    </div>
                    <p className="text-xs sm:text-sm text-[#525753] mt-0.5">
                      {isVerifying
                        ? 'Authoritative Edge Function is validating Ed25519 signature and querying status registry...'
                        : isAccepted
                        ? 'All 5 cryptographic, institutional authority, and status registry requirements are satisfied.'
                        : rejectionKind === 'revoked'
                        ? 'The issuing authority marked this credential as revoked in the authoritative Supabase registry.'
                        : rejectionKind === 'signature'
                        ? isTampered
                          ? 'In-memory claim modification was detected: the canonical payload does not match the Ed25519 signature.'
                          : 'The cryptographic signature over the canonical payload is invalid or corrupted.'
                        : rejectionKind === 'expired'
                        ? `The credential validity timestamp (${credential.expiresAt}) has elapsed.`
                        : isRejected
                        ? verificationResult?.message || 'Credential failed authoritative verification audit.'
                        : verificationError
                        ? `Remote verification service error: ${verificationError.message}`
                        : 'Awaiting remote verification audit.'}
                    </p>
                  </div>
                </div>

                {/* Sub-bar with timestamp & score */}
                {verifiedAt && !isVerifying && verificationResult && (
                  <div className="flex flex-wrap items-center gap-3 font-mono text-[11px] text-[#787E78] pt-2 border-t border-[#E7E3DA]/80">
                    <span>
                      Evidence Score:{' '}
                      <strong className={isAccepted ? 'text-[#264D3B]' : 'text-[#A84835]'}>
                        <CountUp to={passedChecksCount} duration={0.8} /> / 5 Passed
                      </strong>
                    </span>
                    <span>•</span>
                    <span>Timestamp: {new Date(verifiedAt).toISOString()}</span>
                    <span>•</span>
                    <span>Algorithm: Ed25519 (RFC 8032)</span>
                  </div>
                )}
              </div>

              {/* Actions Area */}
              <div className="flex flex-wrap sm:flex-nowrap items-center gap-2.5 shrink-0 self-start md:self-center">
                <button
                  type="button"
                  onClick={handleVerify}
                  disabled={isVerifying}
                  className="px-4 py-2.5 text-xs font-mono uppercase tracking-wider bg-[#264D3B] text-[#FFFFFF] font-semibold border border-[#1B382B] hover:bg-[#1B382B] transition-colors rounded-xs shadow-xs cursor-pointer disabled:opacity-50 focus-visible:ring-2 focus-visible:ring-[#264D3B] focus-visible:outline-none"
                >
                  {isVerifying ? 'Auditing...' : 'Re-verify Credential'}
                </button>

                {!isTampered ? (
                  <button
                    type="button"
                    onClick={handleTamperTest}
                    disabled={isVerifying}
                    className="px-3.5 py-2.5 text-xs font-mono uppercase tracking-wider border border-[#E8C8C0] bg-[#FFFFFF] text-[#A84835] hover:bg-[#FAF0ED] transition-colors rounded-xs cursor-pointer font-medium disabled:opacity-50 focus-visible:ring-2 focus-visible:ring-[#A84835] focus-visible:outline-none"
                  >
                    Test Tamper Status
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={handleRestore}
                    disabled={isVerifying}
                    className="px-3.5 py-2.5 text-xs font-mono uppercase tracking-wider border border-[#CADACF] bg-[#FFFFFF] text-[#264D3B] hover:bg-[#EDF3EE] transition-colors rounded-xs cursor-pointer font-semibold disabled:opacity-50 focus-visible:ring-2 focus-visible:ring-[#264D3B] focus-visible:outline-none"
                  >
                    Restore Authentic
                  </button>
                )}
              </div>
            </div>
          </section>

          {/* Presented Credential Surface (SpotlightCard) */}
          <SpotlightCard
            spotlightColor={isAccepted ? 'rgba(38, 77, 59, 0.08)' : isRejected ? 'rgba(168, 72, 53, 0.06)' : 'rgba(38, 77, 59, 0.05)'}
            borderColor={isAccepted ? '#CADACF' : isRejected ? '#E8C8C0' : '#D4CEBF'}
            className="rounded-xs"
          >
            <div className="border-b border-[#E7E3DA] bg-[#FAF8F5] p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div className="flex items-center gap-2.5">
                <div className="flex h-7 w-7 items-center justify-center border border-[#D4CEBF] bg-[#FFFFFF] text-[#264D3B] font-semibold text-xs">
                  CR
                </div>
                <div>
                  <h3 className="font-mono text-xs font-semibold uppercase tracking-wider text-[#1C201D]">
                    Presented Credential Record
                  </h3>
                  <p className="text-[11px] text-[#787E78]">
                    Standard: {credential.type} • Canonical JCS Structure
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <span className="font-mono text-[10px] text-[#787E78] uppercase tracking-wider border border-[#E7E3DA] bg-[#FFFFFF] px-2 py-0.5 rounded-xs">
                  {credential.proof?.type}
                </span>
                {isTampered && (
                  <span className="font-mono text-[10px] text-[#A84835] font-semibold uppercase tracking-wider border border-[#E8C8C0] bg-[#FAF0ED] px-2 py-0.5 rounded-xs">
                    In-Memory Tampered
                  </span>
                )}
              </div>
            </div>

            <div className="p-5 sm:p-6 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 text-xs">
              <div className="p-3 bg-[#FAF8F5]/80 border border-[#E7E3DA] rounded-xs space-y-1">
                <span className="font-mono text-[10px] uppercase tracking-wider text-[#787E78] block">
                  Subject ID
                </span>
                <div className="font-mono text-xs text-[#1C201D] font-medium break-all">
                  {credential.subject.id}
                </div>
              </div>

              <div className="p-3 bg-[#FAF8F5]/80 border border-[#E7E3DA] rounded-xs space-y-1">
                <span className="font-mono text-[10px] uppercase tracking-wider text-[#787E78] block">
                  Issuer Authority
                </span>
                <div className="font-mono text-xs text-[#1C201D] font-medium break-all">
                  {credential.issuerId}
                </div>
              </div>

              <div className="p-3 bg-[#FAF8F5]/80 border border-[#E7E3DA] rounded-xs space-y-1">
                <span className="font-mono text-[10px] uppercase tracking-wider text-[#787E78] block">
                  Academic Standing Claim
                </span>
                <div className="flex items-center gap-1.5 font-mono text-xs font-medium">
                  <span
                    className={`h-2 w-2 rounded-full ${
                      credential.claims?.studentStatus === 'active'
                        ? 'bg-[#264D3B]'
                        : 'bg-[#A84835]'
                    }`}
                  />
                  <span className="uppercase text-[#1C201D] font-semibold">
                    {credential.claims?.studentStatus}
                  </span>
                  {isTampered && (
                    <span className="ml-auto text-[9px] text-[#A84835] font-mono uppercase bg-[#FAF0ED] px-1 border border-[#E8C8C0] rounded-2xs">
                      MODIFIED
                    </span>
                  )}
                </div>
              </div>

              <div className="p-3 bg-[#FAF8F5]/80 border border-[#E7E3DA] rounded-xs space-y-1">
                <span className="font-mono text-[10px] uppercase tracking-wider text-[#787E78] block">
                  Issued Date (UTC)
                </span>
                <div className="font-mono text-xs text-[#525753]">
                  {credential.issuedAt}
                </div>
              </div>

              <div className="p-3 bg-[#FAF8F5]/80 border border-[#E7E3DA] rounded-xs space-y-1">
                <span className="font-mono text-[10px] uppercase tracking-wider text-[#787E78] block">
                  Expiration Date (UTC)
                </span>
                <div className="font-mono text-xs text-[#525753]">
                  {credential.expiresAt}
                </div>
              </div>

              <div className="p-3 bg-[#FAF8F5]/80 border border-[#E7E3DA] rounded-xs space-y-1">
                <span className="font-mono text-[10px] uppercase tracking-wider text-[#787E78] block">
                  Signing Key ID
                </span>
                <div className="font-mono text-xs text-[#525753] break-all truncate">
                  <DecryptedText
                    text={credential.proof?.keyId || 'none'}
                    speed={25}
                    maxIterations={6}
                    className="text-[#1C201D]"
                  />
                </div>
              </div>
            </div>

            {/* Cryptographic Proof Ribbon */}
            <div className="border-t border-[#E7E3DA] bg-[#FAF8F5]/90 px-5 sm:px-6 py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs">
              <div className="space-y-0.5">
                <span className="font-mono text-[10px] text-[#787E78] uppercase tracking-wider">
                  Signature Fingerprint (Settled RFC 8032)
                </span>
                <div className="font-mono text-[11px] text-[#264D3B] break-all">
                  <DecryptedText
                    text={credential.proof?.signature || 'none'}
                    speed={15}
                    maxIterations={8}
                    className="text-[#264D3B]"
                  />
                </div>
              </div>

              <button
                type="button"
                onClick={() => setShowJsonDetails((prev) => !prev)}
                className="inline-flex items-center gap-1.5 text-xs font-mono uppercase tracking-wider text-[#264D3B] hover:text-[#1B382B] font-semibold underline underline-offset-4 cursor-pointer self-start sm:self-auto shrink-0"
              >
                <span>{showJsonDetails ? 'Hide Raw JSON ▲' : 'Inspect Raw JSON ▼'}</span>
              </button>
            </div>

            {/* Raw JSON Details Viewer */}
            {showJsonDetails && (
              <div className="border-t border-[#E7E3DA] bg-[#1C201D] text-[#EDF3EE] p-4 text-[11px] font-mono overflow-x-auto space-y-2">
                <div className="flex items-center justify-between text-[10px] text-[#787E78] border-b border-[#383F39] pb-2">
                  <span>CANONICAL JSON-LD REPRESENTATION</span>
                  <button
                    type="button"
                    onClick={handleCopyJson}
                    className="px-2 py-0.5 text-[10px] font-mono uppercase tracking-wider border border-[#525753] bg-[#2A302B] text-[#EDF3EE] hover:bg-[#383F39] rounded-2xs cursor-pointer"
                  >
                    {copied ? 'Copied to Clipboard' : 'Copy Payload'}
                  </button>
                </div>
                <pre className="overflow-x-auto leading-relaxed max-h-72">
                  {JSON.stringify(credential, null, 2)}
                </pre>
              </div>
            )}
          </SpotlightCard>

          {/* Authoritative 5-Point Verification Checklist (Evidence Presented via AnimatedList) */}
          {verificationResult && !isVerifying && (
            <section
              aria-label="Authoritative Verification Checklist"
              className="border border-[#D4CEBF] bg-[#FFFFFF] rounded-xs shadow-xs overflow-hidden"
            >
              <div className="border-b border-[#E7E3DA] bg-[#FAF8F5] px-5 sm:px-6 py-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                <div>
                  <h3 className="text-xs font-mono uppercase tracking-wider font-semibold text-[#1C201D]">
                    5-Point Authoritative Verification Checklist
                  </h3>
                  <p className="text-[11px] text-[#787E78] mt-0.5">
                    Evaluated via deployed verify-credential Edge Function and public registry key.
                  </p>
                </div>

                <div className="flex items-center gap-2 self-start sm:self-auto">
                  <span
                    className={`font-mono text-xs px-2.5 py-0.5 rounded-xs border font-semibold ${
                      isAccepted
                        ? 'border-[#CADACF] bg-[#EDF3EE] text-[#1B382B]'
                        : 'border-[#E8C8C0] bg-[#FAF0ED] text-[#8A3726]'
                    }`}
                  >
                    {passedChecksCount} of 5 Checks Satisfied
                  </span>
                </div>
              </div>

              <div className="p-4 sm:p-5">
                <AnimatedList staggerDelay={60} className="space-y-3">
                  {checkResults.map((check) => (
                    <div
                      key={check.id}
                      className={`p-4 sm:p-5 border rounded-xs transition-colors flex flex-col sm:flex-row sm:items-start justify-between gap-4 ${
                        check.passed
                          ? 'border-[#E7E3DA] bg-[#FFFFFF] hover:bg-[#FAF8F5]/50'
                          : 'border-[#E8C8C0] bg-[#FAF0ED]/40'
                      }`}
                    >
                      <div className="space-y-1.5 flex-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-mono text-[10px] font-semibold text-[#787E78] uppercase tracking-wider">
                            {check.numeral}
                          </span>
                          <span className="text-[#D4CEBF] text-xs">•</span>
                          <h4 className="text-sm font-semibold text-[#1C201D]">
                            {check.label}
                          </h4>
                        </div>
                        <p className="text-xs text-[#525753] leading-relaxed">
                          {check.description}
                        </p>
                        <div
                          className={`text-[11px] font-mono p-2 border rounded-xs mt-1 ${
                            check.passed
                              ? 'border-[#CADACF] bg-[#EDF3EE] text-[#1B382B]'
                              : 'border-[#E8C8C0] bg-[#FAF0ED] text-[#8A3726]'
                          }`}
                        >
                          <span className="font-bold mr-1.5">
                            {check.passed ? 'PASS:' : 'FAIL:'}
                          </span>
                          {check.detail}
                        </div>
                      </div>

                      <span
                        className={`text-[11px] font-mono px-3 py-1 shrink-0 self-start sm:self-center font-bold tracking-wider rounded-xs border ${
                          check.passed
                            ? 'border-[#CADACF] bg-[#EDF3EE] text-[#1B382B]'
                            : 'border-[#E8C8C0] bg-[#FAF0ED] text-[#8A3726]'
                        }`}
                      >
                        {check.passed ? 'PASSED' : 'FAILED'}
                      </span>
                    </div>
                  ))}
                </AnimatedList>
              </div>
            </section>
          )}

          {/* Service Error Notice */}
          {isServiceError && !isVerifying && (
            <div
              role="alert"
              className="border border-[#D4CEBF] bg-[#FAF8F5] p-5 text-xs text-[#525753] space-y-1.5 rounded-xs"
            >
              <div className="flex items-center justify-between font-semibold font-mono uppercase tracking-wider text-[#1C201D]">
                <span>Service Unavailable ({verificationError?.code})</span>
                {verificationError?.status && <span>HTTP {verificationError.status}</span>}
              </div>
              <p className="text-[#525753]">{verificationError?.message}</p>
              <p className="text-[11px] text-[#787E78] pt-1 border-t border-[#E7E3DA]">
                The credential could not be verified due to a remote service failure. This does not indicate that the credential is invalid or rejected.
              </p>
            </div>
          )}
        </div>
      )}

      {/* Verification Framework Notice */}
      <aside className="border border-[#E7E3DA] bg-[#FAF8F5] p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs text-[#525753] rounded-xs shadow-2xs">
        <div className="flex items-center gap-2">
          <span className="h-2 w-2 rounded-full bg-[#264D3B]" aria-hidden="true" />
          <span>Remote verification audits issuer authority, Ed25519 cryptographic signatures, validity timestamps, and status registry records.</span>
        </div>
        <span className="font-mono text-[11px] text-[#787E78]">REMOTE EDGE ENGINE</span>
      </aside>
    </PageLayout>
  )
}
