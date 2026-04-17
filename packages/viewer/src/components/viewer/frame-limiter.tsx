import { useThree } from '@react-three/fiber'
import { useLayoutEffect } from 'react'

type FrameLimiterProps = {
  fps?: number
}

const FrameLimiter: React.FC<FrameLimiterProps> = ({ fps = 50 }) => {
  const { advance, set, frameloop: initFrameloop } = useThree()

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

    set({ frameloop: 'never' })
    raf = requestAnimationFrame(tick)

    return () => {
      if (raf) {
        cancelAnimationFrame(raf)
      }
      set({ frameloop: initFrameloop })
    }
  }, [fps, advance, set, initFrameloop])

  return null
}

export default FrameLimiter
