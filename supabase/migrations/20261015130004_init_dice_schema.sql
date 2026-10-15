-- =============================================================================
-- Migration: 20261015130004_init_dice_schema.sql
-- Description: D.I.C.E. Initial Backend Database Schema
--
-- Security Model & Architecture:
-- 1. Trust & Status are Server-Controlled:
--    - Issuer trust (public keys, active status) and credential revocation
--      status are managed strictly by server-side Edge Functions.
-- 2. Zero PII / Zero Credential Payload Storage:
--    - Complete credentials, claims, student subjects, and cryptographic signatures
--      are NEVER stored in the database. Holders keep their credentials, and
--      verifiers validate them dynamically.
-- 3. Row Level Security:
--    - Enabled on all tables. Direct client access (anon/authenticated) to insert,
--      update, or delete is denied.
--    - Public verification access is channeled exclusively through the
--      `verify-credential` Edge Function running with service-role permissions.
-- =============================================================================

-- Enable extension for UUID generation if needed in the future
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- =============================================================================
-- 1. ISSUERS TABLE
-- Stores recognized issuing authorities and their active public verification keys.
-- =============================================================================
CREATE TABLE IF NOT EXISTS public.issuers (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    public_key TEXT NOT NULL,
    key_id TEXT UNIQUE NOT NULL,
    active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.issuers IS 
'Registry of trusted credential issuers. Trust and key management are strictly server-controlled.';

COMMENT ON COLUMN public.issuers.public_key IS 
'Public Ed25519 verification key (Base64/Hex). Private keys are never stored in the database.';

COMMENT ON COLUMN public.issuers.active IS 
'Administrative status toggle. Inactive issuers cannot have new credentials issued or verified.';

-- Minimum indexes needed for fast issuer and key lookup
CREATE INDEX IF NOT EXISTS idx_issuers_active ON public.issuers (active);

-- =============================================================================
-- 2. CREDENTIAL_STATUS TABLE
-- Lightweight status & revocation registry for issued credentials.
-- Only tracks whether a credential ID is active or revoked.
-- =============================================================================
CREATE TABLE IF NOT EXISTS public.credential_status (
    credential_id TEXT PRIMARY KEY,
    issuer_id TEXT NOT NULL REFERENCES public.issuers(id) ON DELETE RESTRICT,
    revoked BOOLEAN NOT NULL DEFAULT false,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.credential_status IS 
'Server-controlled revocation registry. Contains only credential IDs and revocation flags. Never stores credential payloads, student data, or signatures.';

COMMENT ON COLUMN public.credential_status.issuer_id IS 
'Referenced issuing authority. ON DELETE RESTRICT prevents accidental deletion of issuers with existing status records.';

COMMENT ON COLUMN public.credential_status.revoked IS 
'Status flag. If true, the credential has been invalidated by the issuing authority.';

-- Minimum indexes needed for foreign key constraint checks and status queries
CREATE INDEX IF NOT EXISTS idx_credential_status_issuer_id ON public.credential_status (issuer_id);
CREATE INDEX IF NOT EXISTS idx_credential_status_revoked ON public.credential_status (revoked);

-- =============================================================================
-- 3. ROW LEVEL SECURITY (RLS) & ACCESS CONTROL
-- =============================================================================
ALTER TABLE public.issuers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.credential_status ENABLE ROW LEVEL SECURITY;

-- Revoke direct table mutations from anonymous and authenticated client roles
REVOKE INSERT, UPDATE, DELETE ON public.issuers FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.credential_status FROM anon, authenticated;

-- Public verification access is routed through the verify-credential Edge Function.
-- Direct client reads are restricted; server-side Edge Functions with service-role bypass RLS.
REVOKE SELECT ON public.issuers FROM anon, authenticated;
REVOKE SELECT ON public.credential_status FROM anon, authenticated;

-- =============================================================================
-- 4. AUTOMATED UPDATED_AT TIMESTAMP TRIGGER
-- =============================================================================
CREATE OR REPLACE FUNCTION public.handle_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_issuers_updated_at ON public.issuers;
CREATE TRIGGER trg_issuers_updated_at
BEFORE UPDATE ON public.issuers
FOR EACH ROW
EXECUTE FUNCTION public.handle_updated_at();

DROP TRIGGER IF EXISTS trg_credential_status_updated_at ON public.credential_status;
CREATE TRIGGER trg_credential_status_updated_at
BEFORE UPDATE ON public.credential_status
FOR EACH ROW
EXECUTE FUNCTION public.handle_updated_at();
