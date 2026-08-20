'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

const TYPE_INTERVAL_MS = 15

export function useTypedText({
  initial,
  reduceMotion,
}: {
  initial: string
  reduceMotion: boolean | null
}) {
  const [text, setText] = useState(initial)
  const [currentExample, setCurrentExample] = useState(initial)
  const [typing, setTyping] = useState(false)
  const targetRef = useRef(initial)
  const animatingRef = useRef(false)
  const timeoutRef = useRef<number | null>(null)

  const clearTimer = useCallback(() => {
    if (timeoutRef.current !== null) {
      window.clearTimeout(timeoutRef.current)
      timeoutRef.current = null
    }
  }, [])

  const stopAnimation = useCallback(() => {
    clearTimer()
    animatingRef.current = false
    setTyping(false)
  }, [clearTimer])

  useEffect(() => stopAnimation, [stopAnimation])

  const setImmediateText = useCallback(
    (next: string) => {
      stopAnimation()
      targetRef.current = next
      setCurrentExample(next)
      setText(next)
    },
    [stopAnimation],
  )

  const settle = useCallback(() => {
    if (!animatingRef.current && timeoutRef.current === null) {
      return null
    }

    const target = targetRef.current
    stopAnimation()
    setCurrentExample(target)
    setText(target)
    return target
  }, [stopAnimation])

  const typeTo = useCallback(
    (next: string, animate = true) => {
      stopAnimation()
      targetRef.current = next
      setCurrentExample(next)

      if (reduceMotion || !animate) {
        setText(next)
        return
      }

      setText('')
      setTyping(true)
      animatingRef.current = true
      let index = 0

      const tick = () => {
        if (!animatingRef.current) {
          return
        }

        index += 1
        setText(next.slice(0, index))

        if (index >= next.length) {
          timeoutRef.current = null
          animatingRef.current = false
          setTyping(false)
          return
        }

        timeoutRef.current = window.setTimeout(tick, TYPE_INTERVAL_MS)
      }

      timeoutRef.current = window.setTimeout(tick, TYPE_INTERVAL_MS)
    },
    [reduceMotion, stopAnimation],
  )

  return { text, currentExample, typing, typeTo, setImmediateText, settle }
}
