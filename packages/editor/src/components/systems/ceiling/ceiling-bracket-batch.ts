import type { CeilingNode } from '@pascal-app/core'
import {
  BoxGeometry,
  Color,
  Euler,
  InstancedMesh,
  type Intersection,
  Matrix4,
  MeshBasicMaterial,
  type Object3D,
  Quaternion,
  Sphere,
  StaticDrawUsage,
  Vector3,
} from 'three'

export const BRACKET_Y_OFFSET = 0.035
const SHARED_HANDLE_BOX_GEOMETRY = new BoxGeometry(1, 1, 1)
SHARED_HANDLE_BOX_GEOMETRY.computeBoundingSphere()
const NORMAL_COLOR = new Color('#d4d4d4')
const HIGHLIGHT_COLOR = new Color('#818cf8')

export type CornerBracketData = {
  corner: [number, number]
  index: number
  incomingEdgeIndex: number
  incomingDirection: [number, number]
  outgoingEdgeIndex: number
  outgoingDirection: [number, number]
  incomingLength: number
  outgoingLength: number
}

export type BracketPart = 'incoming' | 'outgoing' | 'cube'
export type BracketTarget = {
  ceilingId: CeilingNode['id']
  cornerIndex: number
  part: BracketPart
}

type BracketInstance = BracketTarget & {
  matrix: Matrix4
  highlighted: boolean
  instanceId: number
}

type CeilingInstances = {
  corners: CornerBracketData[]
  height: number
  activeCornerIndex: number | null
  instances: BracketInstance[]
}

type BracketBatch = {
  mesh: InstancedMesh<BoxGeometry, MeshBasicMaterial>
  instances: BracketInstance[]
}

export function growBracketCapacity(current: number, required: number): number {
  return required <= current ? current : Math.max(32, required * 2)
}

export function getBracketHighlights(cornerCount: number, activeCornerIndex: number | null) {
  const edges = new Set<number>()
  const corners = new Set<number>()
  if (activeCornerIndex !== null && cornerCount >= 2) {
    const previous = (activeCornerIndex - 1 + cornerCount) % cornerCount
    edges.add(activeCornerIndex)
    edges.add(previous)
    corners.add(activeCornerIndex)
    corners.add(previous)
    corners.add((activeCornerIndex + 1) % cornerCount)
  }
  return { edges, corners }
}

export function getBracketMatrix(corner: CornerBracketData, part: BracketPart, height: number) {
  const position = new Vector3(corner.corner[0], height + BRACKET_Y_OFFSET, corner.corner[1])
  const rotation = new Quaternion()
  const scale = new Vector3(0.28, 0.08, 0.28)
  if (part !== 'cube') {
    const direction = part === 'incoming' ? corner.incomingDirection : corner.outgoingDirection
    const length = part === 'incoming' ? corner.incomingLength : corner.outgoingLength
    position.x += direction[0] * (length / 2)
    position.z += direction[1] * (length / 2)
    rotation.setFromEuler(new Euler(0, -Math.atan2(direction[1], direction[0]), 0))
    scale.set(length, 0.04, 0.04)
  }
  return new Matrix4().compose(position, rotation, scale)
}

function createBatch(highlighted: boolean, capacity: number): BracketBatch {
  const material = new MeshBasicMaterial({
    transparent: true,
    opacity: highlighted ? 0.92 : 0.72,
    depthTest: true,
    depthWrite: false,
  })
  // WebGPU releases instance attributes through the geometry's dispose listener.
  const mesh = new InstancedMesh(SHARED_HANDLE_BOX_GEOMETRY.clone(), material, capacity)
  mesh.name = highlighted ? 'ceiling-brackets-highlighted' : 'ceiling-brackets-normal'
  mesh.renderOrder = highlighted ? 1001 : 1000
  mesh.frustumCulled = false
  // Three 0.185.1 re-uploads the whole matrix array every render when it fits the device's
  // uniform-buffer limit (roughly 1024 matrices), ignoring versions/ranges; accepted for
  // small batches. Above that limit, the attribute path honors versions and ranges.
  mesh.instanceMatrix.setUsage(StaticDrawUsage)
  mesh.setColorAt(0, highlighted ? HIGHLIGHT_COLOR : NORMAL_COLOR)
  mesh.instanceColor!.setUsage(StaticDrawUsage)
  mesh.onAfterRender = () => {
    // TSL uploads internal wrappers; clear the source ranges after they have been consumed.
    mesh.instanceMatrix.clearUpdateRanges()
    mesh.instanceColor!.clearUpdateRanges()
  }
  mesh.count = 0
  mesh.boundingSphere = new Sphere()
  return { mesh, instances: [] }
}

