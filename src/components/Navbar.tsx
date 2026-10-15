import React, { useEffect, useState } from 'react'
import type { ActiveView } from '../types'
import { isSupabaseConfigured, supabase } from '../lib/supabase'

interface NavbarProps {
  activeView: ActiveView
  onSelectView: (view: ActiveView) => void
}

export const Navbar: React.FC<NavbarProps> = ({ activeView, onSelectView }) => {
  const [userEmail, setUserEmail] = useState<string | null>(null)

  useEffect(() => {
    if (!isSupabaseConfigured) return
    supabase.auth.getSession().then(({ data }) => {
      setUserEmail(data.session?.user?.email ?? null)
    })
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setUserEmail(session?.user?.email ?? null)
    })
    return () => {
      subscription.unsubscribe()
    }
  }, [])

  const navItems: { id: ActiveView; label: string; shortLabel: string; numeral: string }[] = [
    { id: 'issuer', label: 'Issuer Administration', shortLabel: 'Issuer', numeral: '01' },
    { id: 'wallet', label: 'Holder Wallet', shortLabel: 'Wallet', numeral: '02' },
    { id: 'verifier', label: 'Verification Desk', shortLabel: 'Verifier', numeral: '03' },
  ]

  return (
    <header className="border-b border-[#E7E3DA] bg-[#FAF8F5]/95 backdrop-blur-xs sticky top-0 z-40 transition-colors">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex h-16 sm:h-18 items-center justify-between gap-2 sm:gap-4">
          {/* Institution & Identity Monogram */}
          <div className="flex items-center gap-2.5 sm:gap-3 shrink-0">
            <div className="flex h-8 w-8 sm:h-9 sm:w-9 items-center justify-center border border-[#D4CEBF] bg-[#FFFFFF] text-[#264D3B] font-semibold text-xs sm:text-sm tracking-wider shadow-2xs">
              <svg
                width="18"
                height="18"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.75"
                strokeLinecap="square"
                strokeLinejoin="miter"
                aria-hidden="true"
              >
                <rect x="3" y="3" width="18" height="18" />
                <path d="M12 3v18" />
                <path d="M3 12h18" />
                <circle cx="12" cy="12" r="2" fill="currentColor" />
              </svg>
            </div>
            <div>
              <div className="flex items-center gap-1.5 sm:gap-2">
                <span className="font-semibold text-sm sm:text-base text-[#1C201D] tracking-tight">
                  D.I.C.E.
                </span>
                <span className="hidden sm:inline-block font-mono text-[9px] uppercase px-1.5 py-0.2 bg-[#F4F0E8] border border-[#D4CEBF] text-[#525753]">
                  Registry
                </span>
              </div>
              <p className="text-[11px] text-[#787E78] tracking-tight hidden md:block">
                Decentralized Identity Credentials Exchange • Academic Registrar
              </p>
            </div>
          </div>

          {/* Primary View Navigation */}
          <nav
            aria-label="Primary View Selection"
            className="flex items-center gap-1 sm:gap-1.5 p-1 bg-[#F4F0E8]/70 border border-[#E7E3DA] rounded-xs"
          >
            {navItems.map((item) => {
              const isActive = activeView === item.id
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => onSelectView(item.id)}
                  aria-current={isActive ? 'page' : undefined}
                  className={`inline-flex items-center gap-1 sm:gap-1.5 px-2.5 sm:px-3 py-1 sm:py-1.5 text-xs font-medium transition-all rounded-xs cursor-pointer focus-visible:ring-2 focus-visible:ring-[#264D3B] focus-visible:outline-none ${
                    isActive
                      ? 'bg-[#FFFFFF] text-[#264D3B] font-semibold shadow-2xs border border-[#CADACF]'
                      : 'text-[#525753] hover:text-[#1C201D] hover:bg-[#FFFFFF]/60 border border-transparent'
                  }`}
                >
                  <span className="font-mono text-[10px] opacity-60">
                    {item.numeral}
                  </span>
                  <span className="hidden sm:inline">{item.label}</span>
                  <span className="sm:hidden">{item.shortLabel}</span>
                </button>
              )
            })}
          </nav>

          {/* Registry Connectivity Status */}
          <div className="hidden lg:flex items-center gap-2 border border-[#E7E3DA] bg-[#FFFFFF] px-2.5 py-1 text-[11px] text-[#525753] rounded-xs shadow-2xs">
            <span
              className={`inline-block h-1.5 w-1.5 rounded-full ${
                !isSupabaseConfigured
                  ? 'bg-[#A84835]'
                  : userEmail
                  ? 'bg-[#264D3B]'
                  : 'bg-[#C4A44D]'
              }`}
              aria-hidden="true"
            />
            <span className="font-mono text-[10px] uppercase tracking-wider">
              {!isSupabaseConfigured
                ? 'Browser Storage'
                : userEmail
                ? `Issuer: ${userEmail}`
                : 'Supabase Active'}
            </span>
          </div>
        </div>
      </div>
    </header>
  )
}
