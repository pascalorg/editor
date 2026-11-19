import {
  buildLawnChunk,
  buildLawnChunkFlowers,
  getEffectiveNode,
  LawnBuildError,
  type LawnChunkContext,
  type LawnNode,
  lawnChunkContext,
  lawnChunksTouched,
  lawnGroundChunkAt,
  useScene,
} from '@pascal-app/core'
import { type BufferAttribute, type Material, Mesh } from 'three'
import type { MeshStandardNodeMaterial } from 'three/webgpu'
import { lawnBladeMaterial } from './blade-material'
import { lawnFlowerMaterial } from './flower-material'
import { lawnChunkDetail, lawnFlowerGeometry, lawnGroundGeometry } from './geometry'
import { type LawnDetail, mountedLawnDetail } from './lod'
import {
  LAWN_STROKE_REBUILD_MS,
  LAWN_STROKE_REBUILD_SHARE,
  lawnStrokesInProgress,
  setLawnStrokeChunked,
} from './stroke-rebuild'
import { lawnGroundMaterial } from './turf-ground'

/**
 * A brush stroke in progress redraws only the chunks it can reach. The generator works by
 * one-metre cells packed in 8 m chunks, and a stroke reaches a blade or the ground only within
 * its radius, so a chunk rebuilt alone holds the bytes a full build gives it. Flowers are thinned
 * over the whole lawn: they are rebuilt whole, spaced like the old whole-lawn rebuilds. The full
 * rebuild at release replaces all of this with the saved lawn.
 */
type Session = {
  detail: LawnDetail
  context: LawnChunkContext
  strokes: LawnNode['strokes']
  ground: Map<string, Mesh>
  groundMaterial: Material
  flowers: { stale: boolean; at: number; cost: number }
}
const sessions = new Map<string, Session>()
/** Chunks rebuilt by the last update of each lawn: what a test or a probe can count. */
export const lawnStrokeChunkCounts = new Map<string, number>()

const flowering = (node: LawnNode) => node.flowerDensity > 0 && node.flowers.length > 0

function start(id: string, node: LawnNode, detail: LawnDetail): Session | null {
  const live = detail.live
  if (!live) return null
  try {
    const context = lawnChunkContext(node, useScene.getState().nodes)
    return {
      detail,
      context,
      strokes: live.strokes,
      ground: new Map(),
      groundMaterial: live.ground.material as Material,
      flowers: { stale: false, at: 0, cost: 0 },
    }
  } catch (error) {
    if (error instanceof LawnBuildError) return null
    throw error
  }
}

/** Takes one chunk's triangles out of the whole ground mesh: the chunk draws its own from now on. */
function releaseGround(session: Session, key: string) {
  const geometry = session.detail.live?.ground.geometry
  const index = geometry?.getIndex()
  const position = geometry?.getAttribute('position')
  if (!geometry || !index || !position) return
  const drawn = Math.min(index.count, geometry.drawRange.count)
  const array = index.array
  let kept = 0
  for (let offset = 0; offset + 2 < drawn; offset += 3) {
    const a = array[offset] ?? 0,
      b = array[offset + 1] ?? 0,
      c = array[offset + 2] ?? 0
    const x = (position.getX(a) + position.getX(b) + position.getX(c)) / 3
    const z = (position.getZ(a) + position.getZ(b) + position.getZ(c)) / 3
    if (lawnGroundChunkAt(session.context, x, z) === key) continue
    array[kept] = a
    array[kept + 1] = b
    array[kept + 2] = c
    kept += 3
  }
  ;(index as BufferAttribute).needsUpdate = true
  geometry.setDrawRange(0, kept)
}