export class CeilingBracketBatchStore {
  private readonly ceilings = new Map<CeilingNode['id'], CeilingInstances>()
  private readonly batches = [createBatch(false, 32), createBatch(true, 32)]
  private readonly listeners = new Set<() => void>()
  private meshes = this.batches.map((batch) => batch.mesh)
  private readonly instanceSphere = new Sphere()

  readonly getSnapshot = () => this.meshes
  readonly subscribe = (listener: () => void) => {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  getTarget(object: Object3D, instanceId: number | undefined): BracketTarget | undefined {
    if (instanceId === undefined) return undefined
    return this.batches.find((batch) => batch.mesh === object)?.instances[instanceId]
  }

  resolveHitTarget(
    event: Pick<Intersection, 'object' | 'instanceId' | 'distance'>,
    hits: Array<Pick<Intersection, 'object' | 'instanceId' | 'distance'>>,
  ) {
    let target = this.getTarget(event.object, event.instanceId)
    if (!target) return undefined
    // Equal-distance ownership must not depend on which opacity batch is raycast first.
    for (const hit of hits) {
      if (hit.distance !== event.distance) continue
      const candidate = this.getTarget(hit.object, hit.instanceId)
      if (candidate && bracketTargetKey(candidate) < bracketTargetKey(target)) target = candidate
    }
    return target
  }

  getLocation(target: BracketTarget) {
    const instance = this.ceilings
      .get(target.ceilingId)
      ?.instances.find(
        (item) => item.cornerIndex === target.cornerIndex && item.part === target.part,
      )
    if (!instance) return undefined
    return {
      mesh: this.batches[Number(instance.highlighted)]!.mesh,
      instanceId: instance.instanceId,
    }
  }

  setGeometry(ceilingId: CeilingNode['id'], corners: CornerBracketData[], height: number) {
    let ceiling = this.ceilings.get(ceilingId)
    if (ceiling?.corners === corners && ceiling.height === height) return
    if (!ceiling || ceiling.corners.length !== corners.length) {
      const activeCornerIndex = ceiling?.activeCornerIndex ?? null
      this.removeCeiling(ceilingId)
      ceiling = { corners, height, activeCornerIndex: null, instances: [] }
      this.ceilings.set(ceilingId, ceiling)
      this.ensureCapacity(false, this.batches[0]!.instances.length + corners.length * 3)
      for (const corner of corners) {
        for (const part of ['incoming', 'outgoing', 'cube'] as const) {
          const instance: BracketInstance = {
            ceilingId,
            cornerIndex: corner.index,
            part,
            matrix: getBracketMatrix(corner, part, height),
            highlighted: false,
            instanceId: -1,
          }
          ceiling.instances.push(instance)
          this.append(instance)
        }
      }
      this.setHighlight(ceilingId, activeCornerIndex)
      return
    }
    ceiling.corners = corners
    ceiling.height = height
    for (const instance of ceiling.instances) {
      instance.matrix = getBracketMatrix(corners[instance.cornerIndex]!, instance.part, height)
      this.write(instance)
    }
  }

  setHighlight(ceilingId: CeilingNode['id'], activeCornerIndex: number | null) {
    const ceiling = this.ceilings.get(ceilingId)
    if (!ceiling || ceiling.activeCornerIndex === activeCornerIndex) return
    ceiling.activeCornerIndex = activeCornerIndex
    const { edges, corners } = getBracketHighlights(ceiling.corners.length, activeCornerIndex)
    for (const instance of ceiling.instances) {
      const corner = ceiling.corners[instance.cornerIndex]!
      const highlighted =
        instance.part === 'cube'
          ? corners.has(instance.cornerIndex)
          : edges.has(
              instance.part === 'incoming' ? corner.incomingEdgeIndex : corner.outgoingEdgeIndex,
            )
      if (highlighted === instance.highlighted) continue
      this.remove(instance)
      instance.highlighted = highlighted
      this.append(instance)
    }
  }

  removeCeiling(ceilingId: CeilingNode['id']) {
    const ceiling = this.ceilings.get(ceilingId)
    if (!ceiling) return
    for (const instance of ceiling.instances) this.remove(instance)
    this.ceilings.delete(ceilingId)
  }

  dispose() {
    for (const batch of this.batches) {
      batch.mesh.geometry.dispose()
      batch.mesh.dispose()
      batch.mesh.material.dispose()
    }
  }

  private ensureCapacity(highlighted: boolean, required: number) {
    const index = Number(highlighted)
    const batch = this.batches[index]!
    const capacity = growBracketCapacity(batch.mesh.instanceMatrix.count, required)
    if (capacity === batch.mesh.instanceMatrix.count) return
    const replacement = createBatch(highlighted, capacity)
    replacement.instances = batch.instances
    this.batches[index] = replacement
    for (const instance of replacement.instances) this.write(instance)
    replacement.mesh.count = replacement.instances.length
    batch.mesh.geometry.dispose()
    batch.mesh.dispose()
    batch.mesh.material.dispose()
    this.meshes = this.batches.map((item) => item.mesh)
    for (const listener of this.listeners) listener()
  }

  private append(instance: BracketInstance) {
    this.ensureCapacity(
      instance.highlighted,
      this.batches[Number(instance.highlighted)]!.instances.length + 1,
    )
    const batch = this.batches[Number(instance.highlighted)]!
    instance.instanceId = batch.instances.length
    batch.instances.push(instance)
    batch.mesh.count = batch.instances.length
    this.write(instance)
  }

  private remove(instance: BracketInstance) {
    const batch = this.batches[Number(instance.highlighted)]!
    const last = batch.instances.pop()!
    if (last !== instance) {
      last.instanceId = instance.instanceId
      batch.instances[last.instanceId] = last
      this.write(last)
    }
    batch.mesh.count = batch.instances.length
  }

  private write(instance: BracketInstance) {
    const mesh = this.batches[Number(instance.highlighted)]!.mesh
    mesh.setMatrixAt(instance.instanceId, instance.matrix)
    mesh.setColorAt(instance.instanceId, instance.highlighted ? HIGHLIGHT_COLOR : NORMAL_COLOR)
    mesh.instanceMatrix.addUpdateRange(instance.instanceId * 16, 16)
    mesh.instanceColor!.addUpdateRange(instance.instanceId * 3, 3)
    mesh.instanceMatrix.needsUpdate = true
    mesh.instanceColor!.needsUpdate = true
    // Native InstancedMesh.raycast still tests its sphere even with frustum culling off.
    // Expand it on writes; retaining removed instances' bounds avoids a full scan on hover.
    this.instanceSphere
      .copy(SHARED_HANDLE_BOX_GEOMETRY.boundingSphere!)
      .applyMatrix4(instance.matrix)
    mesh.boundingSphere!.union(this.instanceSphere)
  }
}

export function bracketTargetKey(target: BracketTarget) {
  return `${target.ceilingId}/${target.cornerIndex}/${target.part}`
}

export class BracketPointerState {
  private readonly hovered = new Map<string, BracketTarget>()
  private initialTargets = new Set<string>()

