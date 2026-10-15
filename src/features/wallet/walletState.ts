import type { AnyStudentCredential } from '../../types'
import type { StatusItem } from '../../components/PageLayout'

export type WalletProofClassification = 'ed25519' | 'simulated' | 'unknown'

/**
 * Classifies the proof object of a stored student credential by its declared format.
 * Strictly non-authoritative: does not verify cryptographic signature validity, issuer trust,
 * or active standing in the institutional status registry.
 */
export function classifyWalletProof(
  credential: AnyStudentCredential | null
): WalletProofClassification {
  if (!credential || !credential.proof) {
    return 'unknown'
  }
  if (credential.proof.type === 'Ed25519Signature') {
    return 'ed25519'
  }
  if (credential.proof.type === 'DemoSimulationProof') {
    return 'simulated'
  }
  return 'unknown'
}

/**
 * Derives presentation status items for the Holder Wallet.
 * Strictly avoids claiming that a locally stored credential is valid, authentic, or active
 * without an authoritative remote verification result from the Verifier Desk.
 */
export function getWalletStatusItems(
  credential: AnyStudentCredential | null
): StatusItem[] {
  const classification = classifyWalletProof(credential)

  const proofValue =
    classification === 'ed25519'
      ? 'Ed25519 Signature'
      : classification === 'simulated'
      ? 'Simulated Proof'
      : 'None'

  const proofBadge: 'forest' | 'neutral' =
    classification === 'ed25519' ? 'forest' : 'neutral'

  return [
    { label: 'Vault Custody', value: 'Browser Storage', badge: 'neutral' },
    {
      label: 'Proof Type',
      value: proofValue,
      badge: proofBadge,
    },
    {
      label: 'Registry Status',
      value: 'Unverified (Use Verifier)',
      badge: 'neutral',
    },
    {
      label: 'Stored Records',
      value: credential ? '1 Local Record' : '0 Records',
      badge: credential ? 'forest' : 'neutral',
    },
  ]
}
