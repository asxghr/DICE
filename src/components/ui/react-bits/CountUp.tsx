import React, { useEffect, useState, useRef } from 'react'

/**
 * CountUp
 * Source: React Bits (https://reactbits.dev/text-animations/count-up)
 * Adapted for D.I.C.E. institutional design system:
 * - Pure React + TypeScript implementation with zero external runtime packages.
 * - Used strictly for non-security metrics (e.g. days of validity, audit checklist item totals).
 * - Fully respects prefers-reduced-motion by rendering the final value immediately.
 * - Accessible: renders formatted number with appropriate aria semantics.
 */

export interface CountUpProps {
  to: number
  from?: number
  duration?: number // in seconds
  decimals?: number
  separator?: string
  prefix?: string
  suffix?: string
  className?: string
  onEnd?: () => void
}

export const CountUp: React.FC<CountUpProps> = ({
  to,
  from = 0,
  duration = 1.2,
  decimals = 0,
  separator = ',',
  prefix = '',
  suffix = '',
  className = '',
  onEnd,
}) => {
  const isReducedMotion =
    typeof window !== 'undefined' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches

  const [current, setCurrent] = useState(() => (isReducedMotion ? to : from))
  const isMountedRef = useRef(true)

  useEffect(() => {
    isMountedRef.current = true

    if (isReducedMotion) {
      onEnd?.()
      return
    }

    const startTime = performance.now()
    const totalDuration = duration * 1000

    const updateCounter = (now: number) => {
      if (!isMountedRef.current) return

      const elapsed = now - startTime
      const progress = Math.min(elapsed / totalDuration, 1)

      // Ease-out cubic curve for calm institutional settlement
      const easeOut = 1 - Math.pow(1 - progress, 3)
      const nextValue = from + (to - from) * easeOut

      setCurrent(nextValue)

      if (progress < 1) {
        requestAnimationFrame(updateCounter)
      } else {
        setCurrent(to)
        onEnd?.()
      }
    }

    const frameId = requestAnimationFrame(updateCounter)

    return () => {
      isMountedRef.current = false
      cancelAnimationFrame(frameId)
    }
  }, [to, from, duration, onEnd, isReducedMotion])

  const formatNumber = (num: number) => {
    const fixed = num.toFixed(decimals)
    const [intPart, decPart] = fixed.split('.')
    const formattedInt = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, separator)
    return decPart !== undefined ? `${formattedInt}.${decPart}` : formattedInt
  }

  const formattedDisplay = `${prefix}${formatNumber(current)}${suffix}`
  const finalAccessibleValue = `${prefix}${formatNumber(to)}${suffix}`

  return (
    <span
      className={`tabular-nums font-mono ${className}`}
      aria-label={finalAccessibleValue}
    >
      {formattedDisplay}
    </span>
  )
}
