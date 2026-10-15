import type { AnyStudentCredential, DemoStudentCredential, StudentCredential } from '../types'

/**
 * Documented localStorage key used across D.I.C.E. to persist the demo/backend-issued credential.
 */
export const DEMO_ISSUER_STORAGE_KEY = 'dice_demo_issued_credential'

/**
 * Safely loads the active credential from localStorage.
 * Returns null if not present, unparseable, or invalid.
 */
export function getSavedCredential(): AnyStudentCredential | null {
  if (typeof window === 'undefined' || !window.localStorage) {
    return null
  }
  try {
    const raw = window.localStorage.getItem(DEMO_ISSUER_STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as AnyStudentCredential
    if (
      parsed &&
      typeof parsed === 'object' &&
      parsed.type === 'StudentCredential' &&
      parsed.subject &&
      typeof parsed.subject.id === 'string' &&
      parsed.claims &&
      (parsed.claims.studentStatus === 'active' || parsed.claims.studentStatus === 'inactive')
    ) {
      return parsed
    }
    return null
  } catch {
    return null
  }
}

/**
 * Legacy alias for getSavedCredential.
 */
export const getSavedDemoCredential: () => DemoStudentCredential | null =
  getSavedCredential as () => DemoStudentCredential | null

/**
 * Persists the issued credential into localStorage under DEMO_ISSUER_STORAGE_KEY.
 */
export function saveCredential(credential: AnyStudentCredential): void {
  if (typeof window === 'undefined' || !window.localStorage) {
    return
  }
  try {
    window.localStorage.setItem(DEMO_ISSUER_STORAGE_KEY, JSON.stringify(credential, null, 2))
    if (typeof window.dispatchEvent === 'function') {
      window.dispatchEvent(new Event('dice:storage-change'))
    }
  } catch (err) {
    console.error('Failed to save credential to localStorage:', err)
  }
}

/**
 * Legacy alias for saveCredential.
 */
export const saveDemoCredential: (credential: StudentCredential | DemoStudentCredential) => void =
  saveCredential

/**
 * Removes the demo credential from localStorage.
 */
export function clearDemoCredential(): void {
  if (typeof window === 'undefined' || !window.localStorage) {
    return
  }
  try {
    window.localStorage.removeItem(DEMO_ISSUER_STORAGE_KEY)
    if (typeof window.dispatchEvent === 'function') {
      window.dispatchEvent(new Event('dice:storage-change'))
    }
  } catch {
    // Ignore cleanup errors
  }
}

/**
 * Preferred alias for clearDemoCredential.
 */
export const clearCredential = clearDemoCredential
