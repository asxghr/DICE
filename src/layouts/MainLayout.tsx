import React from 'react'
import { Navbar } from '../components/Navbar'
import type { ActiveView } from '../types'

interface MainLayoutProps {
  activeView: ActiveView
  onSelectView: (view: ActiveView) => void
  children: React.ReactNode
}

export const MainLayout: React.FC<MainLayoutProps> = ({
  activeView,
  onSelectView,
  children,
}) => {
  return (
    <div className="min-h-screen bg-[#FAF8F5] text-[#1C201D] flex flex-col font-sans selection:bg-[#EDF3EE] selection:text-[#1B382B]">
      <Navbar activeView={activeView} onSelectView={onSelectView} />

      <main className="flex-1 max-w-6xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-8 sm:py-10">
        {children}
      </main>

      <footer className="border-t border-[#E7E3DA] bg-[#FAF8F5] py-8">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 text-xs text-[#787E78]">
          <div className="space-y-0.5">
            <div className="font-medium text-[#1C201D]">
              D.I.C.E. Academic Credential Exchange
            </div>
            <p className="text-[11px] text-[#787E78]">
              Registrar credential issuance with Ed25519 signing and Supabase status registry verification.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-3 font-mono text-[11px] text-[#525753]">
            <span>Ed25519 / RFC 8032</span>
            <span className="text-[#D4CEBF]">•</span>
            <span>Deterministic JSON Serialization</span>
            <span className="text-[#D4CEBF]">•</span>
            <span>Supabase Edge Functions</span>
          </div>
        </div>
      </footer>
    </div>
  )
}
