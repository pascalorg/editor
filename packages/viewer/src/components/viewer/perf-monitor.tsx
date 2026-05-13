import { useScene } from '@pascal-app/core'
import { Html } from '@react-three/drei'
import { useFrame, useThree } from '@react-three/fiber'
import { useEffect, useRef, useState } from 'react'
import { drainGpuSamples } from '../../lib/gpu-perf'

const SAMPLE_INTERVAL = 0.5 // seconds between display updates

export const PerfMonitor = () => {
  const [stats, setStats] = useState({
    fps: 0,
    frameMs: 0,
    gpuMs: 0,
    gpuMaxMs: 0,
    drawCalls: 0,
    triangles: 0,
    dirty: 0,
    meshes: 0,
    lines: 0,
    sprites: 0,
    lights: 0,
  })
  const frameCount = useRef(0)
  const elapsed = useRef(0)
  const lastMs = useRef(0)
  // Carry the previous tick's reading forward when no fresh samples arrive,
  // so the display doesn't flicker to "—" on slow resolve windows.
  const lastGpuMs = useRef(0)
  const lastGpuMaxMs = useRef(0)

  // Take ownership of info reset. The custom RenderPipeline.render() path
  // we use in post-processing doesn't trigger three.js's automatic per-frame
  // info reset, so calls/triangles accumulate across frames and the display
  // shows lifetime totals. Disabling autoReset and explicitly resetting at
  // each window gives true per-frame averages.
  const gl = useThree((s) => s.gl)
  useEffect(() => {
    if (!gl?.info) return
    const previousAutoReset = gl.info.autoReset
    gl.info.autoReset = false
    gl.info.reset()
    return () => {
      gl.info.autoReset = previousAutoReset
    }
  }, [gl])

  useFrame(({ gl, scene, clock }) => {
    frameCount.current++
    const now = clock.elapsedTime
    const dt = now - elapsed.current

    if (dt >= SAMPLE_INTERVAL) {
      const fps = Math.round(frameCount.current / dt)
      const frameMs = lastMs.current
      const info = gl.info
      // calls/triangles have been accumulating since the last reset (start of
      // window). Divide by frameCount to get a per-frame average.
      const totalCalls = info.render?.calls ?? 0
      const totalTriangles = info.render?.triangles ?? 0
      const drawCalls = Math.round(totalCalls / Math.max(1, frameCount.current))
      const triangles = totalTriangles / Math.max(1, frameCount.current)
      info.reset()
      const dirty = useScene.getState().dirtyNodes.size

      // Count visible drawables by type so we can match scene contents
      // against the renderer's draw count and find hidden contributors.
      let meshes = 0
      let lines = 0
      let sprites = 0
      let lights = 0
      scene.traverse((obj: any) => {
        if (!obj.visible) return
        if (obj.isMesh) meshes++
        else if (obj.isLine || obj.isLineSegments || obj.isLineLoop) lines++
        else if (obj.isSprite) sprites++
        else if (obj.isLight) lights++
      })

      // GPU samples are pushed by post-processing.tsx after each pipeline
      // render via device.queue.onSubmittedWorkDone(). We drain whatever
      // has accumulated since the last tick.
      const samples = drainGpuSamples()
      if (samples.length > 0) {
        let sum = 0
        let max = 0
        for (const s of samples) {
          sum += s
          if (s > max) max = s
        }
        lastGpuMs.current = sum / samples.length
        lastGpuMaxMs.current = max
      }

      setStats({
        fps,
        frameMs,
        gpuMs: lastGpuMs.current,
        gpuMaxMs: lastGpuMaxMs.current,
        drawCalls,
        triangles,
        dirty,
        meshes,
        lines,
        sprites,
        lights,
      })
      frameCount.current = 0
      elapsed.current = now
    }

    lastMs.current = Math.round(clock.getDelta() * 1000 * 10) / 10
  })

  return (
    <Html
      position={[0, 0, 0]}
      style={{ position: 'fixed', top: 8, left: 8, pointerEvents: 'none' }}
      zIndexRange={[100, 100]}
    >
      <div
        style={{
          fontFamily: 'monospace',
          fontSize: 11,
          lineHeight: 1.5,
          color: stats.fps < 30 ? '#f87171' : stats.fps < 55 ? '#fbbf24' : '#4ade80',
          background: 'rgba(0,0,0,0.7)',
          borderRadius: 6,
          padding: '6px 10px',
          whiteSpace: 'pre',
        }}
      >
        {`FPS    ${stats.fps}
GPU    ${stats.gpuMs > 0 ? `${stats.gpuMs.toFixed(1)}ms (max ${stats.gpuMaxMs.toFixed(1)})` : '—'}
DRAW   ${stats.drawCalls}
TRI    ${(stats.triangles / 1000).toFixed(1)}k
DIRTY  ${stats.dirty}
MESH   ${stats.meshes}
LINE   ${stats.lines}
SPRITE ${stats.sprites}
LIGHT  ${stats.lights}`}
      </div>
    </Html>
  )
}
