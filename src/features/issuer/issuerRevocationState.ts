import type {
  AnyStudentCredential,
  IssuerRegistryStatus,
  RevokeCredentialResponse,
} from '../../types'
import type { RevokeCredentialError } from '../../lib/issuerApi'

export interface IssuerRevocationState {
  isRevoking: boolean
  confirmRevoke: boolean
  revocationData: RevokeCredentialResponse | null
  revocationError: RevokeCredentialError | null
  revokedConflict: boolean
  notFoundInRegistry: boolean
  revocationTargetId: string | null
}

export const initialIssuerRevocationState: IssuerRevocationState = {
  isRevoking: false,
  confirmRevoke: false,
  revocationData: null,
  revocationError: null,
  revokedConflict: false,
  notFoundInRegistry: false,
  revocationTargetId: null,
}

/**
 * Resets all revocation transient state.
 * Used on sign-out, session expiration, or when clearing/replacing the active credential.
 */
export function resetRevocationState(): IssuerRevocationState {
  return { ...initialIssuerRevocationState }
}

/**
 * Prepares state for a new revocation attempt.
 * Clears transient result state from previous attempts (errors, conflict flags, stale receipts).
 */
export function startRevocationAttempt(
  prevState: IssuerRevocationState,
  targetCredentialId: string | null
): IssuerRevocationState {
  return {
    ...prevState,
    isRevoking: true,
    revocationError: null,
    revokedConflict: false,
    notFoundInRegistry: false,
    revocationData: null,
    revocationTargetId: targetCredentialId,
  }
}

/**
 * Updates state when a revocation attempt fails.
 * Ensures the state reflects only the current attempt:
 * - 409 produces ALREADY_REVOKED
 * - 404 produces NOT_REGISTERED
 * - 401/403/500/network errors produce service failure without conflict/notFound flags.
 * A previous 409/404 is cleared and cannot override a later service error.
 */
export function failRevocationAttempt(
  prevState: IssuerRevocationState,
  error: RevokeCredentialError
): IssuerRevocationState {
  const is409 = error.code === 'ALREADY_REVOKED' || error.status === 409
  const is404 = error.code === 'CREDENTIAL_NOT_FOUND' || error.status === 404

  return {
    ...prevState,
    isRevoking: false,
    revocationError: error,
    revokedConflict: is409,
    notFoundInRegistry: is404,
    revocationData: null,
  }
}

/**
 * Updates state when a revocation attempt succeeds.
 */
export function succeedRevocationAttempt(
  prevState: IssuerRevocationState,
  data: RevokeCredentialResponse
): IssuerRevocationState {
  return {
    ...prevState,
    isRevoking: false,
    revocationData: data,
    revocationError: null,
    revokedConflict: false,
    notFoundInRegistry: false,
    confirmRevoke: false,
  }
}

/**
 * Authoritative registry status derivation.
 * Strictly derives status from the current credential and current revocation attempt only.
 * Never infers an ACTIVE status.
 */
export function deriveIssuerRegistryStatus(
  savedCredential: AnyStudentCredential | null,
  state: IssuerRevocationState
): IssuerRegistryStatus {
  if (!savedCredential) {
    return 'UNVERIFIED'
  }

  if (savedCredential.proof?.type !== 'Ed25519Signature') {
    return 'SIMULATED'
  }

  // If revocation state belongs to a different credential, it cannot leak into this one
  const targetMatches =
    state.revocationTargetId === null || state.revocationTargetId === savedCredential.id

  if (!targetMatches) {
    return 'UNVERIFIED'
  }

  if (
    state.revocationData &&
    state.revocationData.credentialId === savedCredential.id &&
    state.revocationData.revoked
  ) {
    return 'REVOKED'
  }

  if (state.revokedConflict) {
    return 'ALREADY_REVOKED'
  }

  if (state.notFoundInRegistry) {
    return 'NOT_REGISTERED'
  }

  if (state.revocationError) {
    return 'STATUS_UNAVAILABLE'
  }

  return 'UNVERIFIED'
}
