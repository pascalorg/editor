import { useScene } from '@pascal-app/core'
import { Html } from '@react-three/drei'
import { useFrame, useThree } from '@react-three/fiber'
import { useEffect, useRef, useState } from 'react'
import { initPerfObservers } from '../../lib/perf-observers'
import { clearPerfMeasures, drainPerfCounters, type PerfCounterBucket } from '../../lib/perf-tracks'

const SAMPLE_INTERVAL = 0.5 // seconds between display updates
// Walking the scene graph is the overlay's own biggest cost on large projects,
// and the counts barely move between ticks — sample it at 2s instead of 0.5s.
const CENSUS_EVERY_TICKS = 4
const MAX_TRACK_LINES = 8

// Tracks printed on their own lines above (render path + the frame-limiter's
// whole-frame span); everything else drained from perf-tracks lands in TRACKS.
const RENDER_TRACKS = new Set(['gpu-render', 'gpu-queue', 'render-encode', 'frame-cpu'])

type TrackLine = { name: string; totalMs: number; count: number; maxMs: number }

type Census = { meshes: number; lines: number; sprites: number; lights: number }

/**
 * `scene.traverse` descends into hidden subtrees, so a collapsed level or an
 * isolated-away wing still inflated the counts. Recurse manually and cut at the
 * first invisible node — that matches what the renderer actually walks.
 */
function countVisible(object: any, out: Census): void {
  if (object.visible === false) return
  if (object.isMesh) out.meshes++
  else if (object.isLine || object.isLineSegments || object.isLineLoop) out.lines++
  else if (object.isSprite) out.sprites++
  else if (object.isLight) out.lights++
  const children = object.children
  if (!children) return
  for (let i = 0; i < children.length; i++) countVisible(children[i], out)
}

function averageOf(bucket: PerfCounterBucket | undefined): number | null {
  if (!bucket || bucket.count === 0) return null
  return bucket.totalMs / bucket.count
}

function formatMb(bytes: number): string {
  return `${Math.round(bytes / (1024 * 1024))}MB`
}