  over(key: string, target: BracketTarget) {
    const previous = this.hovered.get(key)
    this.hovered.set(key, target)
    return previous
  }

  out(key: string) {
    // R3F's pointer-out contains the old instanceId, which may now belong to another corner.
    const target = this.hovered.get(key)
    this.hovered.delete(key)
    return target
  }

  replaceObject(previousUuid: string, nextUuid: string) {
    for (const [key, target] of this.hovered) {
      if (!key.startsWith(`${previousUuid}/`)) continue
      this.hovered.delete(key)
      this.hovered.set(nextUuid + key.slice(previousUuid.length), target)
    }
  }

  clearHover() {
    const targets = [...this.hovered.values()]
    this.hovered.clear()
    return targets
  }

  pointerDown(targets: BracketTarget[]) {
    this.initialTargets = new Set(targets.map(bracketTargetKey))
  }

  canClick(target: BracketTarget) {
    return this.initialTargets.has(bracketTargetKey(target))
  }
}

export function buildCornerBrackets(polygon: Array<[number, number]>): CornerBracketData[] {
  if (polygon.length < 3) return []

  return polygon.map((corner, index) => {
    const previous = polygon[(index - 1 + polygon.length) % polygon.length]!
    const next = polygon[(index + 1) % polygon.length]!
    const incomingVector = [previous[0] - corner[0], previous[1] - corner[1]] as [number, number]
    const outgoingVector = [next[0] - corner[0], next[1] - corner[1]] as [number, number]
    const incomingDirection = normalize2D(incomingVector)
    const outgoingDirection = normalize2D(outgoingVector)

    const incomingLength = Math.hypot(incomingVector[0], incomingVector[1])
    const outgoingLength = Math.hypot(outgoingVector[0], outgoingVector[1])

    return {
      corner,
      index,
      incomingEdgeIndex: (index - 1 + polygon.length) % polygon.length,
      incomingDirection,
      outgoingEdgeIndex: index,
      outgoingDirection,
      incomingLength: getBracketLength(incomingLength),
      outgoingLength: getBracketLength(outgoingLength),
    }
  })
}

function normalize2D(vector: [number, number]): [number, number] {
  const length = Math.hypot(vector[0], vector[1])
  if (length < 1e-6) return [1, 0]
  return [vector[0] / length, vector[1] / length]
}

function getBracketLength(edgeLength: number): number {
  return Math.max(0.14, Math.min(0.38, edgeLength * 0.22))
}
