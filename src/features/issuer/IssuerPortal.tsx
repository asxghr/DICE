import React, { useEffect, useState } from 'react'
import { PageLayout, type StatusItem } from '../../components/PageLayout'
import type {
  AnyStudentCredential,
  IssuerRegistryStatus,
  StudentStatus,
} from '../../types'
import { getSavedCredential, saveCredential } from '../../lib/demoStorage'
import { isSupabaseConfigured, supabase } from '../../lib/supabase'
import {
  requestCredentialIssuance,
  requestCredentialRevocation,
  signInIssuer,
  signOutIssuer,
  type IssueCredentialError,
} from '../../lib/issuerApi'
import {
  initialIssuerRevocationState,
  startRevocationAttempt,
  failRevocationAttempt,
  succeedRevocationAttempt,
  resetRevocationState,
  deriveIssuerRegistryStatus,
  type IssuerRevocationState,
} from './issuerRevocationState'
import { SpotlightCard } from '../../components/ui/react-bits/SpotlightCard'
import { DecryptedText } from '../../components/ui/react-bits/DecryptedText'
import type { Session } from '@supabase/supabase-js'

export const IssuerPortal: React.FC = () => {
  // Session & Auth state
  const [session, setSession] = useState<Session | null>(null)
  const [authLoading, setAuthLoading] = useState(() => isSupabaseConfigured)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [isSigningIn, setIsSigningIn] = useState(false)
  const [signInError, setSignInError] = useState<string | null>(null)
  const [viewStoredWhileSignedOut, setViewStoredWhileSignedOut] = useState(false)

  // Form fields
  const [subjectId, setSubjectId] = useState('')
  const [studentStatus, setStudentStatus] = useState<StudentStatus>('active')
  const [expiryDate, setExpiryDate] = useState(() => {
    // Default to exactly 1 year from today in YYYY-MM-DD
    const d = new Date()
    d.setFullYear(d.getFullYear() + 1)
    return d.toISOString().split('T')[0]
  })

  // Issuance state management
  const [isIssuing, setIsIssuing] = useState(false)
  const [validationError, setValidationError] = useState<string | null>(null)
  const [backendError, setBackendError] = useState<IssueCredentialError | null>(null)
  const [savedCredential, setSavedCredential] = useState<AnyStudentCredential | null>(() =>
    getSavedCredential()
  )
  const [showJsonDetails, setShowJsonDetails] = useState(false)
  const [copied, setCopied] = useState(false)
  const [isCreatingNew, setIsCreatingNew] = useState(false)

  // Revocation & registry state management (atomic state container)
  const [revocationState, setRevocationState] = useState<IssuerRevocationState>(
    initialIssuerRevocationState
  )
  // Active revocation target match: ensures credential A state never appears for credential B
  const isMatchingTarget =
    Boolean(savedCredential) &&
    (revocationState.revocationTargetId === null ||
      revocationState.revocationTargetId === savedCredential?.id)

  const isRevoking = revocationState.isRevoking && isMatchingTarget
  const confirmRevoke = revocationState.confirmRevoke && isMatchingTarget
  const revocationData = isMatchingTarget ? revocationState.revocationData : null
  const revocationError = isMatchingTarget ? revocationState.revocationError : null

  // Helper to reset all transient revocation state
  const resetRevocationTransientState = () => {
    setRevocationState(resetRevocationState())
  }

  // Credential-change synchronization: reset transient state when active credential changes
  const prevCredentialIdRef = React.useRef(savedCredential?.id)
  useEffect(() => {
    if (prevCredentialIdRef.current !== savedCredential?.id) {
      prevCredentialIdRef.current = savedCredential?.id
      resetRevocationTransientState()
    }
  }, [savedCredential?.id])

  // Restore current session on mount and react to auth state changes
  useEffect(() => {
    if (!isSupabaseConfigured) {
      return
    }

    let isMounted = true

    supabase.auth
      .getSession()
      .then(({ data, error }) => {
        if (!isMounted) return
        if (!error && data.session) {
          setSession(data.session)
        } else {
          setSession(null)
        }
        setAuthLoading(false)
      })
      .catch(() => {
        if (!isMounted) return
        setSession(null)
        setAuthLoading(false)
      })

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, newSession) => {
      if (!isMounted) return
      setSession(newSession)
      if (!newSession) {
        setBackendError(null)
        resetRevocationTransientState()
      }
    })

    return () => {
      isMounted = false
      subscription.unsubscribe()
    }
  }, [])

  // Handle Sign-In Form Submission
  const handleSignIn = async (e: React.FormEvent) => {
    e.preventDefault()
    setSignInError(null)

    const trimmedEmail = email.trim()
    if (!trimmedEmail || !password) {
      setSignInError('Email and password are required.')
      return
    }

    setIsSigningIn(true)
    const result = await signInIssuer(trimmedEmail, password)
    setIsSigningIn(false)

    if (!result.success) {
      setSignInError(result.error || 'Authentication failed. Please verify your credentials.')
    } else {
      setPassword('')
      setSignInError(null)
    }
  }

  // Handle Sign-Out Action
  const handleSignOut = async () => {
    setSignInError(null)
    setBackendError(null)
    resetRevocationTransientState()
    setViewStoredWhileSignedOut(false)
    await signOutIssuer()
  }

  // Handle Credential Issuance Form Submission
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setValidationError(null)
    setBackendError(null)

    if (!isSupabaseConfigured) {
      setValidationError('Supabase configuration is missing. Live issuance is unavailable.')
      return
    }

    if (!session || !session.access_token) {
      setBackendError({
        code: 'UNAUTHENTICATED',
        message: 'Active issuer session required. Please sign in to issue credentials.',
        status: 401,
      })
      return
    }

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
    const expiryMs = Date.parse(`${expiryDate}T23:59:59.000Z`)
    if (Number.isNaN(expiryMs) || expiryMs <= Date.now()) {
      setValidationError('Expiry date must be in the future.')
      return
    }

    const expiresAtIso = new Date(`${expiryDate}T23:59:59.000Z`).toISOString()

    setIsIssuing(true)
    const result = await requestCredentialIssuance(
      {
        subjectId: trimmedSubject,
        studentStatus,
        expiresAt: expiresAtIso,
      },
      session.access_token
    )
    setIsIssuing(false)

    if (!result.success) {
      setBackendError(result.error)
      return
    }

    // Persist real backend credential into browser storage
    saveCredential(result.credential)
    setSavedCredential(result.credential)
    resetRevocationTransientState()
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
    setBackendError(null)
    resetRevocationTransientState()
    setIsCreatingNew(true)
    setShowJsonDetails(false)
  }

  // Action: Revoke current stored credential via authoritative Edge Function
  const handleRevoke = async () => {
    // 1. Clear transient result state from previous attempts at the start of every new attempt
    setRevocationState((prev) =>
      startRevocationAttempt(prev, savedCredential?.id ?? null)
    )

    // 2. Check if stored credential exists
    if (!savedCredential) {
      setRevocationState((prev) =>
        failRevocationAttempt(prev, {
          code: 'NO_CREDENTIAL',
          message: 'No stored credential available in browser storage to revoke.',
        })
      )
      return
    }

    // 3. Check for real Ed25519 signature proof (block legacy DemoSimulationProof)
    if (savedCredential.proof?.type !== 'Ed25519Signature') {
      setRevocationState((prev) =>
        failRevocationAttempt(prev, {
          code: 'SIMULATION_PROOF_NOT_SUPPORTED',
          message:
            'Simulated credentials cannot be revoked via backend Edge Functions. Only authentic credentials with Ed25519Signature proofs exist in the authoritative status registry.',
        })
      )
      return
    }

    // 4. Check for authenticated issuer session
    if (!session || !session.access_token) {
      setRevocationState((prev) =>
        failRevocationAttempt(prev, {
          code: 'UNAUTHENTICATED',
          message:
            'No authenticated issuer session found. An active session Bearer token is required to revoke credentials.',
          status: 401,
        })
      )
      return
    }

    const result = await requestCredentialRevocation(
      {
        credentialId: savedCredential.id,
        reasonCode: 'ISSUED_IN_ERROR',
      },
      session.access_token
    )

    if (!result.success) {
      setRevocationState((prev) => failRevocationAttempt(prev, result.error))
      return
    }

    // 5. Success: Record revocation response metadata
    setRevocationState((prev) => succeedRevocationAttempt(prev, result.data))
  }

  const handleCancelRevoke = () => {
    setRevocationState((prev) => ({
      ...prev,
      confirmRevoke: false,
      revocationError: null,
    }))
  }

  // Authoritative registry status state model derived from current credential and current attempt
  const registryStatus: IssuerRegistryStatus = deriveIssuerRegistryStatus(
    savedCredential,
    revocationState
  )

  // Action: Copy JSON to clipboard
  const handleCopyJson = async () => {
    if (!savedCredential) return
    try {
      await navigator.clipboard.writeText(JSON.stringify(savedCredential, null, 2))
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // Fallback
    }
  }

  const statusItems: StatusItem[] = [
    { label: 'Registered Authority', value: 'SVCE Registrar', badge: 'forest' },
    {
      label: 'Issuance Mode',
      value: isSupabaseConfigured ? 'Live Edge Function' : 'Backend Unconfigured',
      badge: isSupabaseConfigured ? 'forest' : 'neutral',
    },
    {
      label: 'Issuer Session',
      value: !isSupabaseConfigured
        ? 'Not Configured'
        : session
        ? 'Authenticated'
        : 'Signed Out',
      badge: session ? 'forest' : 'neutral',
    },
    {
      label: 'Saved Status',
      value: !savedCredential
        ? 'No Credential Saved'
        : registryStatus === 'REVOKED' || registryStatus === 'ALREADY_REVOKED'
        ? '1 Stored Record (Revoked)'
        : registryStatus === 'NOT_REGISTERED'
        ? '1 Stored Record (Unregistered)'
        : registryStatus === 'SIMULATED'
        ? '1 Stored Record (Simulated)'
        : '1 Stored Record (Unverified)',
      badge:
        registryStatus === 'REVOKED' ||
        registryStatus === 'ALREADY_REVOKED' ||
        registryStatus === 'NOT_REGISTERED'
          ? 'terracotta'
          : 'neutral',
    },
  ]

  return (
    <PageLayout
      sectionNumeral="SEC 01"
      sectionCategory="Registrar Administration"
      title="Issuer Administration"
      subtitle="Interface for formulating and cryptographically issuing verifiable student credentials via live Supabase Edge Functions and managing authoritative revocation."
      statusItems={statusItems}
    >
      {/* 1. STATE: Supabase Configuration Missing */}
      {!isSupabaseConfigured ? (
        <section
          aria-label="Configuration Notice"
          className="border border-[#E7E3DA] bg-[#FFFFFF] p-6 sm:p-8 space-y-4 rounded-xs shadow-xs"
        >
          <div className="flex items-center gap-2">
            <span className="h-2 w-2 rounded-full bg-[#A84835]" />
            <h2 className="text-base font-semibold text-[#1C201D] tracking-tight">
              Supabase Configuration Required
            </h2>
          </div>
          <p className="text-xs text-[#525753] leading-relaxed max-w-2xl">
            Live credential issuance requires connection to the deployed Supabase project.
            The environment variables <code className="font-mono text-[11px] text-[#1C201D] bg-[#FAF8F5] border border-[#E7E3DA] px-1 py-0.5">VITE_SUPABASE_URL</code> and <code className="font-mono text-[11px] text-[#1C201D] bg-[#FAF8F5] border border-[#E7E3DA] px-1 py-0.5">VITE_SUPABASE_PUBLISHABLE_KEY</code> are currently not configured.
          </p>
          <div className="text-[11px] font-mono text-[#787E78] border-t border-[#E7E3DA] pt-4">
            STATUS: CONFIGURATION_MISSING • ISSUANCE_DISABLED
          </div>
        </section>
      ) : authLoading ? (
        /* 2. STATE: Restoring Auth Session Loading */
        <section
          aria-label="Loading Session"
          className="border border-[#D4CEBF] bg-[#FFFFFF] p-8 sm:p-12 text-center space-y-3 rounded-xs shadow-xs"
        >
          <div className="inline-flex items-center justify-center h-9 w-9 border border-[#CADACF] bg-[#EDF3EE] text-[#264D3B] rounded-xs">
            <svg className="animate-spin h-5 w-5" fill="none" viewBox="0 0 24 24" aria-hidden="true">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
            </svg>
          </div>
          <div className="font-mono text-xs text-[#525753]">
            Restoring registrar session...
          </div>
        </section>
      ) : !session && !viewStoredWhileSignedOut ? (
        /* 3. STATE: User Signed Out - Authentication Panel */
        <section
          aria-label="Issuer Sign In"
          className="border border-[#D4CEBF] bg-[#FFFFFF] rounded-xs shadow-xs overflow-hidden"
        >
          <div className="border-b border-[#E7E3DA] bg-[#FAF8F5] p-5 sm:p-6">
            <div className="flex items-center gap-2">
              <span className="h-2 w-2 rounded-full bg-[#C4A44D]" aria-hidden="true" />
              <h2 className="text-base sm:text-lg font-semibold text-[#1C201D] tracking-tight">
                Issuer Administrator Authentication
              </h2>
            </div>
            <p className="text-xs sm:text-sm text-[#525753] mt-1">
              Sign in with institutional registrar credentials to formulate, cryptographically sign, or revoke verifiable student credentials.
            </p>
          </div>

          {savedCredential && (
            <div className="border-b border-[#E7E3DA] bg-[#FAF8F5]/80 px-6 py-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
              <div className="text-xs text-[#525753]">
                Stored record detected in browser storage: <span className="font-mono text-[#1C201D] font-medium">{savedCredential.id}</span>
              </div>
              <button
                type="button"
                onClick={() => setViewStoredWhileSignedOut(true)}
                className="text-xs font-mono uppercase tracking-wider text-[#264D3B] hover:text-[#1B382B] font-semibold underline underline-offset-4 cursor-pointer self-start sm:self-auto"
              >
                Inspect Stored Credential →
              </button>
            </div>
          )}

          {signInError && (
            <div
              role="alert"
              className="m-6 border border-[#E8C8C0] bg-[#FAF0ED] p-4 text-xs text-[#A84835] space-y-1 rounded-xs"
            >
              <div className="font-semibold font-mono uppercase tracking-wider">
                Authentication Failure
              </div>
              <p>{signInError}</p>
            </div>
          )}

          <form onSubmit={handleSignIn} className="p-6 sm:p-8 space-y-5 max-w-md">
            <div className="space-y-1.5">
              <label
                htmlFor="issuerEmail"
                className="block font-mono text-xs uppercase tracking-wider text-[#525753]"
              >
                Issuer Email <span className="text-[#A84835]">*</span>
              </label>
              <input
                id="issuerEmail"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="e.g. registrar@svce.edu"
                required
                className="w-full bg-[#FFFFFF] border border-[#D4CEBF] text-[#1C201D] px-3.5 py-2.5 text-sm font-mono rounded-xs focus:border-[#264D3B] focus:ring-1 focus:ring-[#264D3B] outline-none transition-colors"
              />
            </div>

            <div className="space-y-1.5">
              <label
                htmlFor="issuerPassword"
                className="block font-mono text-xs uppercase tracking-wider text-[#525753]"
              >
                Password <span className="text-[#A84835]">*</span>
              </label>
              <input
                id="issuerPassword"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••••••"
                required
                className="w-full bg-[#FFFFFF] border border-[#D4CEBF] text-[#1C201D] px-3.5 py-2.5 text-sm font-mono rounded-xs focus:border-[#264D3B] focus:ring-1 focus:ring-[#264D3B] outline-none transition-colors"
              />
            </div>

            <div className="pt-2">
              <button
                type="submit"
                disabled={isSigningIn}
                className="inline-flex items-center justify-center px-6 py-2.5 bg-[#264D3B] text-[#FFFFFF] text-xs font-mono uppercase tracking-wider font-semibold border border-[#1B382B] hover:bg-[#1B382B] transition-colors rounded-xs shadow-xs cursor-pointer disabled:opacity-50 focus-visible:ring-2 focus-visible:ring-[#264D3B] focus-visible:outline-none"
              >
                {isSigningIn ? 'Authenticating...' : 'Sign In to Issuer Portal'}
              </button>
            </div>

            <div className="text-[11px] text-[#787E78] border-t border-[#E7E3DA] pt-3">
              Access is restricted to authorized academic issuers. Self-registration is disabled.
            </div>
          </form>
        </section>
      ) : savedCredential && !isCreatingNew ? (
        /* 4. STATE: Display Saved Credential Record in SpotlightCard */
        <div className="space-y-6 sm:space-y-8">
          <SpotlightCard
            spotlightColor={registryStatus === 'REVOKED' || registryStatus === 'ALREADY_REVOKED' ? 'rgba(168, 72, 53, 0.08)' : 'rgba(38, 77, 59, 0.08)'}
            borderColor={registryStatus === 'REVOKED' || registryStatus === 'ALREADY_REVOKED' ? '#E8C8C0' : '#D4CEBF'}
            className="rounded-xs"
          >
            {/* Active Session & Navigation Bar */}
            {session ? (
              <div className="border-b border-[#E7E3DA] bg-[#FAF8F5] p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <span className="h-2 w-2 rounded-full bg-[#264D3B]" aria-hidden="true" />
                  <span className="text-xs font-mono text-[#525753]">
                    Issuer Session: <span className="text-[#1C201D] font-medium">{session.user.email}</span>
                  </span>
                </div>

                <div className="flex items-center gap-3">
                  <button
                    type="button"
                    onClick={handleCreateAnother}
                    className="text-xs font-mono text-[#264D3B] hover:text-[#1B382B] font-semibold underline underline-offset-4 cursor-pointer"
                  >
                    + Issue Another Credential
                  </button>
                  <button
                    type="button"
                    onClick={handleSignOut}
                    className="px-2.5 py-1 text-xs font-mono uppercase tracking-wider border border-[#D4CEBF] bg-[#FFFFFF] text-[#525753] hover:text-[#A84835] hover:border-[#E8C8C0] transition-colors rounded-xs cursor-pointer"
                  >
                    Sign Out
                  </button>
                </div>
              </div>
            ) : (
              <div className="border-b border-[#E7E3DA] bg-[#FAF8F5] p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <span className="h-2 w-2 rounded-full bg-[#C4A44D]" aria-hidden="true" />
                  <span className="text-xs font-mono text-[#525753]">
                    Issuer Session: <span className="text-[#A84835] font-medium">Signed Out</span> (Authentication required to issue or revoke)
                  </span>
                </div>

                <button
                  type="button"
                  onClick={() => setViewStoredWhileSignedOut(false)}
                  className="px-3.5 py-1.5 text-xs font-mono uppercase tracking-wider border border-[#264D3B] bg-[#264D3B] text-[#FFFFFF] hover:bg-[#1B382B] transition-colors rounded-xs cursor-pointer"
                >
                  Sign In to Issuer Portal
                </button>
              </div>
            )}

            {/* Banner: Registry Status Representation */}
            {registryStatus === 'REVOKED' ? (
              <div className="border-b border-[#E8C8C0] bg-[#FAF0ED] p-5 sm:p-6 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <span className="h-2 w-2 rounded-full bg-[#A84835]" />
                    <span className="font-mono text-xs font-semibold uppercase tracking-wider text-[#A84835]">
                      Credential Revoked on Authoritative Registry
                    </span>
                  </div>
                  <p className="text-xs text-[#525753]">
                    Revocation was confirmed by the deployed Edge Function. The credential remains stored locally, but will fail remote verification.
                  </p>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  <button
                    type="button"
                    onClick={handleCreateAnother}
                    className="px-3.5 py-2 text-xs font-mono uppercase tracking-wider border border-[#D4CEBF] bg-[#FFFFFF] text-[#1C201D] hover:bg-[#FAF8F5] transition-colors rounded-xs cursor-pointer"
                  >
                    Issue Another Credential
                  </button>
                </div>
              </div>
            ) : registryStatus === 'ALREADY_REVOKED' ? (
              <div className="border-b border-[#E8C8C0] bg-[#FAF0ED] p-5 sm:p-6 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <span className="h-2 w-2 rounded-full bg-[#A84835]" />
                    <span className="font-mono text-xs font-semibold uppercase tracking-wider text-[#A84835]">
                      Credential Previously Revoked (HTTP 409 Conflict)
                    </span>
                  </div>
                  <p className="text-xs text-[#525753]">
                    Authoritative status registry confirmed this credential was already revoked. It remains stored locally, but will fail remote verification.
                  </p>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  <button
                    type="button"
                    onClick={handleCreateAnother}
                    className="px-3.5 py-2 text-xs font-mono uppercase tracking-wider border border-[#D4CEBF] bg-[#FFFFFF] text-[#1C201D] hover:bg-[#FAF8F5] transition-colors rounded-xs cursor-pointer"
                  >
                    Issue Another Credential
                  </button>
                </div>
              </div>
            ) : registryStatus === 'NOT_REGISTERED' ? (
              <div className="border-b border-[#E8C8C0] bg-[#FAF0ED] p-5 sm:p-6 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <span className="h-2 w-2 rounded-full bg-[#A84835]" />
                    <span className="font-mono text-xs font-semibold uppercase tracking-wider text-[#A84835]">
                      Credential Not Found in Registry (HTTP 404)
                    </span>
                  </div>
                  <p className="text-xs text-[#525753]">
                    Authoritative status registry does not contain this credential ID. The record exists only in local storage.
                  </p>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  <button
                    type="button"
                    onClick={handleCreateAnother}
                    className="px-3.5 py-2 text-xs font-mono uppercase tracking-wider border border-[#D4CEBF] bg-[#FFFFFF] text-[#1C201D] hover:bg-[#FAF8F5] transition-colors rounded-xs cursor-pointer"
                  >
                    Issue Another Credential
                  </button>
                </div>
              </div>
            ) : registryStatus === 'STATUS_UNAVAILABLE' ? (
              <div className="border-b border-[#E7E3DA] bg-[#FAF8F5] p-5 sm:p-6 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <span className="h-2 w-2 rounded-full bg-[#787E78]" />
                    <span className="font-mono text-xs font-semibold uppercase tracking-wider text-[#1C201D]">
                      Registry Status Unavailable
                    </span>
                  </div>
                  <p className="text-xs text-[#525753]">
                    Unable to reach or authenticate with the authoritative status registry. The stored credential payload remains intact locally.
                  </p>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  <button
                    type="button"
                    onClick={handleCreateAnother}
                    className="px-3.5 py-2 text-xs font-mono uppercase tracking-wider border border-[#D4CEBF] bg-[#FFFFFF] text-[#1C201D] hover:bg-[#FAF8F5] transition-colors rounded-xs cursor-pointer"
                  >
                    Create Another Credential
                  </button>
                </div>
              </div>
            ) : registryStatus === 'SIMULATED' ? (
              <div className="border-b border-[#E7E3DA] bg-[#FAF8F5] p-5 sm:p-6 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <span className="h-2 w-2 rounded-full bg-[#787E78]" />
                    <span className="font-mono text-xs font-semibold uppercase tracking-wider text-[#525753]">
                      Simulated Credential Record (Local Only)
                    </span>
                  </div>
                  <p className="text-xs text-[#525753]">
                    Generated with simulated demo proof. Stored in browser storage (<code className="font-mono text-[11px] text-[#1C201D]">dice_demo_issued_credential</code>) and not registered on backend.
                  </p>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  <button
                    type="button"
                    onClick={handleCreateAnother}
                    className="px-3.5 py-2 text-xs font-mono uppercase tracking-wider border border-[#D4CEBF] bg-[#FFFFFF] text-[#1C201D] hover:bg-[#FAF8F5] transition-colors rounded-xs cursor-pointer"
                  >
                    Issue Authentic Credential
                  </button>
                </div>
              </div>
            ) : (
              <div className="border-b border-[#CADACF] bg-[#EDF3EE]/80 p-5 sm:p-6 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <span className="h-2 w-2 rounded-full bg-[#264D3B]" />
                    <span className="font-mono text-xs font-semibold uppercase tracking-wider text-[#1B382B]">
                      Credential Cryptographically Issued & Stored
                    </span>
                  </div>
                  <p className="text-xs text-[#525753]">
                    Signed with Ed25519Signature and persisted to browser storage. Authoritative registry status is verified when audited at the Verification Desk.
                  </p>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  <button
                    type="button"
                    onClick={handleCreateAnother}
                    className="px-3.5 py-2 text-xs font-mono uppercase tracking-wider border border-[#D4CEBF] bg-[#FFFFFF] text-[#1C201D] hover:bg-[#FAF8F5] transition-colors rounded-xs cursor-pointer"
                  >
                    Issue Another Credential
                  </button>
                </div>
              </div>
            )}

            {/* Core Metadata Table */}
            <div className="p-5 sm:p-7 space-y-6">
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 text-xs">
                <div className="p-3.5 bg-[#FAF8F5] border border-[#E7E3DA] rounded-xs space-y-1">
                  <div className="font-mono text-[10px] uppercase tracking-wider text-[#787E78]">
                    Credential ID
                  </div>
                  <div className="font-mono text-xs text-[#1C201D] font-medium break-all">
                    {savedCredential.id}
                  </div>
                </div>

                <div className="p-3.5 bg-[#FAF8F5] border border-[#E7E3DA] rounded-xs space-y-1">
                  <div className="font-mono text-[10px] uppercase tracking-wider text-[#787E78]">
                    Subject ID
                  </div>
                  <div className="font-mono text-xs text-[#1C201D] font-medium break-all">
                    {savedCredential.subject.id}
                  </div>
                </div>

                <div className="p-3.5 bg-[#FAF8F5] border border-[#E7E3DA] rounded-xs space-y-1">
                  <div className="font-mono text-[10px] uppercase tracking-wider text-[#787E78]">
                    Student Enrollment Status
                  </div>
                  <div className="flex items-center gap-2 text-xs font-mono font-medium pt-0.5">
                    <span
                      className={`h-2 w-2 rounded-full ${
                        savedCredential.claims.studentStatus === 'active'
                          ? 'bg-[#264D3B]'
                          : 'bg-[#A84835]'
                      }`}
                    />
                    <span className="uppercase tracking-wide text-[#1C201D] font-semibold">
                      {savedCredential.claims.studentStatus}
                    </span>
                  </div>
                </div>

                <div className="p-3.5 bg-[#FAF8F5] border border-[#E7E3DA] rounded-xs space-y-1">
                  <div className="font-mono text-[10px] uppercase tracking-wider text-[#787E78]">
                    Issuing Authority
                  </div>
                  <div className="text-xs text-[#1C201D] font-mono">
                    {savedCredential.issuerId} (Academic Registrar)
                  </div>
                </div>

                <div className="p-3.5 bg-[#FAF8F5] border border-[#E7E3DA] rounded-xs space-y-1">
                  <div className="font-mono text-[10px] uppercase tracking-wider text-[#787E78]">
                    Issued Date (UTC)
                  </div>
                  <div className="font-mono text-xs text-[#525753]">
                    {savedCredential.issuedAt}
                  </div>
                </div>

                <div className="p-3.5 bg-[#FAF8F5] border border-[#E7E3DA] rounded-xs space-y-1">
                  <div className="font-mono text-[10px] uppercase tracking-wider text-[#787E78]">
                    Expiry Date (UTC)
                  </div>
                  <div className="font-mono text-xs text-[#525753]">
                    {savedCredential.expiresAt}
                  </div>
                </div>
              </div>

              {/* Proof Object Display with DecryptedText */}
              <div className="border border-[#E7E3DA] bg-[#FAF8F5] p-4 sm:p-5 rounded-xs space-y-2 text-xs">
                <div className="flex items-center justify-between">
                  <span className="font-mono text-[11px] font-semibold uppercase tracking-wider text-[#525753]">
                    Cryptographic Proof Object (RFC 8032)
                  </span>
                  <span className="font-mono text-[10px] text-[#264D3B] bg-[#EDF3EE] border border-[#CADACF] px-2 py-0.5 uppercase rounded-2xs font-semibold">
                    {savedCredential.proof.type}
                  </span>
                </div>
                <div className="font-mono text-[11px] text-[#525753] break-all bg-[#FFFFFF] border border-[#E7E3DA] p-3 rounded-xs space-y-1">
                  <div>
                    <span className="text-[#787E78]">KeyID:</span>{' '}
                    <DecryptedText text={savedCredential.proof.keyId} speed={25} className="text-[#1C201D]" />
                  </div>
                  <div>
                    <span className="text-[#787E78]">Signature:</span>{' '}
                    <DecryptedText text={savedCredential.proof.signature} speed={15} className="text-[#264D3B]" />
                  </div>
                </div>
              </div>

              {/* Authoritative Revocation Administration Section */}
              <div className="border border-[#E7E3DA] bg-[#FFFFFF] p-5 sm:p-6 space-y-4 rounded-xs">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-[#E7E3DA] pb-3">
                  <div>
                    <h3 className="text-xs font-mono font-semibold uppercase tracking-wider text-[#1C201D]">
                      Authoritative Revocation Registry
                    </h3>
                    <p className="text-[11px] text-[#787E78] mt-0.5">
                      Manage credential lifecycle in the authoritative status registry via deployed Edge Function.
                    </p>
                  </div>
                  {registryStatus === 'REVOKED' ? (
                    <span className="font-mono text-[11px] font-semibold text-[#A84835] bg-[#FAF0ED] border border-[#E8C8C0] px-2.5 py-1 uppercase rounded-2xs self-start sm:self-auto">
                      STATUS: REVOKED
                    </span>
                  ) : registryStatus === 'ALREADY_REVOKED' ? (
                    <span className="font-mono text-[11px] font-semibold text-[#A84835] bg-[#FAF0ED] border border-[#E8C8C0] px-2.5 py-1 uppercase rounded-2xs self-start sm:self-auto">
                      STATUS: REVOKED (PRE-EXISTING)
                    </span>
                  ) : registryStatus === 'NOT_REGISTERED' ? (
                    <span className="font-mono text-[11px] font-semibold text-[#A84835] bg-[#FAF0ED] border border-[#E8C8C0] px-2.5 py-1 uppercase rounded-2xs self-start sm:self-auto">
                      STATUS: NOT_REGISTERED
                    </span>
                  ) : registryStatus === 'STATUS_UNAVAILABLE' ? (
                    <span className="font-mono text-[11px] font-semibold text-[#787E78] bg-[#FAF8F5] border border-[#E7E3DA] px-2.5 py-1 uppercase rounded-2xs self-start sm:self-auto">
                      STATUS: STATUS_UNAVAILABLE
                    </span>
                  ) : registryStatus === 'SIMULATED' ? (
                    <span className="font-mono text-[11px] font-semibold text-[#787E78] bg-[#FAF8F5] border border-[#E7E3DA] px-2.5 py-1 uppercase rounded-2xs self-start sm:self-auto">
                      STATUS: SIMULATED
                    </span>
                  ) : (
                    <span className="font-mono text-[11px] font-semibold text-[#525753] bg-[#FAF8F5] border border-[#D4CEBF] px-2.5 py-1 uppercase rounded-2xs self-start sm:self-auto">
                      STATUS: UNVERIFIED
                    </span>
                  )}
                </div>

                {/* Revocation Error Alert if any */}
                {revocationError && (
                  <div
                    role="alert"
                    className="border border-[#E8C8C0] bg-[#FAF0ED] p-4 text-xs text-[#A84835] space-y-1.5 rounded-xs"
                  >
                    <div className="flex items-center justify-between font-semibold font-mono uppercase tracking-wider">
                      <span>
                        Revocation Failure: {revocationError.code}
                        {revocationError.status ? ` (HTTP ${revocationError.status})` : ''}
                      </span>
                      <button
                        type="button"
                        onClick={() =>
                          setRevocationState((prev) => ({
                            ...prev,
                            revocationError: null,
                          }))
                        }
                        className="text-[#A84835] hover:text-[#1C201D] font-mono text-xs cursor-pointer"
                      >
                        ✕
                      </button>
                    </div>
                    <p>{revocationError.message}</p>
                    {revocationError.code === 'ALREADY_REVOKED' && (
                      <p className="text-[11px] text-[#787E78] border-t border-[#E8C8C0] pt-1.5">
                        Authoritative Conflict: This credential was previously marked as revoked in the database.
                      </p>
                    )}
                    {revocationError.code === 'CREDENTIAL_NOT_FOUND' && (
                      <p className="text-[11px] text-[#787E78] border-t border-[#E8C8C0] pt-1.5">
                        Authoritative 404: The credential ID does not exist in the status registry.
                      </p>
                    )}
                    {revocationError.code === 'NOT_AUTHORIZED' && (
                      <p className="text-[11px] text-[#787E78] border-t border-[#E8C8C0] pt-1.5">
                        Access Denied 403: Your account is not authorized as an issuer administrator for this record.
                      </p>
                    )}
                    {revocationError.code === 'UNAUTHENTICATED' && (
                      <p className="text-[11px] text-[#787E78] border-t border-[#E8C8C0] pt-1.5">
                        Session Expired 401: Please sign in again with authorized issuer credentials.
                      </p>
                    )}
                    {revocationError.code === 'REVOCATION_FAILED' && (
                      <p className="text-[11px] text-[#787E78] border-t border-[#E8C8C0] pt-1.5">
                        Server Error 500: Revocation processing failed on the Edge Function.
                      </p>
                    )}
                  </div>
                )}

                {/* Case 1: Successfully Revoked */}
                {revocationData?.revoked ? (
                  <div className="border border-[#E8C8C0] bg-[#FAF0ED] p-4 sm:p-5 space-y-3 rounded-xs">
                    <div className="flex items-center gap-2">
                      <span className="h-2 w-2 rounded-full bg-[#A84835]" />
                      <span className="font-mono text-xs font-semibold uppercase tracking-wider text-[#A84835]">
                        Authoritative Revocation Confirmed
                      </span>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs font-mono bg-[#FFFFFF] border border-[#E8C8C0] p-3 rounded-xs">
                      <div>
                        <span className="text-[#787E78] block text-[10px] uppercase">Credential ID</span>
                        <span className="text-[#1C201D] font-medium break-all">{revocationData.credentialId}</span>
                      </div>
                      <div>
                        <span className="text-[#787E78] block text-[10px] uppercase">Revocation Status</span>
                        <span className="text-[#A84835] font-semibold">{revocationData.revoked ? 'TRUE (REVOKED)' : 'FALSE'}</span>
                      </div>
                      <div>
                        <span className="text-[#787E78] block text-[10px] uppercase">Registry Timestamp (UTC)</span>
                        <span className="text-[#525753] break-all">{revocationData.updatedAt}</span>
                      </div>
                    </div>

                    <div className="text-[11px] text-[#525753] space-y-1 border-t border-[#E8C8C0] pt-3">
                      <p className="font-medium text-[#1C201D]">
                        Storage Notice: Credential payload remains preserved locally in browser storage.
                      </p>
                      <p>
                        Remote verification audits at the Verification Desk will now query the authoritative status registry and reject this credential with <span className="font-mono text-[#A84835]">CHECK 04 (Revocation Status): FAILED</span>.
                      </p>
                    </div>
                  </div>
                ) : registryStatus === 'ALREADY_REVOKED' ? (
                  /* Case 1b: Pre-existing revocation conflict (HTTP 409) */
                  <div className="border border-[#E8C8C0] bg-[#FAF0ED] p-4 sm:p-5 space-y-3 rounded-xs">
                    <div className="flex items-center gap-2">
                      <span className="h-2 w-2 rounded-full bg-[#A84835]" />
                      <span className="font-mono text-xs font-semibold uppercase tracking-wider text-[#A84835]">
                        Pre-Existing Revocation Confirmed (Registry Conflict)
                      </span>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs font-mono bg-[#FFFFFF] border border-[#E8C8C0] p-3 rounded-xs">
                      <div>
                        <span className="text-[#787E78] block text-[10px] uppercase">Credential ID</span>
                        <span className="text-[#1C201D] font-medium break-all">{savedCredential.id}</span>
                      </div>
                      <div>
                        <span className="text-[#787E78] block text-[10px] uppercase">Authoritative Registry Status</span>
                        <span className="text-[#A84835] font-semibold">REVOKED (PRE-EXISTING)</span>
                      </div>
                    </div>

                    <div className="text-[11px] text-[#525753] space-y-1 border-t border-[#E8C8C0] pt-3">
                      <p className="font-medium text-[#1C201D]">
                        Authoritative Conflict Notice (HTTP 409):
                      </p>
                      <p>
                        The remote status registry confirmed that this credential was already marked as revoked prior to this request.
                      </p>
                    </div>

                    <div className="pt-2 border-t border-[#E8C8C0]">
                      <button
                        type="button"
                        onClick={() =>
                          setRevocationState((prev) => ({
                            ...prev,
                            confirmRevoke: true,
                            revocationError: null,
                          }))
                        }
                        className="px-3.5 py-1.5 text-xs font-mono uppercase tracking-wider border border-[#D4CEBF] bg-[#FFFFFF] text-[#525753] hover:text-[#1C201D] hover:bg-[#FAF8F5] transition-colors rounded-xs cursor-pointer"
                      >
                        Retry Revocation Request
                      </button>
                    </div>
                  </div>
                ) : registryStatus === 'NOT_REGISTERED' ? (
                  /* Case 1c: Credential not found in registry (HTTP 404) */
                  <div className="border border-[#E8C8C0] bg-[#FAF0ED] p-4 sm:p-5 space-y-3 rounded-xs">
                    <div className="flex items-center gap-2">
                      <span className="h-2 w-2 rounded-full bg-[#A84835]" />
                      <span className="font-mono text-xs font-semibold uppercase tracking-wider text-[#A84835]">
                        Registry Lookup Failed: Not Registered
                      </span>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs font-mono bg-[#FFFFFF] border border-[#E8C8C0] p-3 rounded-xs">
                      <div>
                        <span className="text-[#787E78] block text-[10px] uppercase">Credential ID</span>
                        <span className="text-[#1C201D] font-medium break-all">{savedCredential.id}</span>
                      </div>
                      <div>
                        <span className="text-[#787E78] block text-[10px] uppercase">Authoritative Registry Status</span>
                        <span className="text-[#A84835] font-semibold">NOT_REGISTERED (HTTP 404)</span>
                      </div>
                    </div>

                    <div className="text-[11px] text-[#525753] space-y-1 border-t border-[#E8C8C0] pt-3">
                      <p className="font-medium text-[#1C201D]">
                        Authoritative 404 Notice:
                      </p>
                      <p>
                        The remote status registry does not contain this credential ID. The record exists only in local storage and cannot be revoked on the backend.
                      </p>
                    </div>

                    <div className="pt-2 border-t border-[#E8C8C0]">
                      <button
                        type="button"
                        onClick={() =>
                          setRevocationState((prev) => ({
                            ...prev,
                            confirmRevoke: true,
                            revocationError: null,
                          }))
                        }
                        className="px-3.5 py-1.5 text-xs font-mono uppercase tracking-wider border border-[#D4CEBF] bg-[#FFFFFF] text-[#525753] hover:text-[#1C201D] hover:bg-[#FAF8F5] transition-colors rounded-xs cursor-pointer"
                      >
                        Retry Revocation Request
                      </button>
                    </div>
                  </div>
                ) : savedCredential.proof?.type !== 'Ed25519Signature' ? (
                  /* Case 2: Legacy simulated credential */
                  <div className="border border-[#E7E3DA] bg-[#FAF8F5] p-4 text-xs space-y-2 rounded-xs">
                    <div className="flex items-center gap-2">
                      <span className="h-2 w-2 rounded-full bg-[#787E78]" />
                      <span className="font-mono text-xs font-medium uppercase tracking-wider text-[#525753]">
                        Simulated Credential — Backend Revocation Not Applicable
                      </span>
                    </div>
                    <p className="text-[#787E78] leading-relaxed">
                      This record contains a simulated demo proof (<code className="font-mono text-[11px] text-[#1C201D]">{savedCredential.proof?.type}</code>).
                      Only authentic credentials signed by the live Edge Function with <code className="font-mono text-[11px] text-[#1C201D]">Ed25519Signature</code> proofs exist in the remote database.
                    </p>
                  </div>
                ) : !session ? (
                  /* Case 3: No authenticated issuer session */
                  <div className="border border-[#E7E3DA] bg-[#FAF8F5] p-4 text-xs space-y-2 rounded-xs">
                    <div className="flex items-center gap-2">
                      <span className="h-2 w-2 rounded-full bg-[#C4A44D]" />
                      <span className="font-mono text-xs font-semibold uppercase tracking-wider text-[#1C201D]">
                        Issuer Authentication Required
                      </span>
                    </div>
                    <p className="text-[#525753]">
                      An active authenticated issuer session is required to revoke credentials. Please sign in with authorized issuer administrator credentials.
                    </p>
                    <button
                      type="button"
                      onClick={() => setViewStoredWhileSignedOut(false)}
                      className="px-3.5 py-1.5 text-xs font-mono uppercase tracking-wider border border-[#264D3B] bg-[#264D3B] text-[#FFFFFF] hover:bg-[#1B382B] transition-colors rounded-xs cursor-pointer"
                    >
                      Sign In to Issuer Portal
                    </button>
                  </div>
                ) : confirmRevoke ? (
                  /* Case 4: Confirmation Prompt */
                  <div
                    role="region"
                    aria-label="Revocation Confirmation"
                    className="border border-[#E8C8C0] bg-[#FAF0ED] p-5 space-y-4 rounded-xs"
                  >
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <span className="h-2 w-2 rounded-full bg-[#A84835]" />
                        <h4 className="text-xs font-mono font-semibold uppercase tracking-wider text-[#A84835]">
                          Confirm Credential Revocation
                        </h4>
                      </div>
                      <p className="text-xs text-[#525753] leading-relaxed">
                        Are you sure you want to revoke credential <code className="font-mono text-[11px] text-[#1C201D] bg-[#FFFFFF] px-1 py-0.5 border border-[#E8C8C0]">{savedCredential.id}</code>?
                        This will transmit an authorized revocation request with reason code <code className="font-mono text-[11px] text-[#1C201D] bg-[#FFFFFF] px-1 py-0.5 border border-[#E8C8C0]">ISSUED_IN_ERROR</code> to the deployed Edge Function and permanently mark the record as revoked.
                      </p>
                      <p className="text-[11px] text-[#A84835] font-medium pt-1">
                        ⚠️ This action is irreversible in the authoritative status registry.
                      </p>
                    </div>

                    <div className="flex flex-wrap items-center gap-3 pt-1">
                      <button
                        type="button"
                        onClick={handleRevoke}
                        disabled={isRevoking}
                        className="inline-flex items-center justify-center px-4 py-2 bg-[#A84835] text-[#FFFFFF] text-xs font-mono uppercase tracking-wider font-semibold border border-[#8F3B2A] hover:bg-[#8F3B2A] transition-colors rounded-xs cursor-pointer disabled:opacity-50"
                      >
                        {isRevoking ? 'Revoking on Remote Registry...' : 'Yes, Revoke Credential'}
                      </button>

                      <button
                        type="button"
                        onClick={handleCancelRevoke}
                        disabled={isRevoking}
                        className="px-3.5 py-2 text-xs font-mono uppercase tracking-wider border border-[#D4CEBF] bg-[#FFFFFF] text-[#525753] hover:text-[#1C201D] hover:bg-[#FAF8F5] transition-colors rounded-xs cursor-pointer disabled:opacity-50"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : (
                  /* Case 5: Ready to revoke button */
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-[#FAF8F5] border border-[#E7E3DA] p-4 rounded-xs">
                    <div className="text-xs text-[#525753] space-y-0.5">
                      <div className="font-mono text-[11px] text-[#1C201D] font-medium">
                        {registryStatus === 'STATUS_UNAVAILABLE'
                          ? 'Authoritative Status: Unavailable (Ready to Retry)'
                          : 'Revocation Authority: SVCE Registrar'}
                      </div>
                      <p className="text-[11px] text-[#787E78]">
                        {registryStatus === 'STATUS_UNAVAILABLE'
                          ? 'A previous request encountered a service or network error. You may retry revocation against the deployed Edge Function.'
                          : 'Transmits an authenticated revocation request with reason code ISSUED_IN_ERROR.'}
                      </p>
                    </div>

                    <button
                      type="button"
                      onClick={() =>
                        setRevocationState((prev) => ({
                          ...prev,
                          confirmRevoke: true,
                          revocationError: null,
                        }))
                      }
                      className="px-4 py-2 text-xs font-mono uppercase tracking-wider font-semibold border border-[#E8C8C0] bg-[#FFFFFF] text-[#A84835] hover:bg-[#FAF0ED] hover:border-[#A84835] transition-colors rounded-xs cursor-pointer shrink-0"
                    >
                      {registryStatus === 'STATUS_UNAVAILABLE' ? 'Retry Revocation' : 'Revoke Credential'}
                    </button>
                  </div>
                )}
              </div>

              {/* Actions & Detail Toggle */}
              <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setShowJsonDetails((prev) => !prev)}
                  className="inline-flex items-center gap-1.5 text-xs font-mono uppercase tracking-wider text-[#264D3B] hover:text-[#1B382B] font-semibold underline underline-offset-4 cursor-pointer"
                >
                  <span>{showJsonDetails ? 'Hide credential details' : 'View credential details'}</span>
                  <span>{showJsonDetails ? '↑' : '↓'}</span>
                </button>

                {showJsonDetails && (
                  <button
                    type="button"
                    onClick={handleCopyJson}
                    className="px-2.5 py-1 text-[11px] font-mono uppercase tracking-wider border border-[#D4CEBF] bg-[#FAF8F5] text-[#525753] hover:text-[#1C201D] hover:bg-[#FFFFFF] transition-colors rounded-xs cursor-pointer"
                  >
                    {copied ? 'Copied to Clipboard' : 'Copy JSON'}
                  </button>
                )}
              </div>

              {/* Raw JSON Details Viewer */}
              {showJsonDetails && (
                <div className="border border-[#E7E3DA] bg-[#FAF8F5] p-4 space-y-2 rounded-xs">
                  <div className="flex items-center justify-between text-[11px] font-mono text-[#787E78] border-b border-[#E7E3DA] pb-2">
                    <span>RAW CANONICAL OBJECT</span>
                    <span>JSON FORMAT</span>
                  </div>
                  <pre className="font-mono text-[11px] text-[#1C201D] overflow-x-auto p-2 leading-relaxed bg-[#FFFFFF] border border-[#E7E3DA] rounded-xs">
                    {JSON.stringify(savedCredential, null, 2)}
                  </pre>
                </div>
              )}
            </div>
          </SpotlightCard>
        </div>
      ) : (
        /* 5. STATE: User Signed In - Issuance Form Panel */
        <section
          aria-label="Issue Credential Form"
          className="border border-[#D4CEBF] bg-[#FFFFFF] rounded-xs shadow-xs overflow-hidden"
        >
          {/* Active Session & Navigation Bar */}
          <div className="border-b border-[#E7E3DA] bg-[#FAF8F5] p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <span className="h-2 w-2 rounded-full bg-[#264D3B]" aria-hidden="true" />
              <span className="text-xs font-mono text-[#525753]">
                Issuer Session: <span className="text-[#1C201D] font-medium">{session?.user?.email || 'Authenticated'}</span>
              </span>
            </div>

            <div className="flex items-center gap-3">
              {savedCredential && (
                <button
                  type="button"
                  onClick={() => setIsCreatingNew(false)}
                  className="text-xs font-mono text-[#787E78] hover:text-[#1C201D] underline underline-offset-4 cursor-pointer"
                >
                  Return to Saved Credential
                </button>
              )}
              <button
                type="button"
                onClick={handleSignOut}
                className="px-2.5 py-1 text-xs font-mono uppercase tracking-wider border border-[#D4CEBF] bg-[#FFFFFF] text-[#525753] hover:text-[#A84835] hover:border-[#E8C8C0] transition-colors rounded-xs cursor-pointer"
              >
                Sign Out
              </button>
            </div>
          </div>

          {/* Form Description Header */}
          <div className="p-5 sm:p-6 border-b border-[#E7E3DA]">
            <h2 className="text-base sm:text-lg font-semibold text-[#1C201D] tracking-tight">
              Issue Verifiable Student Credential
            </h2>
            <p className="text-xs sm:text-sm text-[#525753] mt-0.5">
              Submitting transmits the payload to the live <code className="font-mono text-[11px] text-[#1C201D] bg-[#FAF8F5] px-1 py-0.5 border border-[#E7E3DA]">issue-credential</code> Edge Function for cryptographic Ed25519 signing.
            </p>
          </div>

          {/* Client-side Validation Notice */}
          {validationError && (
            <div
              role="alert"
              className="m-6 border border-[#E8C8C0] bg-[#FAF0ED] p-4 text-xs text-[#A84835] space-y-1 rounded-xs"
            >
              <div className="font-semibold font-mono uppercase tracking-wider">
                Validation Notice
              </div>
              <p>{validationError}</p>
            </div>
          )}

          {/* Backend Error Notice */}
          {backendError && (
            <div
              role="alert"
              className="m-6 border border-[#E8C8C0] bg-[#FAF0ED] p-4 text-xs text-[#A84835] space-y-1 rounded-xs"
            >
              <div className="flex items-center justify-between font-semibold font-mono uppercase tracking-wider">
                <span>Backend Error ({backendError.code})</span>
                {backendError.status && <span>HTTP {backendError.status}</span>}
              </div>
              <p>{backendError.message}</p>
            </div>
          )}

          {/* Interactive Issuance Form */}
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
                  required
                  className="w-full bg-[#FFFFFF] border border-[#D4CEBF] text-[#1C201D] px-3.5 py-2.5 text-sm font-mono rounded-xs focus:border-[#264D3B] focus:ring-1 focus:ring-[#264D3B] outline-none transition-colors"
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
                  required
                  className="w-full bg-[#FFFFFF] border border-[#D4CEBF] text-[#1C201D] px-3.5 py-2 text-sm font-mono rounded-xs focus:border-[#264D3B] focus:ring-1 focus:ring-[#264D3B] outline-none transition-colors"
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
                  Cryptographic Issuance: Handled by live Supabase Edge Function.
                </p>
                <p>Upon success, signed credential is saved to browser storage.</p>
              </div>

              <button
                type="submit"
                disabled={isIssuing}
                className="inline-flex items-center justify-center px-6 py-2.5 bg-[#264D3B] text-[#FFFFFF] text-xs font-mono uppercase tracking-wider font-semibold border border-[#1B382B] hover:bg-[#1B382B] transition-colors rounded-xs shadow-xs cursor-pointer disabled:opacity-50 focus-visible:ring-2 focus-visible:ring-[#264D3B] focus-visible:outline-none"
              >
                {isIssuing ? 'Issuing Credential (Requesting Signature)...' : 'Issue Credential'}
              </button>
            </div>
          </form>
        </section>
      )}

      {/* Information strip explaining credential storage */}
      <aside className="border border-[#E7E3DA] bg-[#FAF8F5] p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs text-[#525753] rounded-xs shadow-2xs">
        <div className="flex items-center gap-2">
          <span className="h-2 w-2 rounded-full bg-[#264D3B]" aria-hidden="true" />
          <span>Credentials persist in browser storage across refreshes and can be inspected in credential details.</span>
        </div>
        <span className="font-mono text-[11px] text-[#787E78]">STORAGE: ACTIVE</span>
      </aside>
    </PageLayout>
  )
}
