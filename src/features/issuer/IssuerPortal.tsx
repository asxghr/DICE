import React, { useState } from 'react'
import { PageLayout, type StatusItem } from '../../components/PageLayout'
import type { DemoStudentCredential, StudentStatus } from '../../types'
import { getSavedDemoCredential, saveDemoCredential } from '../../lib/demoStorage'

export const IssuerPortal: React.FC = () => {
  // Form fields
  const [subjectId, setSubjectId] = useState('')
  const [studentStatus, setStudentStatus] = useState<StudentStatus>('active')
  const [expiryDate, setExpiryDate] = useState(() => {
    // Default to exactly 1 year from today in YYYY-MM-DD
    const d = new Date()
    d.setFullYear(d.getFullYear() + 1)
    return d.toISOString().split('T')[0]
  })

  // State management
  const [validationError, setValidationError] = useState<string | null>(null)
  const [savedCredential, setSavedCredential] = useState<DemoStudentCredential | null>(() => getSavedDemoCredential())
  const [showJsonDetails, setShowJsonDetails] = useState(false)
  const [copied, setCopied] = useState(false)
  const [isCreatingNew, setIsCreatingNew] = useState(false)

  // Handle Form Submission
  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    setValidationError(null)

    const trimmedSubject = subjectId.trim()
    if (!trimmedSubject) {
      setValidationError('Subject ID is required and must not be empty.')
      return
    }

    if (!expiryDate) {
      setValidationError('Expiry date is required.')
      return
    }

    // Ensure expiry is strictly in the future
    const expiryMs = Date.parse(`${expiryDate}T23:59:59.999Z`)
    if (Number.isNaN(expiryMs) || expiryMs <= Date.now()) {
      setValidationError('Expiry date must be in the future.')
      return
    }

    // Generate local Demo Mode credential
    const issuedAt = new Date().toISOString()
    const expiresAt = new Date(`${expiryDate}T23:59:59.000Z`).toISOString()
    const credentialId = `urn:uuid:${
      typeof crypto.randomUUID === 'function'
        ? crypto.randomUUID()
        : '10000000-1000-4000-8000-100000000000'.replace(/[018]/g, (c) =>
            (
              Number(c) ^
              (crypto.getRandomValues(new Uint8Array(1))[0] & (15 >> (Number(c) / 4)))
            ).toString(16)
          )
    }`

    const newDemoCredential: DemoStudentCredential = {
      id: credentialId,
      type: 'StudentCredential',
      issuerId: 'svce-demo',
      subject: {
        id: trimmedSubject,
      },
      claims: {
        studentStatus,
      },
      issuedAt,
      expiresAt,
      proof: {
        type: 'DemoSimulationProof',
        keyId: 'svce-demo-key-v1-simulation',
        signature: 'SIMULATED_DEMO_PROOF_LOCAL_ONLY',
        simulationNote: 'Local frontend demonstration credential. Generated without backend private key.',
      },
      demoMode: true,
    }

    // Persist to localStorage
    saveDemoCredential(newDemoCredential)
    setSavedCredential(newDemoCredential)
    setIsCreatingNew(false)
    setShowJsonDetails(false)
  }

  // Action: Create another credential
  const handleCreateAnother = () => {
    setSubjectId('')
    setStudentStatus('active')
    const d = new Date()
    d.setFullYear(d.getFullYear() + 1)
    setExpiryDate(d.toISOString().split('T')[0])
    setValidationError(null)
    setIsCreatingNew(true)
    setShowJsonDetails(false)
  }

  // Action: Copy JSON to clipboard
  const handleCopyJson = async () => {
    if (!savedCredential) return
    try {
      await navigator.clipboard.writeText(JSON.stringify(savedCredential, null, 2))
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // Fallback if clipboard API is restricted
    }
  }

  const statusItems: StatusItem[] = [
    { label: 'Registered Authority', value: 'SVCE Registrar', badge: 'forest' },
    { label: 'Issuance Mode', value: 'Browser Storage', badge: 'forest' },
    { label: 'Storage Key', value: 'dice_demo_issued_credential', badge: 'neutral' },
    {
      label: 'Saved Status',
      value: savedCredential ? '1 Stored Record' : 'No Credential Saved',
      badge: savedCredential ? 'forest' : 'neutral',
    },
  ]

  return (
    <PageLayout
      sectionNumeral="SEC 01"
      sectionCategory="Registrar Administration"
      title="Issuer Administration"
      subtitle="Interface for formulating and issuing student credentials. Stored records are maintained in browser storage."
      statusItems={statusItems}
    >
      {/* SUCCESS STATE: Display saved credential */}
      {savedCredential && !isCreatingNew ? (
        <section
          aria-label="Issued Credential Record"
          className="border border-[#CADACF] bg-[#FFFFFF] space-y-0"
        >
          {/* Success Banner */}
          <div className="border-b border-[#CADACF] bg-[#EDF3EE] p-5 sm:p-6 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <span className="h-2 w-2 rounded-full bg-[#264D3B]" />
                <span className="font-mono text-xs font-semibold uppercase tracking-wider text-[#264D3B]">
                  Credential Successfully Issued
                </span>
              </div>
              <p className="text-xs text-[#525753]">
                Stored in browser storage (<code className="font-mono text-[11px] text-[#1C201D]">dice_demo_issued_credential</code>).
              </p>
            </div>

            <div className="flex items-center gap-2 shrink-0">
              <button
                type="button"
                onClick={handleCreateAnother}
                className="px-3.5 py-2 text-xs font-mono uppercase tracking-wider border border-[#D4CEBF] bg-[#FFFFFF] text-[#1C201D] hover:bg-[#FAF8F5] transition-colors"
              >
                Create Another Credential
              </button>
            </div>
          </div>

          {/* Core Metadata Table */}
          <div className="p-6 sm:p-8 space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-y-4 gap-x-8 text-xs border-b border-[#E7E3DA] pb-6">
              <div className="space-y-1">
                <div className="font-mono text-[11px] uppercase tracking-wider text-[#787E78]">
                  Credential ID
                </div>
                <div className="font-mono text-xs text-[#1C201D] font-medium break-all bg-[#FAF8F5] border border-[#E7E3DA] p-2">
                  {savedCredential.id}
                </div>
              </div>

              <div className="space-y-1">
                <div className="font-mono text-[11px] uppercase tracking-wider text-[#787E78]">
                  Subject ID
                </div>
                <div className="font-mono text-xs text-[#1C201D] font-medium break-all bg-[#FAF8F5] border border-[#E7E3DA] p-2">
                  {savedCredential.subject.id}
                </div>
              </div>

              <div className="space-y-1">
                <div className="font-mono text-[11px] uppercase tracking-wider text-[#787E78]">
                  Student Status
                </div>
                <div className="flex items-center gap-2 text-xs font-mono font-medium p-2">
                  <span
                    className={`h-2 w-2 rounded-full ${
                      savedCredential.claims.studentStatus === 'active'
                        ? 'bg-[#264D3B]'
                        : 'bg-[#A84835]'
                    }`}
                  />
                  <span className="uppercase tracking-wide text-[#1C201D]">
                    {savedCredential.claims.studentStatus}
                  </span>
                </div>
              </div>

              <div className="space-y-1">
                <div className="font-mono text-[11px] uppercase tracking-wider text-[#787E78]">
                  Issuing Authority
                </div>
                <div className="text-xs text-[#1C201D] font-mono p-2">
                  {savedCredential.issuerId} (Academic Registrar)
                </div>
              </div>

              <div className="space-y-1">
                <div className="font-mono text-[11px] uppercase tracking-wider text-[#787E78]">
                  Issued Date (UTC)
                </div>
                <div className="font-mono text-xs text-[#525753] p-2">
                  {savedCredential.issuedAt}
                </div>
              </div>

              <div className="space-y-1">
                <div className="font-mono text-[11px] uppercase tracking-wider text-[#787E78]">
                  Expiry Date (UTC)
                </div>
                <div className="font-mono text-xs text-[#525753] p-2">
                  {savedCredential.expiresAt}
                </div>
              </div>
            </div>

            {/* Actions & Detail Toggle */}
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
                  className="px-2.5 py-1 text-[11px] font-mono uppercase tracking-wider border border-[#D4CEBF] bg-[#FAF8F5] text-[#525753] hover:text-[#1C201D] hover:bg-[#FFFFFF] transition-colors"
                >
                  {copied ? 'Copied to Clipboard' : 'Copy JSON'}
                </button>
              )}
            </div>

            {/* Raw JSON Details Viewer */}
            {showJsonDetails && (
              <div className="border border-[#E7E3DA] bg-[#FAF8F5] p-4 space-y-2">
                <div className="flex items-center justify-between text-[11px] font-mono text-[#787E78] border-b border-[#E7E3DA] pb-2">
                  <span>RAW CANONICAL OBJECT</span>
                  <span>JSON FORMAT</span>
                </div>
                <pre className="font-mono text-[11px] text-[#1C201D] overflow-x-auto p-2 leading-relaxed bg-[#FFFFFF] border border-[#E7E3DA]">
                  {JSON.stringify(savedCredential, null, 2)}
                </pre>
              </div>
            )}
          </div>
        </section>
      ) : (
        /* FORM PANEL: Single primary panel for issuance */
        <section
          aria-label="Issue Credential Form"
          className="border border-[#E7E3DA] bg-[#FFFFFF] space-y-0"
        >
          {/* Form Header */}
          <div className="border-b border-[#E7E3DA] bg-[#FAF8F5] p-5 sm:p-6 flex flex-col sm:flex-row sm:items-baseline justify-between gap-2">
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-base font-semibold text-[#1C201D] tracking-tight">
                  Issue Student Credential
                </h2>
              </div>
              <p className="text-xs text-[#525753] mt-0.5">
                Formulate and issue an academic verifiable credential. Submitting will save the record to browser storage.
              </p>
            </div>

            {savedCredential && (
              <button
                type="button"
                onClick={() => setIsCreatingNew(false)}
                className="text-xs font-mono text-[#787E78] hover:text-[#1C201D] underline underline-offset-4"
              >
                Return to Saved Credential
              </button>
            )}
          </div>

          {/* Validation Error Feedback */}
          {validationError && (
            <div
              role="alert"
              className="m-6 border border-[#E8C8C0] bg-[#FAF0ED] p-4 text-xs text-[#A84835] space-y-1"
            >
              <div className="font-semibold font-mono uppercase tracking-wider">
                Validation Notice
              </div>
              <p>{validationError}</p>
            </div>
          )}

          {/* Interactive Form */}
          <form onSubmit={handleSubmit} className="p-6 sm:p-8 space-y-6">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
              {/* Field 1: Subject ID */}
              <div className="space-y-1.5 sm:col-span-2">
                <label
                  htmlFor="subjectId"
                  className="block font-mono text-xs uppercase tracking-wider text-[#525753]"
                >
                  Subject ID <span className="text-[#A84835]">*</span>
                </label>
                <input
                  id="subjectId"
                  type="text"
                  value={subjectId}
                  onChange={(e) => setSubjectId(e.target.value)}
                  placeholder="e.g. student-alice-123 or STU-2026-904"
                  className="w-full bg-[#FFFFFF] border border-[#D4CEBF] text-[#1C201D] px-3.5 py-2.5 text-sm font-mono focus:border-[#264D3B] focus:ring-1 focus:ring-[#264D3B] outline-none transition-colors"
                />
                <p className="text-[11px] text-[#787E78]">
                  Unique student identifier or enrollment record index.
                </p>
              </div>

              {/* Field 2: Student Status */}
              <div className="space-y-1.5">
                <span className="block font-mono text-xs uppercase tracking-wider text-[#525753]">
                  Student Status <span className="text-[#A84835]">*</span>
                </span>
                <div className="flex items-center gap-4 pt-1">
                  <label className="flex items-center gap-2 cursor-pointer text-xs font-medium text-[#1C201D]">
                    <input
                      type="radio"
                      name="studentStatus"
                      value="active"
                      checked={studentStatus === 'active'}
                      onChange={() => setStudentStatus('active')}
                      className="accent-[#264D3B]"
                    />
                    <span>Active (Enrolled)</span>
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer text-xs font-medium text-[#1C201D]">
                    <input
                      type="radio"
                      name="studentStatus"
                      value="inactive"
                      checked={studentStatus === 'inactive'}
                      onChange={() => setStudentStatus('inactive')}
                      className="accent-[#264D3B]"
                    />
                    <span>Inactive (Suspended/Alumni)</span>
                  </label>
                </div>
                <p className="text-[11px] text-[#787E78]">
                  Primary verifiable academic claim.
                </p>
              </div>

              {/* Field 3: Expiry Date */}
              <div className="space-y-1.5">
                <label
                  htmlFor="expiryDate"
                  className="block font-mono text-xs uppercase tracking-wider text-[#525753]"
                >
                  Expiry Date <span className="text-[#A84835]">*</span>
                </label>
                <input
                  id="expiryDate"
                  type="date"
                  value={expiryDate}
                  onChange={(e) => setExpiryDate(e.target.value)}
                  className="w-full bg-[#FFFFFF] border border-[#D4CEBF] text-[#1C201D] px-3.5 py-2 text-sm font-mono focus:border-[#264D3B] focus:ring-1 focus:ring-[#264D3B] outline-none transition-colors"
                />
                <p className="text-[11px] text-[#787E78]">
                  Validity end timestamp (must be strictly in the future).
                </p>
              </div>
            </div>

            {/* Storage Notice & Submit Action */}
            <div className="border-t border-[#E7E3DA] pt-6 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div className="text-[11px] text-[#787E78] space-y-0.5">
                <p className="font-mono text-[#525753]">
                  Browser Storage: Record saved to local client storage.
                </p>
                <p>Overwrites any existing credential in browser storage.</p>
              </div>

              <button
                type="submit"
                className="inline-flex items-center justify-center px-6 py-2.5 bg-[#264D3B] text-[#FFFFFF] text-xs font-mono uppercase tracking-wider font-semibold border border-[#1B382B] hover:bg-[#1B382B] transition-colors shadow-sm cursor-pointer"
              >
                Issue Credential
              </button>
            </div>
          </form>
        </section>
      )}

      {/* Information strip explaining credential storage */}
      <aside className="border border-[#E7E3DA] bg-[#FAF8F5] p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs text-[#525753]">
        <div className="flex items-center gap-2">
          <span className="h-2 w-2 rounded-full bg-[#264D3B]" />
          <span>Credentials persist in browser storage across refreshes and can be inspected in credential details.</span>
        </div>
        <span className="font-mono text-[11px] text-[#787E78]">STORAGE: ACTIVE</span>
      </aside>
    </PageLayout>
  )
}
