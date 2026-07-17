import { useThree } from '@react-three/fiber'
import { useLayoutEffect } from 'react'
import useViewer from '../../store/use-viewer'

type FrameLimiterProps = {
  fps?: number
}

// `?disable=draw` (see post-processing.tsx): the page renders no real frames,
// and Chromium's no-damage scheduler then throttles requestAnimationFrame to
// 1Hz on Linux (measured in the headless bake worker — every useFrame system
// ticked once per second and a heavy scene took 300+ seconds to settle). A
// plain timer is never throttled on a visible page, so drive the loop with
// setInterval instead of rAF when nothing is drawn.
const DRAW_DISABLED =
  typeof window !== 'undefined' &&
  new Set(
    (new URLSearchParams(window.location.search).get('disable') ?? '')
      .split(',')
      .map((s) => s.trim()),
  ).has('draw')

const FrameLimiter: React.FC<FrameLimiterProps> = ({ fps = 50 }) => {
  const { advance, set, frameloop: initFrameloop } = useThree()
  const renderer = useThree((state) => state.gl)
  const size = useThree((state) => state.size)
  const dpr = useThree((state) => state.viewport.dpr)
  // Fully covered canvas (e.g. studio gallery) → stop advancing frames
  const renderPaused = useViewer((s) => s.renderPaused)

  useLayoutEffect(() => {
    if (renderPaused) return
    let elapsed = 0
    let then = 0
    let i = 0
    let raf: number | null = null
    let timer: ReturnType<typeof setInterval> | null = null
    let sizeSynced = false
    const interval = 1000 / fps
    function tick(t: DOMHighResTimeStamp) {
      raf = requestAnimationFrame(tick)
      if (!sizeSynced) {
        renderer.setPixelRatio(dpr)
        renderer.setSize(size.width, size.height, false)
        sizeSynced = true
      }
      elapsed = t - then
      if (elapsed > interval) {
        advance(i)
        i += elapsed / 1000 - (elapsed % interval) / 1000
        then = t - (elapsed % interval)
      }
    }
    // Set frameloop to never, it will shut down the default render loop
    set({ frameloop: 'never' })
    if (DRAW_DISABLED) {
      timer = setInterval(() => {
        i += interval / 1000
        advance(i)
      }, interval)
    } else {
      // Kick off custom render loop
      raf = requestAnimationFrame(tick)
    }
    // Restore initial setting
    return () => {
      if (raf) {
        cancelAnimationFrame(raf)
      }
      if (timer) {
        clearInterval(timer)
      }
      set({ frameloop: initFrameloop })
    }
  }, [advance, dpr, fps, initFrameloop, renderPaused, renderer, set, size.height, size.width])

  return null
}

export default FrameLimiter
