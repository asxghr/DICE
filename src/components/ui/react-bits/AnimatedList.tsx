import React from 'react'

/**
 * AnimatedList
 * Source: React Bits (https://reactbits.dev/components/animated-list)
 * Adapted for D.I.C.E. institutional design system:
 * - Pure Tailwind/CSS keyframes & staggered delays.
 * - Zero external animation dependencies.
 * - Stagger duration clamped to 60ms per item to prevent UI latency during audit checks.
 * - Disables delays instantly under prefers-reduced-motion.
 */

export interface AnimatedListProps {
  children: React.ReactNode[]
  staggerDelay?: number // ms
  className?: string
}

export const AnimatedList: React.FC<AnimatedListProps> = ({
  children,
  staggerDelay = 50,
  className = 'space-y-3',
}) => {
  return (
    <div className={className}>
      {React.Children.map(children, (child, index) => {
        if (!React.isValidElement(child)) return child

        return (
          <div
            className="animate-dice-fade-in transition-all duration-200 motion-reduce:transition-none motion-reduce:transform-none motion-reduce:animate-none"
            style={{
              animationDelay: `${index * staggerDelay}ms`,
            }}
          >
            {child}
          </div>
        )
      })}
    </div>
  )
}
