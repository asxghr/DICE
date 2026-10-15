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
    <div className="space-y-6 sm:space-y-8">
      {/* Editorial Page Header */}
      <header className="border-b border-[#E7E3DA] pb-5 sm:pb-6">
        <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
          <div className="space-y-1.5">
            <div className="flex items-center gap-2">
              <span className="font-mono text-[11px] text-[#264D3B] font-semibold tracking-wider uppercase">
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
            <p className="text-xs sm:text-sm text-[#525753] max-w-2xl leading-relaxed">
              {subtitle}
            </p>
          </div>

          {/* Quick Indicator Badge */}
          <div className="flex items-center gap-2 self-start md:self-end text-xs font-mono text-[#525753] border border-[#D4CEBF] bg-[#FFFFFF] px-3 py-1.5 rounded-xs shadow-2xs">
            <span className="h-1.5 w-1.5 rounded-full bg-[#264D3B]" aria-hidden="true" />
            <span>CREDENTIAL WORKSPACE</span>
          </div>
        </div>
      </header>

      {/* Structured Status Area */}
      {statusItems && statusItems.length > 0 && (
        <section
          aria-label="System Status Registry"
          className="border border-[#E7E3DA] bg-[#FFFFFF] rounded-xs shadow-2xs overflow-hidden"
        >
          <div className="border-b border-[#E7E3DA] bg-[#FAF8F5] px-3.5 sm:px-4 py-2 flex items-center justify-between text-[11px] font-mono">
            <span className="uppercase tracking-wider text-[#787E78]">
              Registry & Protocol Metadata
            </span>
            <span className="text-[#525753] hidden sm:inline">
              Authority: SVCE Registrar Office
            </span>
          </div>
          <div className="grid grid-cols-2 lg:grid-cols-4 divide-y sm:divide-y-0 sm:divide-x divide-[#E7E3DA] text-xs">
            {statusItems.map((item, idx) => (
              <div key={idx} className="p-3 sm:p-3.5 space-y-1">
                <div className="text-[10px] font-mono uppercase tracking-wider text-[#787E78]">
                  {item.label}
                </div>
                <div className="font-medium text-[#1C201D] truncate flex items-center gap-1.5">
                  {item.badge === 'forest' && (
                    <span className="h-1.5 w-1.5 rounded-full bg-[#264D3B] shrink-0" aria-hidden="true" />
                  )}
                  {item.badge === 'terracotta' && (
                    <span className="h-1.5 w-1.5 rounded-full bg-[#A84835] shrink-0" aria-hidden="true" />
                  )}
                  {item.badge === 'neutral' && (
                    <span className="h-1.5 w-1.5 rounded-full bg-[#787E78] shrink-0" aria-hidden="true" />
                  )}
                  <span className="truncate">{item.value}</span>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Primary Content Area */}
      <div className="space-y-6">
        {children}
      </div>
    </div>
  )
}