export const PerfMonitor = () => {
  const [stats, setStats] = useState({
    fps: 0,
    frameMs: 0,
    frameMaxMs: 0,
    encodeMs: 0,
    encodeMaxMs: 0,
    gpuMs: 0,
    gpuMaxMs: 0,
    gpuTracked: false,
    queueMs: 0,
    queueMaxMs: 0,
    drawCalls: 0,
    triangles: 0,
    dirty: 0,
    dirtyDetail: '',
    geometries: 0,
    textures: 0,
    gpuBytes: 0,
    heapBytes: 0,
    meshes: 0,
    lines: 0,
    sprites: 0,
    lights: 0,
    tracks: [] as TrackLine[],
  })
  const frameCount = useRef(0)
  const elapsed = useRef(0)
  const tickCount = useRef(0)
  // Carry the previous tick's reading forward when no fresh samples arrive,
  // so the display doesn't flicker to "—" on slow resolve windows.
  const lastFrame = useRef({ ms: 0, max: 0 })
  const lastGpu = useRef({ ms: 0, max: 0, seen: false })
  const lastQueue = useRef({ ms: 0, max: 0 })
  const lastEncode = useRef({ ms: 0, max: 0 })
  const lastCensus = useRef<Census>({ meshes: 0, lines: 0, sprites: 0, lights: 0 })

  // Take ownership of info reset. The custom RenderPipeline.render() path
  // we use in post-processing doesn't trigger three.js's automatic per-frame
  // info reset, so drawCalls/triangles accumulate across frames and the display
  // shows lifetime totals. Disabling autoReset and explicitly resetting at
  // each window gives true per-frame averages.
  const gl = useThree((s) => s.gl)
  useEffect(() => {
    initPerfObservers()
  }, [])
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
    if (dt < SAMPLE_INTERVAL) return

    tickCount.current++
    const fps = Math.round(frameCount.current / dt)

    const info = gl.info as any
    // drawCalls (NOT `calls`, which counts renderer.render() invocations for the
    // lifetime of the renderer and is never cleared by reset()) has been
    // accumulating since the last reset at the start of this window.
    const totalDrawCalls = info.render?.drawCalls ?? 0
    const totalTriangles = info.render?.triangles ?? 0
    const drawCalls = Math.round(totalDrawCalls / Math.max(1, frameCount.current))
    const triangles = totalTriangles / Math.max(1, frameCount.current)
    const memory = info.memory ?? {}
    info.reset()

    const sceneState = useScene.getState()
    const dirty = sceneState.dirtyNodes.size
    let dirtyDetail = ''
    if (dirty > 0) {
      const counts = new Map<string, number>()
      for (const id of sceneState.dirtyNodes) {
        const type = sceneState.nodes[id]?.type ?? 'missing'
        counts.set(type, (counts.get(type) ?? 0) + 1)
      }
      dirtyDetail = [...counts.entries()]
        .sort((a, b) => b[1] - a[1])
        .map(([type, count]) => `${count} ${type}`)
        .join(', ')
    }

    if (tickCount.current % CENSUS_EVERY_TICKS === 1) {
      const census: Census = { meshes: 0, lines: 0, sprites: 0, lights: 0 }
      countVisible(scene, census)
      lastCensus.current = census
    }

    const counters = drainPerfCounters()
    // Whole-frame main-thread work measured around FrameLimiter's advance()
    // call — this is CPU time per frame, unlike FPS which is just cadence.
    const frameAvg = averageOf(counters.get('frame-cpu'))
    if (frameAvg !== null) {
      lastFrame.current = { ms: frameAvg, max: counters.get('frame-cpu')?.maxMs ?? 0 }
    }
    const gpuAvg = averageOf(counters.get('gpu-render'))
    if (gpuAvg !== null) {
      lastGpu.current = { ms: gpuAvg, max: counters.get('gpu-render')?.maxMs ?? 0, seen: true }
    }
    const queueAvg = averageOf(counters.get('gpu-queue'))
    if (queueAvg !== null) {
      lastQueue.current = { ms: queueAvg, max: counters.get('gpu-queue')?.maxMs ?? 0 }
    }
    const encodeAvg = averageOf(counters.get('render-encode'))
    if (encodeAvg !== null) {
      lastEncode.current = { ms: encodeAvg, max: counters.get('render-encode')?.maxMs ?? 0 }
    }
    const tracks: TrackLine[] = [...counters.entries()]
      .filter(([name, bucket]) => !RENDER_TRACKS.has(name) && bucket.count > 0)
      .map(([name, bucket]) => ({
        name,
        totalMs: bucket.totalMs,
        count: bucket.count,
        maxMs: bucket.maxMs,
      }))
      .sort((a, b) => b.totalMs - a.totalMs)
      .slice(0, MAX_TRACK_LINES)

    setStats({
      fps,
      frameMs: lastFrame.current.ms,
      frameMaxMs: lastFrame.current.max,
      encodeMs: lastEncode.current.ms,
      encodeMaxMs: lastEncode.current.max,
      gpuMs: lastGpu.current.ms,
      gpuMaxMs: lastGpu.current.max,
      gpuTracked: lastGpu.current.seen,
      queueMs: lastQueue.current.ms,
      queueMaxMs: lastQueue.current.max,
      drawCalls,
      triangles,
      dirty,
      dirtyDetail,
      geometries: memory.geometries ?? 0,
      textures: memory.textures ?? 0,
      gpuBytes: memory.total ?? 0,
      heapBytes: (performance as any).memory?.usedJSHeapSize ?? 0,
      meshes: lastCensus.current.meshes,
      lines: lastCensus.current.lines,
      sprites: lastCensus.current.sprites,
      lights: lastCensus.current.lights,
      tracks,
    })

    // perf-tracks emits a `performance.measure` per span for the DevTools
    // custom tracks. The recording already captured them; without this the
    // timeline buffer grows for the whole session.
    clearPerfMeasures()

    frameCount.current = 0
    elapsed.current = now
  })

  const memLine = [
    `${stats.geometries} geo`,
    `${stats.textures} tex`,
    ...(stats.gpuBytes > 0 ? [`${formatMb(stats.gpuBytes)} gpu`] : []),
    ...(stats.heapBytes > 0 ? [`${formatMb(stats.heapBytes)} js`] : []),
  ].join('  ')

  const trackLines = stats.tracks
    .map(
      (t) =>
        ` ${t.name.padEnd(14)}${t.totalMs.toFixed(1)}ms (${t.count}×, max ${t.maxMs.toFixed(1)})`,
    )
    .join('\n')

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
          // FrameLimiter caps the loop at 50fps, so 48+ is "at the cap" —
          // grading against 60 would paint a perfectly healthy scene amber.
          color: stats.fps < 30 ? '#f87171' : stats.fps < 48 ? '#fbbf24' : '#4ade80',
          background: 'rgba(0,0,0,0.7)',
          borderRadius: 6,
          padding: '6px 10px',
          whiteSpace: 'pre',
        }}
      >
        {`FPS    ${stats.fps} (limited)
FRAME  ${stats.frameMs > 0 ? `${stats.frameMs.toFixed(1)}ms cpu (max ${stats.frameMaxMs.toFixed(1)})` : '—'}
ENCODE ${stats.encodeMs > 0 ? `${stats.encodeMs.toFixed(1)}ms (max ${stats.encodeMaxMs.toFixed(1)})` : '—'}
GPU    ${stats.gpuTracked ? `${stats.gpuMs.toFixed(1)}ms (max ${stats.gpuMaxMs.toFixed(1)})` : '— (no timestamp-query)'}
QUEUE  ${stats.queueMs > 0 ? `${stats.queueMs.toFixed(1)}ms (max ${stats.queueMaxMs.toFixed(1)})` : '—'}
DRAW   ${stats.drawCalls}
TRI    ${(stats.triangles / 1000).toFixed(1)}k
MEM    ${memLine}
DIRTY  ${stats.dirty}${stats.dirtyDetail ? ` (${stats.dirtyDetail})` : ''}
VIS    ${stats.meshes} mesh  ${stats.lines} line  ${stats.sprites} sprite  ${stats.lights} light (in scene, not drawn)${
          trackLines ? `\nTRACKS\n${trackLines}` : ''
        }`}
      </div>
    </Html>
  )
}
