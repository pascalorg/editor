import { useThree } from '@react-three/fiber'
import { useLayoutEffect } from 'react'

type FrameLimiterProps = {
  fps?: number
}

const FrameLimiter: React.FC<FrameLimiterProps> = ({ fps = 50 }) => {
  const { advance, set, frameloop: initFrameloop, scene, clock } = useThree()
  const renderer = useThree((state) => state.gl)

  useLayoutEffect(() => {
    let elapsed = 0
    let then = 0
    let i = 0
    let raf: number | null = null
    const interval = 1000 / fps
    function tick(t: DOMHighResTimeStamp) {
      raf = requestAnimationFrame(tick)
      elapsed = t - then
      if (elapsed > interval) {
        advance(i)
        i += elapsed / 1000 - (elapsed % interval) / 1000
        then = t - (elapsed % interval)
      }
    }
    // Set frameloop to never, it will shut down the default render loop
    set({ frameloop: 'never' })
    // Kick off custom render loop
    raf = requestAnimationFrame(tick)

    // Browsers throttle requestAnimationFrame when the tab is hidden, the
    // window is unfocused, or the system marks the tab as occluded. With
    // frameloop="never" rAF is the only render driver, so when it stalls the
    // canvas freezes — Linux Firefox/Chrome and Zen show this as the viewer
    // "turning off" between cursor interactions. Force one synchronous advance
    // whenever the page resumes so the next visible frame matches the current
    // scene state.
    function kick() {
      i += 1 / 1000
      advance(i)
    }
    function onVisibilityChange() {
      if (document.visibilityState === 'visible') kick()
    }
    document.addEventListener('visibilitychange', onVisibilityChange)
    window.addEventListener('focus', kick)
    window.addEventListener('pageshow', kick)

    // Restore initial setting
    return () => {
      if (raf) {
        cancelAnimationFrame(raf)
      }
      document.removeEventListener('visibilitychange', onVisibilityChange)
      window.removeEventListener('focus', kick)
      window.removeEventListener('pageshow', kick)
      set({ frameloop: initFrameloop })
    }
  }, [fps, advance, set, initFrameloop])

  return null
}

export default FrameLimiter
