-- =============================================================================
-- Migration: 20261015140000_register_demo_issuer.sql
-- Description: Register persistent demo issuer for D.I.C.E. (SVCE Demo)
--
-- Registers the official demo issuing authority and its public Ed25519 verification key.
-- ZERO private key material or credential data is ever stored in the database.
-- =============================================================================

INSERT INTO public.issuers (
    id,
    name,
    public_key,
    key_id,
    active
) VALUES (
    'svce-demo',
    'SVCE Demo Issuer',
    'myZI-hLFo8GbqDWSdEFM6l0la4s8Cb_AfeH4B8b-nAU',
    'svce-demo-key-v1',
    true
);
