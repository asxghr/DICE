import React, { useEffect, useState, useRef } from 'react'

/**
 * DecryptedText
 * Source: React Bits (https://reactbits.dev/text-animations/decrypted-text)
 * Adapted for D.I.C.E. institutional design system:
 * - Pure TypeScript implementation with zero external runtime dependencies.
 * - Used strictly for cryptographic feedback (fingerprint/hash/signature settlement).
 * - Full accessibility compliance: real text rendered for screen readers via sr-only;
 *   animating glyphs marked aria-hidden="true".
 * - Automatically bypassed when prefers-reduced-motion is detected.
 */

export interface DecryptedTextProps {
  text: string
  speed?: number
  maxIterations?: number
  sequential?: boolean
  revealDirection?: 'start' | 'end' | 'center'
  useOriginalCharsOnly?: boolean
  characters?: string
  className?: string
  encryptedClassName?: string
  parentClassName?: string
  animateOn?: 'view' | 'hover' | 'mount'
  onComplete?: () => void
}

const HEX_GLYPHS = '0123456789ABCDEF'

export const DecryptedText: React.FC<DecryptedTextProps> = ({
  text,
  speed = 30,
  maxIterations = 8,
  sequential = true,
  characters = HEX_GLYPHS,
  className = '',
  encryptedClassName = 'text-[#787E78] font-mono opacity-80',
  parentClassName = '',
  animateOn = 'mount',
  onComplete,
}) => {
  const [displayText, setDisplayText] = useState(text)
  const [isHovered, setIsHovered] = useState(false)
  const isAnimatingRef = useRef(false)
  const intervalRef = useRef<number | null>(null)

  useEffect(() => {
    // Check user preference for reduced motion
    const prefersReducedMotion =
      typeof window !== 'undefined' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches

    if (prefersReducedMotion) {
      onComplete?.()
      return
    }

    let iteration = 0
    const textLength = text.length

    const startAnimation = () => {
      if (isAnimatingRef.current) return
      isAnimatingRef.current = true

      if (intervalRef.current) clearInterval(intervalRef.current)

      intervalRef.current = window.setInterval(() => {
        setDisplayText(() => {
          return text
            .split('')
            .map((char, index) => {
              if (char === ' ' || char === '-' || char === ':' || char === '/') {
                return char
              }

              if (sequential) {
                const threshold = (iteration / maxIterations) * textLength
                if (index < threshold) {
                  return text[index]
                }
              } else if (iteration >= maxIterations) {
                return text[index]
              }

              return characters[Math.floor(Math.random() * characters.length)]
            })
            .join('')
        })

        iteration++

        if (iteration > maxIterations) {
          if (intervalRef.current) clearInterval(intervalRef.current)
          setDisplayText(text)
          isAnimatingRef.current = false
          onComplete?.()
        }
      }, speed)
    }

    if (animateOn === 'mount' || (animateOn === 'hover' && isHovered)) {
      startAnimation()
    }

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current)
      isAnimatingRef.current = false
    }
  }, [text, speed, maxIterations, sequential, characters, animateOn, isHovered, onComplete])

  return (
    <span
      className={`inline-block font-mono ${parentClassName}`}
      onMouseEnter={() => animateOn === 'hover' && setIsHovered(true)}
      onMouseLeave={() => animateOn === 'hover' && setIsHovered(false)}
    >
      {/* Screen reader text (accessible, complete) */}
      <span className="sr-only">{text}</span>

      {/* Visual deciphering output */}
      <span aria-hidden="true" className={className}>
        {displayText.split('').map((char, idx) => {
          const isDecrypted = char === text[idx]
          return (
            <span
              key={idx}
              className={isDecrypted ? className : encryptedClassName}
            >
              {char}
            </span>
          )
        })}
      </span>
    </span>
  )
}
