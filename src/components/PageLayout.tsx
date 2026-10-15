import React from 'react'

export interface StatusItem {
  label: string
  value: string
  badge?: 'forest' | 'terracotta' | 'neutral'
}

interface PageLayoutProps {
  sectionNumeral: string
  sectionCategory: string
  title: string
  subtitle: string
  statusItems: StatusItem[]
  children: React.ReactNode
}

export const PageLayout: React.FC<PageLayoutProps> = ({
  sectionNumeral,
  sectionCategory,
  title,
  subtitle,
  statusItems,
  children,
}) => {
  return (
    <div className="space-y-8">
      {/* Editorial Page Header */}
      <header className="border-b border-[#E7E3DA] pb-6">
        <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
          <div className="space-y-1.5">
            <div className="flex items-center gap-2">
              <span className="font-mono text-[11px] text-[#A84835] font-semibold tracking-wider uppercase">
                {sectionNumeral}
              </span>
              <span className="text-[#D4CEBF] text-xs">/</span>
              <span className="font-mono text-[11px] text-[#787E78] tracking-wider uppercase">
                {sectionCategory}
              </span>
            </div>
            <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight text-[#1C201D]">
              {title}
            </h1>
            <p className="text-sm text-[#525753] max-w-2xl leading-relaxed">
              {subtitle}
            </p>
          </div>

          {/* Quick Indicator Badge */}
          <div className="flex items-center gap-2 self-start md:self-end text-xs font-mono text-[#525753] border border-[#E7E3DA] bg-[#FFFFFF] px-3 py-1.5">
            <span className="h-1.5 w-1.5 rounded-full bg-[#264D3B]" />
            <span>CREDENTIAL WORKSPACE</span>
          </div>
        </div>
      </header>

      {/* Structured Status Area */}
      <section
        aria-label="System Status Registry"
        className="border border-[#E7E3DA] bg-[#FFFFFF]"
      >
        <div className="border-b border-[#E7E3DA] bg-[#FAF8F5] px-4 py-2 flex items-center justify-between">
          <span className="text-[11px] font-mono uppercase tracking-wider text-[#787E78]">
            Registry & Protocol Metadata
          </span>
          <span className="text-[10px] font-mono text-[#525753]">
            Issuer: SVCE Registrar
          </span>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 divide-x divide-[#E7E3DA] text-xs">
          {statusItems.map((item, idx) => (
            <div key={idx} className="p-3 sm:p-4 space-y-1">
              <div className="text-[10px] font-mono uppercase tracking-wider text-[#787E78]">
                {item.label}
              </div>
              <div className="font-medium text-[#1C201D] truncate flex items-center gap-1.5">
                {item.badge === 'forest' && (
                  <span className="h-1.5 w-1.5 rounded-full bg-[#264D3B] shrink-0" />
                )}
                {item.badge === 'terracotta' && (
                  <span className="h-1.5 w-1.5 rounded-full bg-[#A84835] shrink-0" />
                )}
                <span>{item.value}</span>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Primary Content Area */}
      <div className="space-y-6">
        {children}
      </div>
    </div>
  )
}
