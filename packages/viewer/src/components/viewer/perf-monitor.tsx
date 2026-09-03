import { sceneRegistry, useScene } from '@pascal-app/core'
import { useFrame, useThree } from '@react-three/fiber'
import { useEffect, useRef } from 'react'
import { Vector3 } from 'three'
import { initPerfObservers } from '../../lib/perf-observers'
import { publishPerfStats } from '../../lib/perf-panel-store'
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

/**
 * Headless collector. Runs inside <Canvas> (it needs useFrame + gl.info) and
 * publishes each window's stats to perf-panel-store; the visible panel is
 * <PerfPanel>, mounted outside the canvas — see perf-panel.tsx for why.
 */
export const PerfMonitor = () => {
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
  const getThree = useThree((s) => s.get)
  useEffect(() => {
    initPerfObservers()
  }, [])
  // Scripted-probe hooks for the scaling-matrix runner (scripts/perf/…): only
  // mounted with `?perf`, so nothing reaches `window` in normal sessions.
  // `projectNode` returns CSS pixels relative to the canvas, ready for a
  // synthetic click on the node.
  useEffect(() => {
    const probe = {
      listNodes(type: string): string[] {
        return Object.values(useScene.getState().nodes)
          .filter((n) => n.type === type)
          .map((n) => n.id as string)
      },
      // Raw dirty-set census: total marks, marks whose node is gone (phantoms),
      // and live marks bucketed by node kind. The panel's DIRTY readout filters
      // to live nodes, so scripted runs need this to see leaks at all.
      dirtyResidue(): {
        total: number
        phantom: number
        phantomIds: string[]
        liveByType: Record<string, number>
      } {
        const { dirtyNodes, nodes } = useScene.getState()
        const phantomIds: string[] = []
        const liveByType: Record<string, number> = {}
        for (const id of dirtyNodes) {
          const node = nodes[id]
          if (!node) phantomIds.push(id as string)
          else liveByType[node.type] = (liveByType[node.type] ?? 0) + 1
        }
        return { total: dirtyNodes.size, phantom: phantomIds.length, phantomIds, liveByType }
      },
      // Draw-call composition census for the item/draw-reduction work
      // (charter backlog #3): how item draws decompose per item and per
      // asset, plus projected draw counts for the two candidate techniques —
      // per-item merge-by-material and per-asset instancing.
      drawComposition(): {
        items: number
        itemMeshes: number
        otherVisibleMeshes: number
        meshesByKind: Record<string, number>
        perItemMeshes: { avg: number; p50: number; max: number }
        assets: Array<{
          id: string
          name: string
          copies: number
          meshesPerCopy: number
          materialsPerCopy: number
        }>
        projected: { current: number; perItemMerge: number; instancedByAsset: number; both: number }
      } {
        const { nodes } = useScene.getState()
        type AssetAgg = {
          name: string
          copies: number
          meshesPerCopy: number
          materialsPerCopy: number
          uniqueMeshKeys: Set<string>
          uniqueMaterials: Set<string>
        }
        const assets = new Map<string, AssetAgg>()
        const meshesPerItem: number[] = []
        let itemMeshes = 0
        let perItemMerge = 0
        for (const node of Object.values(nodes)) {
          if (node.type !== 'item') continue
          const group = sceneRegistry.nodes.get(node.id)
          if (!group) continue
          let meshes = 0
          const materials = new Set<string>()
          const meshKeys = new Set<string>()
          group.traverse((child: any) => {
            if (!child.isMesh || child.visible === false) return
            meshes++
            const mats = Array.isArray(child.material) ? child.material : [child.material]
            for (const m of mats) if (m) materials.add(m.uuid as string)
            meshKeys.add(
              `${child.geometry?.uuid ?? '?'}|${mats.map((m: any) => m?.uuid ?? '?').join(',')}`,
            )
          })
          if (meshes === 0) continue
          itemMeshes += meshes
          meshesPerItem.push(meshes)
          perItemMerge += materials.size
          const asset = (node as { asset?: { id?: string; name?: string } }).asset
          const assetId = asset?.id ?? 'unknown'
          const agg = assets.get(assetId) ?? {
            name: asset?.name ?? assetId,
            copies: 0,
            meshesPerCopy: meshes,
            materialsPerCopy: materials.size,
            uniqueMeshKeys: new Set<string>(),
            uniqueMaterials: new Set<string>(),
          }
          agg.copies++
          for (const k of meshKeys) agg.uniqueMeshKeys.add(k)
          for (const m of materials) agg.uniqueMaterials.add(m)
          assets.set(assetId, agg)
        }
        // Bucket every registered node's meshes by kind so the non-item side
        // of the draw budget is attributable too.
        const meshesByKind: Record<string, number> = {}
        let registeredMeshes = 0
        for (const node of Object.values(nodes)) {
          const group = sceneRegistry.nodes.get(node.id)
          if (!group) continue
          let count = 0
          group.traverse((child: any) => {
            if (child.isMesh && child.visible !== false) count++
          })
          if (count === 0) continue
          meshesByKind[node.type] = (meshesByKind[node.type] ?? 0) + count
          registeredMeshes += count
        }
        let otherVisibleMeshes = 0
        const { scene } = getThree()
        scene.traverse((child: any) => {
          if (child.isMesh && child.visible !== false) otherVisibleMeshes++
        })
        meshesByKind['(unregistered)'] = Math.max(0, otherVisibleMeshes - registeredMeshes)
        otherVisibleMeshes -= itemMeshes
        let instancedByAsset = 0
        let both = 0
        for (const agg of assets.values()) {
          instancedByAsset += agg.uniqueMeshKeys.size
          both += agg.uniqueMaterials.size
        }
        const sorted = [...meshesPerItem].sort((a, b) => a - b)
        return {
          items: meshesPerItem.length,
          itemMeshes,
          otherVisibleMeshes,
          meshesByKind,
          perItemMeshes: {
            avg: Number((itemMeshes / Math.max(1, meshesPerItem.length)).toFixed(1)),
            p50: sorted[Math.floor(sorted.length / 2)] ?? 0,
            max: sorted[sorted.length - 1] ?? 0,
          },
          assets: [...assets.entries()]
            .map(([id, a]) => ({
              id,
              name: a.name,
              copies: a.copies,
              meshesPerCopy: a.meshesPerCopy,
              materialsPerCopy: a.materialsPerCopy,
            }))
            .sort((a, b) => b.copies * b.meshesPerCopy - a.copies * a.meshesPerCopy)
            .slice(0, 15),
          projected: { current: itemMeshes, perItemMerge, instancedByAsset, both },
        }
      },
      projectNode(nodeId: string): { x: number; y: number; behindCamera: boolean } | null {
        const object = sceneRegistry.nodes.get(nodeId)
        if (!object) return null
        const { camera, size } = getThree()
        const v = new Vector3()
        object.getWorldPosition(v)
        v.project(camera)
        return {
          x: ((v.x + 1) / 2) * size.width,
          y: ((1 - v.y) / 2) * size.height,
          behindCamera: v.z > 1,
        }
      },
    }
    ;(window as any).__pascalPerf = probe
    return () => {
      if ((window as any).__pascalPerf === probe) delete (window as any).__pascalPerf
    }
  }, [getThree])
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

    publishPerfStats({
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

  return null
}
