import { useState } from 'react'
import { MainLayout } from './layouts/MainLayout'
import { IssuerPortal } from './features/issuer/IssuerPortal'
import { HolderWallet } from './features/wallet/HolderWallet'
import { VerifierPortal } from './features/verifier/VerifierPortal'
import type { ActiveView } from './types'

function App() {
  const [activeView, setActiveView] = useState<ActiveView>('issuer')

  const renderActiveView = () => {
    switch (activeView) {
      case 'issuer':
        return <IssuerPortal />
      case 'wallet':
        return <HolderWallet onSelectView={setActiveView} />
      case 'verifier':
        return <VerifierPortal />
      default:
        return <IssuerPortal />
    }
  }

  return (
    <MainLayout activeView={activeView} onSelectView={setActiveView}>
      {renderActiveView()}
    </MainLayout>
  )
}

export default App