function drawChunk(session: Session, node: LawnNode, chunkX: number, chunkZ: number) {
  const { detail } = session
  const live = detail.live
  if (!live) return
  const chunk = buildLawnChunk(session.context, node, chunkX, chunkZ)
  // Blades: the chunk's two meshes are replaced; every other chunk keeps its buffers.
  const at = detail.chunks.findIndex((existing) => existing.key === chunk.key)
  const previous = at >= 0 ? detail.chunks[at] : undefined
  if (previous) {
    detail.group.remove(previous.near, previous.mid)
    previous.near.geometry.dispose()
    previous.mid.geometry.dispose()
  }
  if (chunk.count) {
    live.blades ??= lawnBladeMaterial(node, live.tuftWidthScale)
    const next = lawnChunkDetail(
      node,
      chunk,
      live.blades as MeshStandardNodeMaterial,
      live.tuftWidthScale,
    )
    if (previous) next.tier = previous.tier
    detail.group.add(next.near, next.mid)
    if (at >= 0) detail.chunks[at] = next
    else detail.chunks.push(next)
  } else if (at >= 0) detail.chunks.splice(at, 1)
  // Ground: the chunk's own mesh, with the bare-soil cover once any stroke needs it.
  const painted = !!chunk.base.cover
  if (painted && !live.groundPainted && session.groundMaterial === live.ground.material) {
    const turf = lawnGroundMaterial(node, true)
    const whole = detail.groundDetail
    turf.detailed.value = whole.value
    // Distance switches the ground grain on both materials through the one handle the LOD holds.
    detail.groundDetail = {
      get value() {
        return whole.value
      },
      set value(value: number) {
        whole.value = value
        turf.detailed.value = value
      },
    }
    session.groundMaterial = turf.material
    for (const mesh of session.ground.values()) mesh.material = turf.material
  }
  let ground = session.ground.get(chunk.key)
  if (!ground) {
    releaseGround(session, chunk.key)
    ground = new Mesh(lawnGroundGeometry(chunk.base), session.groundMaterial)
    ground.name = `lawn-ground-${chunk.key}`
    ground.receiveShadow = true
    session.ground.set(chunk.key, ground)
    detail.group.add(ground)
  } else {
    ground.geometry.dispose()
    ground.geometry = lawnGroundGeometry(chunk.base)
  }
  ground.visible = chunk.base.indices.length > 0
}

function drawFlowers(session: Session, node: LawnNode, now: number) {
  const { detail, flowers } = session
  const spacing = Math.max(LAWN_STROKE_REBUILD_MS, flowers.cost / LAWN_STROKE_REBUILD_SHARE)
  if (!flowers.stale || now - flowers.at < spacing) return
  const started = performance.now()
  const built = buildLawnChunkFlowers(session.context, node)
  if (detail.flowers) {
    detail.flowers.geometry.dispose()
    detail.flowers.geometry = lawnFlowerGeometry(built)
  } else if (built.count > 0) {
    detail.flowers = new Mesh(lawnFlowerGeometry(built), lawnFlowerMaterial())
    detail.flowers.name = 'lawn-flowers'
    detail.flowers.castShadow = detail.flowers.receiveShadow = true
    detail.flowers.visible = false
    detail.group.add(detail.flowers)
  }
  detail.headIndexEnds = built.headIndexEnds
  flowers.stale = false
  flowers.at = now
  flowers.cost = performance.now() - started
}

/** Once a frame, before the viewer decides whether to rebuild: redraw what the strokes reached. */
export function updateLawnStrokeChunks(now = performance.now()): void {
  const painting = new Set(lawnStrokesInProgress())
  for (const id of sessions.keys())
    if (!painting.has(id)) {
      sessions.delete(id)
      lawnStrokeChunkCounts.delete(id)
    }
  for (const id of painting) {
    const stored = useScene.getState().nodes[id as LawnNode['id']]
    const detail = mountedLawnDetail(id)
    if (stored?.type !== 'lawn' || !detail?.live) {
      sessions.delete(id)
      setLawnStrokeChunked(id, false)
      continue
    }
    const node = getEffectiveNode(stored)
    let session = sessions.get(id)
    if (session?.detail !== detail) {
      session = start(id, node, detail) ?? undefined
      if (session) sessions.set(id, session)
      else sessions.delete(id)
    }
    setLawnStrokeChunked(id, !!session)
    if (!session) continue
    if (node.strokes !== session.strokes) {
      const touched = lawnChunksTouched(session.context, session.strokes, node.strokes)
      for (const [chunkX, chunkZ] of touched) drawChunk(session, node, chunkX, chunkZ)
      lawnStrokeChunkCounts.set(id, touched.length)
      if (touched.length && (flowering(node) || detail.flowers)) session.flowers.stale = true
      session.strokes = node.strokes
    } else lawnStrokeChunkCounts.set(id, 0)
    drawFlowers(session, node, now)
  }
}
