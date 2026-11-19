import type { LawnNode } from '@pascal-app/core'
import {
  type Camera,
  Frustum,
  type Group,
  type Material,
  Matrix4,
  type Mesh,
  type Object3D,
  type Sphere,
  Vector3,
} from 'three'
import { setLawnBladeView } from './blade-material'

export type LawnTier = 'near' | 'mid' | 'far'
export type LawnDetailChunk = {
  key: string
  near: Mesh
  mid: Mesh
  count: number
  midCount: number
  sphere: Sphere
  tier: LawnTier
}
/** What a brush stroke needs to redraw single chunks of a mounted lawn. */
export type LawnLive = {
  nodeId: string
  strokes: LawnNode['strokes']
  ground: Mesh
  groundPainted: boolean
  blades?: Material
  tuftWidthScale: number
}
export type LawnDetail = {
  group: Group
  height: number
  groundDetail: { value: number }
  chunks: LawnDetailChunk[]
  flowers?: Mesh
  headIndexEnds: Uint32Array
  live?: LawnLive
}
const details = new WeakMap<Object3D, LawnDetail>()
const builds = new Map<string, WeakRef<LawnDetail>[]>()
export function registerLawnDetail(detail: LawnDetail) {
  details.set(detail.group, detail)
  if (!detail.live) return
  const kept = (builds.get(detail.live.nodeId) ?? []).filter((build) => build.deref())
  builds.set(detail.live.nodeId, [...kept, new WeakRef(detail)])
}
/** The build of a lawn that is in a scene now; exports and replaced builds are not. */
export function mountedLawnDetail(nodeId: string): LawnDetail | undefined {
  for (const build of builds.get(nodeId) ?? []) {
    const detail = build.deref()
    let root: Object3D | null | undefined = detail?.group
    while (root?.parent) root = root.parent
    if (detail && root && 'isScene' in root) return detail
  }
  return undefined
}
export function unregisterLawnDetail(group: Object3D) {
  details.delete(group)
}

export const LAWN_VIEW_LIMITS = { near: 64000, mid: 32000, flowers: 1024 } as const

function tierFor(pixels: number, previous: LawnTier): LawnTier {
  if (pixels >= (previous === 'near' ? 1.6 : 2.2)) return 'near'
  if (pixels >= (previous === 'far' ? 0.4 : 0.25)) return 'mid'
  return 'far'
}

type LawnView = { frustum: Frustum; eye: Vector3; perspective: boolean; projectionScale: number }
type VisibleChunk = { detail: LawnDetail; chunk: LawnDetailChunk; distance: number }
type LawnViewCounts = { near: number; mid: number; flowers: number }

function visibleChunks(detail: LawnDetail, view: LawnView): VisibleChunk[] {
  const visible: VisibleChunk[] = []
  const scale = detail.group.getWorldScale(new Vector3()).y
  for (const chunk of detail.chunks) {
    const material = chunk.near.material
    if (!Array.isArray(material))
      setLawnBladeView(material, view.projectionScale * scale, view.perspective)
    chunk.near.visible = chunk.mid.visible = false
    const sphere = chunk.sphere.clone().applyMatrix4(detail.group.matrixWorld)
    if (!view.frustum.intersectsSphere(sphere)) {
      chunk.tier = 'far'
      continue
    }
    const distance = Math.max(0.1, view.eye.distanceTo(sphere.center) - sphere.radius * 0.35)
    const pixels =
      (detail.height * scale * view.projectionScale) / (view.perspective ? distance : 1)
    chunk.tier = tierFor(pixels, chunk.tier)
    if (chunk.tier !== 'far') visible.push({ detail, chunk, distance })
  }
  detail.groundDetail.value = visible.length ? 1 : 0
  if (detail.flowers) detail.flowers.visible = false
  return visible
}

function proportionalCounts(requests: number[], limit: number): number[] {
  const total = requests.reduce((sum, count) => sum + count, 0)
  if (total <= limit) return requests
  let requested = 0
  let allocated = 0
  return requests.map((count) => {
    requested += count
    const through = Math.floor((requested * limit) / total)
    const allocation = through - allocated
    allocated = through
    return allocation
  })
}

function allocateTier(visible: VisibleChunk[], tier: 'near' | 'mid', counts: LawnViewCounts) {
  const selected = visible.filter(({ chunk }) => chunk.tier === tier)
  const requests = selected.map(({ chunk }) => (tier === 'near' ? chunk.count : chunk.midCount))
  const allocations = proportionalCounts(requests, LAWN_VIEW_LIMITS[tier])
  selected.forEach(({ chunk }, index) => {
    const count = allocations[index] ?? 0
    const mesh = tier === 'near' ? chunk.near : chunk.mid
    const geometry = mesh.geometry
    if ('instanceCount' in geometry) geometry.instanceCount = count
    mesh.visible = count > 0
    counts[tier] += count
  })
}

function flowerVisible(detail: LawnDetail, detailedLawns: Set<LawnDetail>, view: LawnView) {
  if (!detail.flowers) return false
  if (detailedLawns.has(detail)) return true
  const sphere = detail.flowers.geometry.boundingSphere
    ?.clone()
    .applyMatrix4(detail.group.matrixWorld)
  if (!sphere || !view.frustum.intersectsSphere(sphere)) return false
  const distance = Math.max(0.1, view.eye.distanceTo(sphere.center))
  const scale = detail.group.getWorldScale(new Vector3()).y
  const pixels = (detail.height * scale * view.projectionScale) / (view.perspective ? distance : 1)
  return pixels >= 0.4
}

function allocateFlowers(
  lawns: LawnDetail[],
  detailedLawns: Set<LawnDetail>,
  view: LawnView,
  counts: LawnViewCounts,
) {
  const selected = lawns.filter((detail) => flowerVisible(detail, detailedLawns, view))
  const allocations = proportionalCounts(
    selected.map((detail) => detail.headIndexEnds.length),
    LAWN_VIEW_LIMITS.flowers,
  )
  selected.forEach((detail, index) => {
    if (!detail.flowers) return
    const heads = allocations[index] ?? 0
    detail.flowers.visible = heads > 0
    detail.flowers.geometry.setDrawRange(0, heads > 0 ? (detail.headIndexEnds[heads - 1] ?? 0) : 0)
    counts.flowers += heads
  })
}

/** A single allocation pass over every lawn in the view; camera motion changes counts only. */
export function updateLawnLOD(
  root: Object3D,
  camera: Camera,
  viewportHeight = 900,
): LawnViewCounts {
  root.updateWorldMatrix(true, true)
  camera.updateWorldMatrix(true, false)
  const view: LawnView = {
    frustum: new Frustum().setFromProjectionMatrix(
      new Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse),
    ),
    eye: new Vector3().setFromMatrixPosition(camera.matrixWorld),
    perspective: camera.projectionMatrix.elements[15] === 0,
    projectionScale: (Math.abs(camera.projectionMatrix.elements[5] ?? 1) * viewportHeight) / 2,
  }
  const visible: VisibleChunk[] = []
  const lawns: LawnDetail[] = []
  root.traverseVisible((object) => {
    const detail = details.get(object)
    if (!detail) return
    lawns.push(detail)
    visible.push(...visibleChunks(detail, view))
  })
  visible.sort((first, second) => first.distance - second.distance)
  const counts = { near: 0, mid: 0, flowers: 0 }
  allocateTier(visible, 'near', counts)
  allocateTier(visible, 'mid', counts)
  const detailedLawns = new Set(visible.map(({ detail }) => detail))
  allocateFlowers(lawns, detailedLawns, view, counts)
  return counts
}
