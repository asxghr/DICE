import React, { useRef, useState, useCallback } from 'react'

/**
 * SpotlightCard
 * Source: React Bits (https://reactbits.dev/components/spotlight-card)
 * Adapted for D.I.C.E. institutional design system:
 * - Pure TypeScript + Tailwind implementation with zero external runtime dependencies.
 * - Subdued, authoritative parchment lighting (soft amber/forest radial spotlight).
 * - Honors prefers-reduced-motion by disabling cursor illumination.
 */

export interface SpotlightCardProps extends React.HTMLAttributes<HTMLDivElement> {
  children: React.ReactNode
  className?: string
  spotlightColor?: string
  borderColor?: string
}

export const SpotlightCard: React.FC<SpotlightCardProps> = ({
  children,
  className = '',
  spotlightColor = 'rgba(38, 77, 59, 0.06)', // Subdued forest tint
  borderColor = '#CADACF',
  ...props
}) => {
  const cardRef = useRef<HTMLDivElement>(null)
  const [position, setPosition] = useState<{ x: number; y: number }>({ x: 0, y: 0 })
  const [opacity, setOpacity] = useState(0)

  const handleMouseMove = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    if (!cardRef.current) return
    const rect = cardRef.current.getBoundingClientRect()
    setPosition({
      x: e.clientX - rect.left,
      y: e.clientY - rect.top,
    })
  }, [])

  const handleMouseEnter = useCallback(() => {
    setOpacity(1)
  }, [])

  const handleMouseLeave = useCallback(() => {
    setOpacity(0)
  }, [])

  return (
    <div
      ref={cardRef}
      onMouseMove={handleMouseMove}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      className={`relative overflow-hidden border border-[#D4CEBF] bg-[#FFFFFF] rounded-xs shadow-xs transition-shadow hover:shadow-sm motion-reduce:transition-none ${className}`}
      {...props}
    >
      {/* Dynamic Cursor Spotlight Overlay */}
      <div
        className="pointer-events-none absolute -inset-px transition-opacity duration-300 motion-reduce:hidden"
        style={{
          opacity,
          background: `radial-gradient(400px circle at ${position.x}px ${position.y}px, ${spotlightColor}, transparent 70%)`,
        }}
        aria-hidden="true"
      />

      {/* Subtle Dynamic Border Highlight */}
      <div
        className="pointer-events-none absolute inset-0 border transition-opacity duration-300 motion-reduce:hidden rounded-xs"
        style={{
          opacity,
          borderColor,
          maskImage: `radial-gradient(250px circle at ${position.x}px ${position.y}px, black, transparent 80%)`,
          WebkitMaskImage: `radial-gradient(250px circle at ${position.x}px ${position.y}px, black, transparent 80%)`,
        }}
        aria-hidden="true"
      />

      <div className="relative z-10">{children}</div>
    </div>
  )
}
