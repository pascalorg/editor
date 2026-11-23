import { useEffect, useRef } from 'react'
import { createWalkthroughInput, onWalkthroughInputClear } from '../lib/walkthrough-input'

export function useWalkthroughInputLifecycle() {
  useEffect(() => {
    const { clear } = createWalkthroughInput()
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') clear()
    }
    window.addEventListener('blur', clear)
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      window.removeEventListener('blur', clear)
      document.removeEventListener('visibilitychange', onVisibility)
      clear()
    }
  }, [])
}

// The ground spring needs jump held through takeoff and ascent, like Space. Release at the apex
// so one request completes one jump and can never launch again on landing.
export function useWalkthroughJump() {
  const jumping = useRef(false)
  useEffect(
    () =>
      onWalkthroughInputClear(() => {
        jumping.current = false
      }),
    [],
  )
  return (requested: boolean, grounded: boolean, verticalSpeed: number) => {
    if (requested && grounded) jumping.current = true
    if (!grounded && verticalSpeed <= 0) jumping.current = false
    return jumping.current
  }
}
