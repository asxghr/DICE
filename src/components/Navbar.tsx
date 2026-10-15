import React from 'react'
import type { ActiveView } from '../types'
import { isSupabaseConfigured } from '../lib/supabase'

interface NavbarProps {
  activeView: ActiveView
  onSelectView: (view: ActiveView) => void
}

export const Navbar: React.FC<NavbarProps> = ({ activeView, onSelectView }) => {
  const navItems: { id: ActiveView; label: string; numeral: string }[] = [
    { id: 'issuer', label: 'Issuer Administration', numeral: '01' },
    { id: 'wallet', label: 'Holder Wallet', numeral: '02' },
    { id: 'verifier', label: 'Verification Desk', numeral: '03' },
  ]

  return (
    <header className="border-b border-[#E7E3DA] bg-[#FAF8F5]">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex h-18 items-center justify-between gap-4">
          {/* Institution & Identity Monogram */}
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center border border-[#D4CEBF] bg-[#FFFFFF] text-[#264D3B] font-semibold text-sm tracking-wider">
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
              <div className="flex items-center gap-2">
                <span className="font-semibold text-base text-[#1C201D] tracking-tight">
                  D.I.C.E.
                </span>
              </div>
              <p className="text-[11px] text-[#787E78] tracking-tight hidden sm:block">
                Decentralized Identity Credentials Exchange • Academic Registry
              </p>
            </div>
          </div>

          {/* Primary View Navigation */}
          <nav
            aria-label="Primary View Selection"
            className="flex items-center gap-1 sm:gap-2"
          >
            {navItems.map((item) => {
              const isActive = activeView === item.id
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => onSelectView(item.id)}
                  className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium transition-colors border ${
                    isActive
                      ? 'border-[#CADACF] bg-[#EDF3EE] text-[#264D3B]'
                      : 'border-transparent text-[#525753] hover:text-[#1C201D] hover:bg-[#F4F0E8] hover:border-[#E7E3DA]'
                  }`}
                >
                  <span className="font-mono text-[10px] opacity-60">
                    {item.numeral}
                  </span>
                  <span>{item.label}</span>
                </button>
              )
            })}
          </nav>

          {/* Registry Connectivity Status */}
          <div className="hidden lg:flex items-center gap-2 border border-[#E7E3DA] bg-[#FFFFFF] px-2.5 py-1 text-[11px] text-[#525753]">
            <span
              className={`inline-block h-1.5 w-1.5 rounded-full ${
                isSupabaseConfigured ? 'bg-[#264D3B]' : 'bg-[#A84835]'
              }`}
              aria-hidden="true"
            />
            <span className="font-mono text-[10px] uppercase tracking-wider">
              {isSupabaseConfigured ? 'Supabase Configured' : 'Browser Storage'}
            </span>
          </div>
        </div>
      </div>
    </header>
  )
}
