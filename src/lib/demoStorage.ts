import type { DemoStudentCredential } from '../types'

/**
 * Documented localStorage key used across D.I.C.E. to persist the demo-issued credential.
 */
export const DEMO_ISSUER_STORAGE_KEY = 'dice_demo_issued_credential'

/**
 * Safely loads the active demo credential from localStorage.
 * Returns null if not present, unparseable, or invalid.
 */
export function getSavedDemoCredential(): DemoStudentCredential | null {
  if (typeof window === 'undefined' || !window.localStorage) {
    return null
  }
  try {
    const raw = window.localStorage.getItem(DEMO_ISSUER_STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as DemoStudentCredential
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
 * Persists the generated demo credential into localStorage under DEMO_ISSUER_STORAGE_KEY.
 */
export function saveDemoCredential(credential: DemoStudentCredential): void {
  if (typeof window === 'undefined' || !window.localStorage) {
    return
  }
  try {
    window.localStorage.setItem(DEMO_ISSUER_STORAGE_KEY, JSON.stringify(credential, null, 2))
  } catch (err) {
    console.error('Failed to save demo credential to localStorage:', err)
  }
}

/**
 * Removes the demo credential from localStorage.
 */
export function clearDemoCredential(): void {
  if (typeof window === 'undefined' || !window.localStorage) {
    return
  }
  try {
    window.localStorage.removeItem(DEMO_ISSUER_STORAGE_KEY)
  } catch {
    // Ignore cleanup errors
  }
}
