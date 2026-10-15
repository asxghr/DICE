// =============================================================================
// D.I.C.E. Edge Function Error Architecture
// Location: supabase/functions/_shared/errors.ts
//
// Stable API error responses adhering strictly to the D.I.C.E. specification:
// {
//   "error": {
//     "code": "ERROR_CODE",
//     "message": "Safe user-facing message."
//   }
// }
// =============================================================================

export type ApiErrorCode =
  | 'UNAUTHENTICATED'
  | 'NOT_AUTHORIZED'
  | 'INVALID_REQUEST'
  | 'INVALID_CREDENTIAL'
  | 'ISSUANCE_FAILED'
  | 'VERIFICATION_FAILED'
  | 'REVOCATION_FAILED'
  | 'CREDENTIAL_NOT_FOUND'
  | 'ALREADY_REVOKED'
  | 'INTERNAL_ERROR'

export interface ApiErrorResponse {
  error: {
    code: ApiErrorCode | string
    message: string
  }
}

/**
 * Structured application error for Edge Functions with safe HTTP status codes.
 */
export class ApiError extends Error {
  public readonly code: ApiErrorCode
  public readonly statusCode: number

  constructor(code: ApiErrorCode, message: string, statusCode = 400) {
    super(message)
    this.name = 'ApiError'
    this.code = code
    this.statusCode = statusCode
    Object.setPrototypeOf(this, new.target.prototype)
  }

  public toResponseObject(): ApiErrorResponse {
    return {
      error: {
        code: this.code,
        message: this.message,
      },
    }
  }
}
