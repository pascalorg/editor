'use client'

import {
  type AnyNode,
  type AnyNodeId,
  type DynamicAxis,
  type DynamicBinding,
  type DynamicJointBinding,
  type DynamicJointChannel,
  type DynamicType,
  getLiveDataValue,
  getNodeSemanticType,
  getTransferConnections,
  type LiveDataValue,
  readDynamicMetadata,
  resolveBindingColor,
  samplePipeCenterline3D,
  sceneRegistry,
  useScene,
} from '@pascal-app/core'
import { useFrame } from '@react-three/fiber'
import { useEffect, useRef } from 'react'
import {
  BoxGeometry,
  BufferGeometry,
  CatmullRomCurve3,
  Color,
  ConeGeometry,
  CylinderGeometry,
  Float32BufferAttribute,
  Group,
  Line,
  LineBasicMaterial,
  type Material,
  Mesh,
  MeshBasicMaterial,
  type Object3D,
  Quaternion,
  SphereGeometry,
  TubeGeometry,
  Vector3,
} from 'three'
import useEditor from '../../../store/use-editor'

type MaterialWithColor = Material & {
  color?: Color
  opacity?: number
  transparent?: boolean
  depthWrite?: boolean
}

type ObjectSnapshot = {
  visible: boolean
  position: Vector3
  rotation: [number, number, number]
  scale: Vector3
  materialColors: {
    material: MaterialWithColor
    color: Color
    opacity: number
    transparent: boolean
    depthWrite: boolean
  }[]
}

function isConveyorSemanticType(semanticType: string) {
  return semanticType === 'conveyor'
}

type RuntimeEntry = {
  node: AnyNode
  object: Object3D
  bindings: DynamicBinding[]
  jointChannels: DynamicJointChannel[]
  jointBindings: DynamicJointBinding[]
  snapshot: ObjectSnapshot
  jointSnapshots: Map<string, ObjectSnapshot>
  conveyorClones: Object3D[]
  conveyorKey: string | null
  conveyorTemplateObject: Object3D | null
  flowArrows: Object3D[]
  flowArrowKey: string | null
  flowRipples: Object3D[]
  flowRippleKey: string | null
  flowFill: Mesh | null
  flowFillKey: string | null
  levelFill: Object3D | null
  levelFillKey: string | null
  hiddenLevelObjects: Array<{ object: Object3D; visible: boolean }>
  valveHandle: Object3D | null
  moveOffsets: Record<string, number>
}

const hiddenConveyorTemplates = new Map<Object3D, { visible: boolean; owners: Set<string> }>()
const FLOW_WORLD_POINT = new Vector3()

function collectColorMaterials(object: Object3D) {
  const materials: MaterialWithColor[] = []
  object.traverse((child) => {
    const mesh = child as Mesh
    const material = mesh.material
    if (Array.isArray(material)) {
      for (const item of material) {
        if ('color' in item && item.color instanceof Color)
          materials.push(item as MaterialWithColor)
      }
    } else if (material && 'color' in material && material.color instanceof Color) {
      materials.push(material as MaterialWithColor)
    }
  })
  return materials
}

function captureSnapshot(object: Object3D): ObjectSnapshot {
  return {
    visible: object.visible,
    position: object.position.clone(),
    rotation: [object.rotation.x, object.rotation.y, object.rotation.z],
    scale: object.scale.clone(),
    materialColors: collectColorMaterials(object).map((material) => ({
      material,
      color: material.color!.clone(),
      opacity: material.opacity ?? 1,
      transparent: material.transparent ?? false,
      depthWrite: material.depthWrite ?? true,
    })),
  }
}

function restoreSnapshot(object: Object3D | undefined, snapshot: ObjectSnapshot | undefined) {
  if (!(object && snapshot)) return
  object.visible = snapshot.visible
  object.position.copy(snapshot.position)
  object.rotation.set(snapshot.rotation[0], snapshot.rotation[1], snapshot.rotation[2])
  object.scale.copy(snapshot.scale)
  for (const entry of snapshot.materialColors) {
    entry.material.color?.copy(entry.color)
    entry.material.opacity = entry.opacity
    entry.material.transparent = entry.transparent
    entry.material.depthWrite = entry.depthWrite
    entry.material.needsUpdate = true
  }
}

function clearConveyorClones(entry: RuntimeEntry) {
  restoreConveyorTemplate(entry)
  for (const clone of entry.conveyorClones) {
    clone.removeFromParent()
    clone.traverse((child) => {
      const mesh = child as Mesh
      const geometry = mesh.geometry
      const material = mesh.material
      if (clone.userData.dynamicFallbackCargo && geometry && 'dispose' in geometry)
        geometry.dispose()
      if (Array.isArray(material)) {
        for (const item of material) item.dispose()
      } else {
        material?.dispose()
      }
    })
  }
  entry.conveyorClones = []
  entry.conveyorKey = null
}

function hideConveyorTemplate(entry: RuntimeEntry, template: Object3D | undefined) {
  if (!template || template === entry.object) {
    restoreConveyorTemplate(entry)
    return
  }
  if (entry.conveyorTemplateObject && entry.conveyorTemplateObject !== template) {
    restoreConveyorTemplate(entry)
  }
  let record = hiddenConveyorTemplates.get(template)
  if (!record) {
    record = { visible: template.visible, owners: new Set() }
    hiddenConveyorTemplates.set(template, record)
  }
  record.owners.add(entry.node.id)
  template.visible = false
  entry.conveyorTemplateObject = template
}

function restoreConveyorTemplate(entry: RuntimeEntry) {
  const template = entry.conveyorTemplateObject
  if (!template) return
  const record = hiddenConveyorTemplates.get(template)
  if (record) {
    record.owners.delete(entry.node.id)
    if (record.owners.size === 0) {
      template.visible = record.visible
      hiddenConveyorTemplates.delete(template)
    }
  }
  entry.conveyorTemplateObject = null
}

function restoreJointSnapshots(entry: RuntimeEntry) {
  for (const [nodeId, snapshot] of entry.jointSnapshots) {
    const object = sceneRegistry.nodes.get(nodeId as AnyNodeId)
    if (object) restoreSnapshot(object, snapshot)
  }
  entry.jointSnapshots.clear()
}

function disposeObject(object: Object3D) {
  object.removeFromParent()
  object.traverse((child) => {
    const mesh = child as Mesh
    const geometry = mesh.geometry
    const material = mesh.material
    if (geometry && 'dispose' in geometry) geometry.dispose()
    if (Array.isArray(material)) {
      for (const item of material) item.dispose()
    } else {
      material?.dispose()
    }
  })
}

function clearFlowArrows(entry: RuntimeEntry) {
  for (const arrow of entry.flowArrows) disposeObject(arrow)
  entry.flowArrows = []
  entry.flowArrowKey = null
}

function clearFlowRipples(entry: RuntimeEntry) {
  for (const ripple of entry.flowRipples) disposeObject(ripple)
  entry.flowRipples = []
  entry.flowRippleKey = null
}

function clearFlowFill(entry: RuntimeEntry) {
  if (entry.flowFill) disposeObject(entry.flowFill)
  entry.flowFill = null
  entry.flowFillKey = null
}

function clearLevelFill(entry: RuntimeEntry) {
  if (entry.levelFill) disposeObject(entry.levelFill)
  entry.levelFill = null
  entry.levelFillKey = null
  restoreHiddenLevelObjects(entry)
}

function restoreHiddenLevelObjects(entry: RuntimeEntry) {
  for (const hidden of entry.hiddenLevelObjects) {
    hidden.object.visible = hidden.visible
  }
  entry.hiddenLevelObjects = []
}

function clearValveHandle(entry: RuntimeEntry) {
  if (entry.valveHandle) disposeObject(entry.valveHandle)
  entry.valveHandle = null
}

function clearIndustrialVisuals(entry: RuntimeEntry) {
  clearFlowArrows(entry)
  clearFlowRipples(entry)
  clearFlowFill(entry)
  clearLevelFill(entry)
  clearValveHandle(entry)
}

function axisIndex(axis: DynamicAxis | undefined): 0 | 1 | 2 {
  if (axis === 'x') return 0
  if (axis === 'z') return 2
  return 1
}

function numericValue(value: LiveDataValue | undefined): number {
  if (typeof value === 'number') return value
  if (typeof value === 'boolean') return value ? 1 : 0
  const numeric = Number(value)
  return Number.isFinite(numeric) ? numeric : 0
}

function truthyValue(value: LiveDataValue | undefined): boolean {
  if (typeof value === 'boolean') return value
  if (typeof value === 'number') return value > 0
  return Boolean(value)
}

function equalsConditionValue(value: LiveDataValue | undefined, expected: DynamicBinding['value']) {
  if (expected == null) return false
  if (typeof expected === 'boolean') return value === expected
  if (typeof expected === 'number') return numericValue(value) === expected
  return String(value ?? '') === expected
}

function evaluateDynamicCondition(binding: DynamicBinding) {
  const value = getBindingValue(binding)
  if (binding.condition === 'greaterThan') return numericValue(value) > numericValue(binding.value)
  if (binding.condition === 'lessThan') return numericValue(value) < numericValue(binding.value)
  if (binding.condition === 'equals') return equalsConditionValue(value, binding.value)
  return truthyValue(value)
}

function mapRange(value: number, input: [number, number], output: [number, number]) {
  const [inMin, inMax] = input
  const [outMin, outMax] = output
  if (inMin === inMax) return outMin
  const ratio = Math.max(0, Math.min(1, (value - inMin) / (inMax - inMin)))
  return outMin + (outMax - outMin) * ratio
}

function getBindingValue(binding: DynamicBinding): LiveDataValue | undefined {
  return getLiveDataValue(binding.path)
}

function applyColor(object: Object3D, snapshot: ObjectSnapshot, binding: DynamicBinding) {
  const value = getBindingValue(binding)
  let color: string | Color | null | undefined
  if (binding.colorMode === 'gradient') {
    const ratio = mapRange(numericValue(value), binding.inputRange ?? [0, 100], [0, 1])
    color = new Color().lerpColors(
      new Color(binding.color ?? '#35c8ff'),
      new Color(binding.endColor ?? '#ff3b30'),
      ratio,
    )
  } else {
    if (binding.condition && !evaluateDynamicCondition(binding)) return
    color = binding.color ?? resolveBindingColor(value)
  }
  if (!color) return
  for (const entry of snapshot.materialColors) {
    entry.material.color?.set(color)
    entry.material.needsUpdate = true
  }
}

function summarizeMaterialColors(entry: RuntimeEntry) {
  return entry.snapshot.materialColors.map(({ material }) => ({
    color: material.color ? `#${material.color.getHexString()}` : null,
    opacity: material.opacity ?? 1,
    transparent: material.transparent ?? false,
  }))
}

function createFlowArrow(color: string) {
  const group = new Group()
  const material = new MeshBasicMaterial({
    color,
    transparent: true,
    opacity: 0.9,
    depthWrite: false,
  })
  const shaft = new Mesh(new BoxGeometry(0.28, 0.045, 0.045), material.clone())
  const head = new Mesh(new ConeGeometry(0.09, 0.18, 12), material.clone())
  shaft.position.x = -0.06
  head.position.x = 0.14
  head.rotation.z = -Math.PI / 2
  group.add(shaft)
  group.add(head)
  group.userData.dynamicFlowArrow = true
  return group
}

function flowVisualParent(entry: RuntimeEntry) {
  return entry.node.type === 'pipe' ? entry.object : entry.object.parent
}

function copyFlowPoint(entry: RuntimeEntry, object: Object3D, point: Vector3) {
  if (entry.node.type === 'pipe') {
    object.position.copy(point)
    return
  }
  const parent = object.parent
  if (!parent) {
    object.position.copy(point)
    return
  }
  FLOW_WORLD_POINT.copy(point)
  object.position.copy(parent.worldToLocal(FLOW_WORLD_POINT))
}

function ensureFlowArrows(entry: RuntimeEntry, binding: DynamicBinding) {
  const count = 4
  const color = binding.arrowColor ?? (binding.flowMedium === 'steam' ? '#e5e7eb' : '#7dd3fc')
  const key = `${color}:${count}:${binding.flowMedium ?? 'liquid'}`
  if (entry.flowArrowKey === key && entry.flowArrows.length === count) return
  clearFlowArrows(entry)
  const parent = flowVisualParent(entry)
  for (let index = 0; index < count; index += 1) {
    const arrow = createFlowArrow(color)
    arrow.name = `dynamic-flow-arrow-${entry.node.id}-${index}`
    parent?.add(arrow)
    entry.flowArrows.push(arrow)
  }
  entry.flowArrowKey = key
}

function createFlowRipple(color: string) {
  const geometry = new BufferGeometry()
  const pointCount = 24
  const positions = new Float32Array(pointCount * 3)
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3))
  const material = new LineBasicMaterial({
    color,
    transparent: true,
    opacity: 0.62,
    depthWrite: false,
  })
  const wave = new Line(geometry, material)
  wave.name = 'dynamic-flow-wave'
  wave.userData.dynamicFlowRipple = true
  return wave
}

function ensureFlowRipples(entry: RuntimeEntry, binding: DynamicBinding) {
  const shouldShowRipples = entry.node.type === 'pipe' && binding.flowMedium !== 'steam'
  if (!shouldShowRipples) {
    clearFlowRipples(entry)
    return
  }
  const count = 6
  const color = binding.color ?? '#35c8ff'
  const key = `${color}:${count}:liquid`
  if (entry.flowRippleKey === key && entry.flowRipples.length === count) return
  clearFlowRipples(entry)
  const parent = flowVisualParent(entry)
  for (let index = 0; index < count; index += 1) {
    const ripple = createFlowRipple(color)
    ripple.name = `dynamic-flow-ripple-${entry.node.id}-${index}`
    parent?.add(ripple)
    entry.flowRipples.push(ripple)
  }
  entry.flowRippleKey = key
}

function createHorizontalPipeFillGeometry(radius: number, length: number, level: number) {
  const clamped = Math.min(1, Math.max(0, level))
  if (clamped <= 0) return null
  if (clamped >= 0.995) {
    const full = new CylinderGeometry(radius, radius, length, 36)
    full.rotateZ(Math.PI / 2)
    return full
  }

  const yLevel = -radius + radius * 2 * clamped
  const alpha = Math.asin(Math.min(1, Math.max(-1, yLevel / radius)))
  const start = Math.PI - alpha
  const end = Math.PI * 2 + alpha
  const steps = 28
  const cross: Array<[number, number]> = []
  for (let index = 0; index <= steps; index += 1) {
    const theta = start + ((end - start) * index) / steps
    cross.push([radius * Math.sin(theta), radius * Math.cos(theta)])
  }

  const half = length / 2
  const vertices: number[] = []
  for (const x of [-half, half]) {
    for (const [y, z] of cross) vertices.push(x, y, z)
  }

  const indices: number[] = []
  const count = cross.length
  for (let index = 1; index < count - 1; index += 1) indices.push(0, index, index + 1)
  for (let index = 1; index < count - 1; index += 1)
    indices.push(count, count + index + 1, count + index)
  for (let index = 0; index < count; index += 1) {
    const next = (index + 1) % count
    indices.push(index, next, count + next, index, count + next, count + index)
  }

  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new Float32BufferAttribute(vertices, 3))
  geometry.setIndex(indices)
  geometry.computeVertexNormals()
  return geometry
}

function createPipeFlowCoreGeometry(radius: number, length: number) {
  const geometry = new CylinderGeometry(radius, radius, length, 24)
  geometry.rotateZ(Math.PI / 2)
  return geometry
}

function createPipeRouteFlowGeometry(points: Vector3[], radius: number) {
  if (points.length < 2) return null
  const length = pipeRouteLength(points)
  if (length <= 0.001) return null
  const curve = new CatmullRomCurve3(points)
  const tubularSegments = Math.max(12, Math.ceil(length / 0.2))
  return new TubeGeometry(curve, tubularSegments, radius, 12, false)
}

function ensureFlowFill(
  entry: RuntimeEntry,
  binding: DynamicBinding,
  ratio: number,
  pipeVector: PipeFlowVector | null,
  routePoints?: Vector3[] | null,
) {
  const shouldShowFill =
    entry.node.type === 'pipe' && binding.flowMedium !== 'steam' && !!pipeVector
  if (!shouldShowFill) {
    clearFlowFill(entry)
    return
  }

  const node = entry.node as AnyNode & { diameter?: number }
  const radius = Math.max(0.012, (typeof node.diameter === 'number' ? node.diameter : 0.15) * 0.18)
  const length = Math.max(0.05, (pipeVector?.distance ?? 1) * 0.96)
  const fillRatio = Math.min(1, Math.max(0, ratio))
  const color = binding.color ?? '#35c8ff'
  const routeKey = routePoints
    ?.map((point) => `${point.x.toFixed(3)},${point.y.toFixed(3)},${point.z.toFixed(3)}`)
    .join(';')
  const key = `${color}:${radius.toFixed(3)}:${length.toFixed(3)}:${routeKey ?? 'flow-core'}`
  if (entry.flowFillKey !== key) {
    clearFlowFill(entry)
    const geometry = routePoints?.length
      ? createPipeRouteFlowGeometry(routePoints, radius)
      : createPipeFlowCoreGeometry(radius, length)
    if (geometry) {
      entry.flowFill = new Mesh(
        geometry,
        new MeshBasicMaterial({
          color,
          transparent: true,
          opacity: 0.86,
          depthWrite: false,
          depthTest: false,
        }),
      )
      entry.flowFill.name = `dynamic-flow-fill-${entry.node.id}`
      entry.flowFill.userData.dynamicFlowFill = true
      flowVisualParent(entry)?.add(entry.flowFill)
    }
    entry.flowFillKey = key
  }

  if (!entry.flowFill || !pipeVector) return
  if (routePoints?.length) {
    entry.flowFill.position.set(0, 0, 0)
    entry.flowFill.quaternion.identity()
  } else {
    copyFlowPoint(entry, entry.flowFill, pipeVector.center)
    setObjectAlongVector(entry.flowFill, pipeVector.direction)
  }
  entry.flowFill.visible = fillRatio > 0.005
}

type PipeFlowVector = {
  center: Vector3
  direction: Vector3
  distance: number
}

type PipeLikeNode = AnyNode & {
  type: 'pipe'
  start?: [number, number]
  end?: [number, number]
  elevation?: number
  rotate?: number
}

function isPipeNode(node: AnyNode): node is PipeLikeNode {
  return node.type === 'pipe'
}

function pipeRoutePoints(node: AnyNode) {
  if (!isPipeNode(node) || !Array.isArray(node.start) || !Array.isArray(node.end)) return null
  const samples = samplePipeCenterline3D(node as Parameters<typeof samplePipeCenterline3D>[0], 18)
  const points = samples.map((point) => new Vector3(point.x, point.y, point.z))
  return points.length >= 2 ? points : null
}

function pipeRouteLength(points: Vector3[]) {
  let distance = 0
  for (let index = 1; index < points.length; index += 1) {
    distance += points[index - 1]!.distanceTo(points[index]!)
  }
  return distance
}

function samplePipeRoute(points: Vector3[], distance: number) {
  let remaining = distance
  for (let index = 1; index < points.length; index += 1) {
    const a = points[index - 1]!
    const b = points[index]!
    const length = a.distanceTo(b)
    if (length < 0.001) continue
    if (remaining <= length || index === points.length - 1) {
      const ratio = Math.max(0, Math.min(1, remaining / length))
      return {
        point: a.clone().lerp(b, ratio),
        direction: b.clone().sub(a).normalize(),
      }
    }
    remaining -= length
  }
  const last = points[points.length - 1]!
  const prev = points[points.length - 2] ?? last
  const direction = last.clone().sub(prev)
  if (direction.length() < 0.001) direction.set(1, 0, 0)
  return { point: last.clone(), direction: direction.normalize() }
}

function findNextPipeNodeByTouching(
  current: PipeLikeNode,
  nodes: Record<string, AnyNode>,
  visited: Set<string>,
) {
  const currentPoints = pipeRoutePoints(current)
  const currentOut = currentPoints?.[currentPoints.length - 1]
  if (!currentOut) return null
  let best: PipeLikeNode | null = null
  let bestDistance = 0.025
  for (const node of Object.values(nodes)) {
    if (!isPipeNode(node) || visited.has(node.id)) continue
    const nextPoints = pipeRoutePoints(node)
    const input = nextPoints?.[0]
    if (!input) continue
    const distance = currentOut.distanceTo(input)
    if (distance <= bestDistance) {
      best = node
      bestDistance = distance
    }
  }
  return best
}

function findNextPipeNode(
  current: PipeLikeNode,
  nodes: Record<string, AnyNode>,
  visited: Set<string>,
) {
  const connection = getTransferConnections(current).find(
    (candidate) => candidate.fromNodeId === current.id && candidate.fromPort === 'out',
  )
  if (connection) {
    const target = nodes[connection.toNodeId]
    if (target && isPipeNode(target) && !visited.has(target.id)) return target
  }
  return findNextPipeNodeByTouching(current, nodes, visited)
}

function buildPipeRuntimeRoute(node: AnyNode, nodes: Record<string, AnyNode>) {
  const firstPoints = pipeRoutePoints(node)
  if (!firstPoints || !isPipeNode(node)) return firstPoints
  const route = [...firstPoints]
  const visited = new Set<string>([node.id])
  let current: PipeLikeNode = node

  for (let guard = 0; guard < 32; guard += 1) {
    const next = findNextPipeNode(current, nodes, visited)
    const nextPoints = next ? pipeRoutePoints(next) : null
    if (!(next && nextPoints)) break
    visited.add(next.id)
    route.push(...nextPoints.slice(1))
    current = next
  }

  return route
}

function pipeFlowVectorFromRoute(points: Vector3[]) {
  const first = points[0]
  const last = points[points.length - 1]
  if (!(first && last)) return null
  const direction = last.clone().sub(first)
  const distance = pipeRouteLength(points)
  if (distance <= 0.001 || direction.length() <= 0.001) return null
  return {
    center: first.clone().lerp(last, 0.5),
    direction: direction.normalize(),
    distance: Math.max(1.2, distance),
  }
}

function pipeFlowVector(entry: RuntimeEntry) {
  const node = entry.node as AnyNode & {
    start?: [number, number]
    end?: [number, number]
  }
  if (node.type !== 'pipe' || !Array.isArray(node.start) || !Array.isArray(node.end)) return null

  const samples = samplePipeCenterline3D(node as Parameters<typeof samplePipeCenterline3D>[0], 12)
  const first = samples[0]
  const last = samples[samples.length - 1]
  if (first && last) {
    const direction = new Vector3(last.x - first.x, last.y - first.y, last.z - first.z)
    const distance = direction.length()
    if (distance > 0.001) {
      return {
        center: new Vector3((first.x + last.x) / 2, (first.y + last.y) / 2, (first.z + last.z) / 2),
        direction: direction.normalize(),
        distance: Math.max(1.2, distance),
      }
    }
  }

  const dx = (node.end[0] ?? 0) - (node.start[0] ?? 0)
  const dz = (node.end[1] ?? 0) - (node.start[1] ?? 0)
  const length = Math.hypot(dx, dz)
  if (length <= 0.001) return null
  const elevation =
    typeof (node as { elevation?: unknown }).elevation === 'number'
      ? (node as { elevation: number }).elevation
      : 0
  return {
    center: new Vector3(
      ((node.start[0] ?? 0) + (node.end[0] ?? 0)) / 2,
      elevation,
      ((node.start[1] ?? 0) + (node.end[1] ?? 0)) / 2,
    ),
    direction: new Vector3(dx / length, 0, dz / length),
    distance: Math.max(1.2, length),
  }
}

function applyFlowShell(
  entry: RuntimeEntry,
  binding: DynamicBinding,
  ratio: number,
  pulse: number,
) {
  const baseColor = binding.color ?? (binding.flowMedium === 'steam' ? '#e5e7eb' : '#35c8ff')
  const color = new Color(baseColor).multiplyScalar(0.35 + ratio * pulse)
  const isPipe = entry.node.type === 'pipe'
  for (const materialEntry of entry.snapshot.materialColors) {
    if (isPipe) {
      const nodeOpacity =
        typeof (entry.node as { opacity?: unknown }).opacity === 'number'
          ? (entry.node as { opacity: number }).opacity
          : 0.72
      materialEntry.material.color?.copy(
        binding.flowMedium === 'steam' ? color : materialEntry.color,
      )
      materialEntry.material.transparent = true
      materialEntry.material.opacity = Math.min(
        nodeOpacity,
        binding.flowMedium === 'steam' ? 0.38 : 0.5,
      )
      materialEntry.material.depthWrite = false
    } else {
      materialEntry.material.color?.copy(color)
    }
    materialEntry.material.needsUpdate = true
  }
}

const FLOW_LOCAL_X = new Vector3(1, 0, 0)

function setObjectAlongVector(object: Object3D, direction: Vector3) {
  object.quaternion.copy(
    new Quaternion().setFromUnitVectors(FLOW_LOCAL_X, direction.clone().normalize()),
  )
}

function setFlowWaveAlongVector(
  wave: Object3D,
  direction: Vector3,
  elapsedSeconds: number,
  index: number,
) {
  setObjectAlongVector(wave, direction)
  const line = wave as Line
  const position = line.geometry.attributes.position
  if (!position) return
  const t = elapsedSeconds * 5.2 + index * 1.7
  const count = position.count
  const length = 0.72
  const amplitude = 0.028
  for (let point = 0; point < count; point += 1) {
    const ratio = count <= 1 ? 0 : point / (count - 1)
    const x = (ratio - 0.5) * length
    const y =
      Math.sin(ratio * Math.PI * 2.8 + t) * amplitude +
      Math.cos(ratio * Math.PI * 5.4 - t * 0.72) * amplitude * 0.45
    position.setXYZ(point, x, y, 0)
  }
  position.needsUpdate = true
}

function applyFlowAlongPipeRoute(
  entry: RuntimeEntry,
  binding: DynamicBinding,
  elapsedSeconds: number,
  routePoints: Vector3[],
  value: number,
) {
  const directionSign = binding.direction === 'backward' ? -1 : 1
  const distance = Math.max(1.2, pipeRouteLength(routePoints))
  const speed = Math.max(0, binding.speedRange?.[1] ?? 1.2)
  const active = value > 0

  for (let index = 0; index < entry.flowArrows.length; index += 1) {
    const arrow = entry.flowArrows[index]!
    const rawOffset =
      (elapsedSeconds * speed + index * (distance / entry.flowArrows.length)) % distance
    const offset = directionSign < 0 ? distance - rawOffset : rawOffset
    const sample = samplePipeRoute(routePoints, offset)
    const direction =
      directionSign < 0 ? sample.direction.clone().multiplyScalar(-1) : sample.direction
    copyFlowPoint(entry, arrow, sample.point)
    arrow.position.y += 0.06
    arrow.scale.setScalar(0.72)
    setObjectAlongVector(arrow, direction)
    arrow.visible = active
  }

  for (let index = 0; index < entry.flowRipples.length; index += 1) {
    const ripple = entry.flowRipples[index]!
    const rawOffset =
      (elapsedSeconds * speed + index * (distance / entry.flowRipples.length)) % distance
    const offset = directionSign < 0 ? distance - rawOffset : rawOffset
    const sample = samplePipeRoute(routePoints, offset)
    const direction =
      directionSign < 0 ? sample.direction.clone().multiplyScalar(-1) : sample.direction
    copyFlowPoint(entry, ripple, sample.point)
    setFlowWaveAlongVector(ripple, direction, elapsedSeconds, index)
    ripple.visible = active
  }
}

function applyFlow(
  entry: RuntimeEntry,
  binding: DynamicBinding,
  elapsedSeconds: number,
  nodes: Record<string, AnyNode>,
) {
  const value = numericValue(getBindingValue(binding))
  const ratio = mapRange(value, binding.inputRange ?? [0, 100], [0, 1])
  const pulse = 0.55 + Math.sin(elapsedSeconds * 8) * 0.25
  applyFlowShell(entry, binding, ratio, pulse)

  ensureFlowArrows(entry, binding)
  clearFlowRipples(entry)
  const pipeRoute = entry.node.type === 'pipe' ? buildPipeRuntimeRoute(entry.node, nodes) : null
  const pipeVector = pipeRoute ? pipeFlowVectorFromRoute(pipeRoute) : pipeFlowVector(entry)
  ensureFlowFill(entry, binding, ratio, pipeVector, pipeRoute)
  if (pipeRoute && pipeRoute.length >= 2) {
    applyFlowAlongPipeRoute(entry, binding, elapsedSeconds, pipeRoute, value)
    return
  }
  const directionSign = binding.direction === 'backward' ? -1 : 1
  const flowDirection = pipeVector?.direction.multiplyScalar(directionSign)
  const flowCenter = pipeVector?.center
  const axis = axisIndex(binding.axis)
  const distance = pipeVector?.distance ?? Math.max(1.2, binding.distance ?? 2.4)
  const speed = Math.max(0, binding.speedRange?.[1] ?? 1.2)
  const active = value > 0
  for (let index = 0; index < entry.flowArrows.length; index += 1) {
    const arrow = entry.flowArrows[index]!
    const offset =
      ((elapsedSeconds * speed + index * (distance / entry.flowArrows.length)) % distance) -
      distance / 2
    if (flowDirection && flowCenter) {
      arrow.position.copy(flowCenter).addScaledVector(flowDirection, offset)
      arrow.position.y += 0.06
      arrow.scale.setScalar(0.72)
      setObjectAlongVector(arrow, flowDirection)
    } else {
      arrow.position.copy(entry.snapshot.position)
      arrow.position.setComponent(
        axis,
        entry.snapshot.position.getComponent(axis) + offset * directionSign,
      )
      arrow.position.y = entry.snapshot.position.y + 0.28
      arrow.rotation.copy(entry.object.rotation)
      if (axis === 1) arrow.rotation.z += Math.PI / 2
      if (axis === 2) arrow.rotation.y -= Math.PI / 2
    }
    arrow.visible = active
  }

  for (let index = 0; index < entry.flowRipples.length; index += 1) {
    const ripple = entry.flowRipples[index]!
    const offset =
      ((elapsedSeconds * speed + index * (distance / entry.flowRipples.length)) % distance) -
      distance / 2
    if (flowDirection && flowCenter) {
      ripple.position.copy(flowCenter).addScaledVector(flowDirection, offset)
      setFlowWaveAlongVector(ripple, flowDirection, elapsedSeconds, index)
    }
    ripple.visible = active && !!flowDirection
  }
}

function applyBrightness(snapshot: ObjectSnapshot, binding: DynamicBinding) {
  const value = numericValue(getBindingValue(binding))
  const ratio = mapRange(value, binding.inputRange ?? [0, 100], [0.25, 1.5])
  const tint = binding.color ? new Color(binding.color) : null
  for (const entry of snapshot.materialColors) {
    entry.material.color?.copy(tint ?? entry.color).multiplyScalar(ratio)
    entry.material.needsUpdate = true
  }
}

function applyScale(
  object: Object3D,
  snapshot: ObjectSnapshot,
  binding: DynamicBinding,
  elapsedSeconds: number,
) {
  if (binding.condition) {
    if (!evaluateDynamicCondition(binding)) {
      object.scale.copy(snapshot.scale)
      return
    }
    const effect = binding.scaleEffect ?? 'fixed'
    if (effect === 'pulse' || effect === 'alarmPulse') {
      const [minScale = 1, maxScale = 1.25] = binding.outputRange ?? [
        1,
        effect === 'alarmPulse' ? 1.35 : 1.25,
      ]
      const speed = binding.speedRange?.[1] ?? (effect === 'alarmPulse' ? 8 : 4)
      const wave =
        effect === 'alarmPulse'
          ? Math.abs(Math.sin(elapsedSeconds * speed))
          : 0.5 + Math.sin(elapsedSeconds * speed) * 0.5
      object.scale.copy(snapshot.scale).multiplyScalar(minScale + (maxScale - minScale) * wave)
      return
    }
    const multiplier = binding.outputRange?.[1] ?? 1.2
    object.scale.copy(snapshot.scale).multiplyScalar(multiplier)
    return
  }
  const value = numericValue(getBindingValue(binding))
  const multiplier = mapRange(
    value,
    binding.inputRange ?? [0, 100],
    binding.outputRange ?? [0.5, 1.5],
  )
  object.scale.copy(snapshot.scale).multiplyScalar(multiplier)
}

function rollingAxisForMove(axis: 0 | 1 | 2): 0 | 1 | 2 {
  if (axis === 0) return 2
  if (axis === 2) return 0
  return 0
}

function applyMove(entry: RuntimeEntry, binding: DynamicBinding, deltaSeconds: number) {
  const value = numericValue(getBindingValue(binding))
  const targetOffset = mapRange(
    value,
    binding.inputRange ?? [0, 100],
    binding.outputRange ?? [0, 1],
  )
  const axis = axisIndex(binding.axis)
  const offset =
    binding.motionMode === 'smooth'
      ? (entry.moveOffsets[binding.id] ?? 0) +
        (targetOffset - (entry.moveOffsets[binding.id] ?? 0)) *
          (1 - Math.exp(-Math.max(0.001, deltaSeconds) * 6))
      : targetOffset
  entry.moveOffsets[binding.id] = offset

  entry.object.position.copy(entry.snapshot.position)
  entry.object.position.setComponent(axis, entry.snapshot.position.getComponent(axis) + offset)

  if (binding.moveStyle === 'roll') {
    const rollAxis = rollingAxisForMove(axis)
    const next = [...entry.snapshot.rotation] as [number, number, number]
    next[rollAxis] += offset / 0.5
    entry.object.rotation.set(next[0], next[1], next[2])
  }
}

function ensureLevelFill(entry: RuntimeEntry, binding: DynamicBinding) {
  if (entry.levelFill) return
  const fill = new Mesh(
    new BoxGeometry(0.72, 1, 0.72),
    new MeshBasicMaterial({
      color: binding.color ?? '#38bdf8',
      transparent: true,
      opacity: 0.45,
      depthWrite: false,
    }),
  )
  fill.name = `dynamic-level-fill-${entry.node.id}`
  fill.castShadow = true
  fill.receiveShadow = true
  fill.userData.dynamicLevelFill = true
  entry.object.parent?.add(fill)
  entry.levelFill = fill
}

type TankLikeNode = AnyNode & {
  diameter?: number
  height?: number
  length?: number
  kind?: 'vertical' | 'horizontal' | 'spherical'
  liquidColor?: string
  liquidOpacity?: number
}

type TankWaveData = {
  baseTopY: number
  topCenterIndex: number
  topRingIndices: number[]
}

function materialHasColor(material: Material | Material[], color: string) {
  const materials = Array.isArray(material) ? material : [material]
  return materials.some((entry) => {
    const maybe = entry as MaterialWithColor
    return maybe.color?.getHexString().toLowerCase() === color.replace('#', '').toLowerCase()
  })
}

function hideNativeTankLiquid(entry: RuntimeEntry, node: TankLikeNode) {
  const liquidColor = node.liquidColor ?? '#38bdf8'
  if (entry.hiddenLevelObjects.length > 0) return
  entry.object.traverse((object) => {
    if (!(object instanceof Mesh)) return
    if (!materialHasColor(object.material, liquidColor)) return
    entry.hiddenLevelObjects.push({ object, visible: object.visible })
    object.visible = false
  })
}

function createVerticalTankLevelFillGeometry(radius: number, height: number) {
  const radialSegments = 80
  const heightSegments = 8
  const vertices: number[] = []
  const indices: number[] = []
  const topRingIndices: number[] = []

  for (let yIndex = 0; yIndex <= heightSegments; yIndex += 1) {
    const y = (height * yIndex) / heightSegments
    for (let i = 0; i < radialSegments; i += 1) {
      const theta = (i / radialSegments) * Math.PI * 2
      vertices.push(Math.cos(theta) * radius, y, Math.sin(theta) * radius)
      if (yIndex === heightSegments) topRingIndices.push(yIndex * radialSegments + i)
    }
  }

  for (let yIndex = 0; yIndex < heightSegments; yIndex += 1) {
    const row = yIndex * radialSegments
    const nextRow = (yIndex + 1) * radialSegments
    for (let i = 0; i < radialSegments; i += 1) {
      const next = (i + 1) % radialSegments
      indices.push(row + i, row + next, nextRow + next, row + i, nextRow + next, nextRow + i)
    }
  }

  const bottomCenter = vertices.length / 3
  vertices.push(0, 0, 0)
  const topCenterIndex = vertices.length / 3
  vertices.push(0, height, 0)

  for (let i = 0; i < radialSegments; i += 1) {
    const next = (i + 1) % radialSegments
    indices.push(bottomCenter, next, i)
    indices.push(topCenterIndex, topRingIndices[i] ?? 0, topRingIndices[next] ?? 0)
  }

  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new Float32BufferAttribute(vertices, 3))
  geometry.setIndex(indices)
  geometry.computeVertexNormals()

  return {
    geometry,
    wave: { baseTopY: height, topCenterIndex, topRingIndices } satisfies TankWaveData,
  }
}

function createTankLevelFill(node: TankLikeNode, ratio: number) {
  const radius = Math.max(0.05, (node.diameter ?? 1.6) / 2) * 0.92
  const kind = node.kind ?? 'vertical'
  const clamped = Math.min(1, Math.max(0, ratio))
  if (clamped <= 0.001) return null
  if (kind === 'spherical') {
    const geometry = new SphereGeometry(radius, 48, 24)
    geometry.scale(1, clamped, 1)
    geometry.translate(0, -radius + radius * clamped, 0)
    return { geometry }
  }
  if (kind === 'horizontal') {
    const geometry = createHorizontalPipeFillGeometry(
      radius,
      Math.max(0.1, node.length ?? 3),
      clamped,
    )
    return geometry ? { geometry } : null
  }
  const fillHeight = Math.max(0.001, (node.height ?? 3) * clamped)
  return createVerticalTankLevelFillGeometry(radius, fillHeight)
}

function animateTankLevelWave(entry: RuntimeEntry, elapsedSeconds: number) {
  if (!(entry.levelFill instanceof Mesh)) return
  const wave = entry.levelFill.userData.tankWave as TankWaveData | undefined
  if (!wave) return
  const position = entry.levelFill.geometry.attributes.position
  if (!position) return

  let sum = 0
  for (const index of wave.topRingIndices) {
    const x = position.getX(index)
    const z = position.getZ(index)
    const y =
      wave.baseTopY +
      Math.sin(x * 8.5 + elapsedSeconds * 3.2) * 0.035 +
      Math.cos(z * 11 - elapsedSeconds * 2.6) * 0.026 +
      Math.sin((x + z) * 5.5 + elapsedSeconds * 2.1) * 0.014
    position.setY(index, y)
    sum += y
  }
  position.setY(wave.topCenterIndex, sum / Math.max(1, wave.topRingIndices.length))
  position.needsUpdate = true
  entry.levelFill.geometry.computeVertexNormals()
}

function ensureTankLevelFill(
  entry: RuntimeEntry,
  binding: DynamicBinding,
  ratio: number,
  elapsedSeconds: number,
) {
  const node = entry.node as TankLikeNode
  hideNativeTankLiquid(entry, node)
  const kind = node.kind ?? 'vertical'
  const color = binding.color ?? node.liquidColor ?? '#38bdf8'
  const opacity = node.liquidOpacity ?? 0.72
  const ratioBucket = Math.round(Math.min(1, Math.max(0, ratio)) * 100) / 100
  const key = `tank:${kind}:${color}:${opacity}:${node.diameter ?? 1.6}:${node.height ?? 3}:${node.length ?? 3}:${ratioBucket}`
  if (entry.levelFillKey !== key) {
    if (entry.levelFill) disposeObject(entry.levelFill)
    entry.levelFill = null
    entry.levelFillKey = key
    const built = createTankLevelFill(node, ratioBucket)
    if (built) {
      entry.levelFill = new Mesh(
        built.geometry,
        new MeshBasicMaterial({
          color,
          transparent: true,
          opacity,
          depthWrite: false,
        }),
      )
      entry.levelFill.name = `dynamic-level-fill-${entry.node.id}`
      entry.levelFill.castShadow = true
      entry.levelFill.receiveShadow = true
      entry.levelFill.userData.dynamicLevelFill = true
      if ('wave' in built) entry.levelFill.userData.tankWave = built.wave
      entry.object.parent?.add(entry.levelFill)
    }
  }

  if (!entry.levelFill) return
  entry.levelFill.position.copy(entry.snapshot.position)
  entry.levelFill.rotation.copy(entry.object.rotation)
  if (kind === 'spherical') {
    const radius = Math.max(0.05, (node.diameter ?? 1.6) / 2)
    const legHeight = Math.max(0.25, radius * 0.55)
    entry.levelFill.position.y += legHeight + radius * 0.85
  }
  entry.levelFill.visible = ratioBucket > 0.001
  animateTankLevelWave(entry, elapsedSeconds)
}

function applyLevel(entry: RuntimeEntry, binding: DynamicBinding, elapsedSeconds: number) {
  const value = numericValue(getBindingValue(binding))
  const fill = mapRange(value, binding.inputRange ?? [0, 100], binding.outputRange ?? [0, 1])
  const clamped = Math.min(1, Math.max(0, fill))
  if (entry.node.type === 'tank') {
    ensureTankLevelFill(entry, binding, clamped, elapsedSeconds)
    return
  }
  ensureLevelFill(entry, binding)
  if (!entry.levelFill) return
  entry.object.scale.copy(entry.snapshot.scale)
  entry.object.position.copy(entry.snapshot.position)
  const fillHeight = Math.max(0.03, entry.snapshot.scale.y * clamped)
  entry.levelFill.scale.set(
    entry.snapshot.scale.x * 0.82,
    fillHeight,
    entry.snapshot.scale.z * 0.82,
  )
  entry.levelFill.position.copy(entry.snapshot.position)
  entry.levelFill.position.y =
    entry.snapshot.position.y - entry.snapshot.scale.y / 2 + fillHeight / 2
  entry.levelFill.rotation.copy(entry.object.rotation)
  entry.levelFill.visible = true
}

function applyVisible(object: Object3D, binding: DynamicBinding) {
  object.visible = evaluateDynamicCondition(binding)
}

function applyBlink(
  object: Object3D,
  snapshot: ObjectSnapshot,
  binding: DynamicBinding,
  elapsedSeconds: number,
) {
  const active = evaluateDynamicCondition(binding)
  if (!active) {
    object.visible = snapshot.visible
    return
  }
  object.visible = Math.sin(elapsedSeconds * 8) >= 0
}

function ensureValveHandle(entry: RuntimeEntry, binding: DynamicBinding) {
  if (entry.valveHandle) return
  const group = new Group()
  const color = binding.color ?? '#f97316'
  const material = new MeshBasicMaterial({ color })
  const bar = new Mesh(new BoxGeometry(0.85, 0.08, 0.08), material.clone())
  const hub = new Mesh(new BoxGeometry(0.16, 0.16, 0.16), material.clone())
  group.add(bar)
  group.add(hub)
  group.name = `dynamic-valve-handle-${entry.node.id}`
  group.userData.dynamicValveHandle = true
  entry.object.parent?.add(group)
  entry.valveHandle = group
}

function applyOpenClose(entry: RuntimeEntry, binding: DynamicBinding) {
  const value = numericValue(getBindingValue(binding))
  const angle = mapRange(
    value,
    binding.inputRange ?? [0, 1],
    binding.outputRange ?? [0, Math.PI / 2],
  )
  const axis = axisIndex(binding.axis)
  const next = [...entry.snapshot.rotation] as [number, number, number]
  next[axis] += angle
  entry.object.rotation.set(next[0], next[1], next[2])
  ensureValveHandle(entry, binding)
  if (!entry.valveHandle) return
  entry.valveHandle.position.copy(entry.snapshot.position)
  entry.valveHandle.position.y =
    entry.snapshot.position.y + Math.max(0.28, entry.snapshot.scale.y * 0.7)
  const handleRotation = [...entry.snapshot.rotation] as [number, number, number]
  handleRotation[axis] = next[axis]
  entry.valveHandle.rotation.set(handleRotation[0], handleRotation[1], handleRotation[2])
  entry.valveHandle.visible = true
}

function applyRotate(
  object: Object3D,
  snapshot: ObjectSnapshot,
  binding: DynamicBinding,
  elapsedSeconds: number,
) {
  const value = numericValue(getBindingValue(binding))
  const speed = mapRange(value, binding.inputRange ?? [0, 100], binding.speedRange ?? [0, 6])
  const axis = axisIndex(binding.axis)
  const next = [...snapshot.rotation] as [number, number, number]
  next[axis] += elapsedSeconds * speed
  object.rotation.set(next[0], next[1], next[2])
}

function jointAxisIndex(axis: DynamicAxis) {
  if (axis === 'x') return 0
  if (axis === 'y') return 1
  return 2
}

function jointBindingValue(binding: DynamicJointBinding): LiveDataValue | undefined {
  return getLiveDataValue(binding.path)
}

function applyJointBindings(entry: RuntimeEntry) {
  if (entry.jointChannels.length === 0 || entry.jointBindings.length === 0) return
  const channelsById = new Map(entry.jointChannels.map((channel) => [channel.id, channel]))

  for (const binding of entry.jointBindings) {
    if (binding.enabled === false) continue
    const channel = channelsById.get(binding.channelId)
    if (!channel) continue
    const object = sceneRegistry.nodes.get(channel.targetNodeId as AnyNodeId)
    if (!object) continue

    let snapshot = entry.jointSnapshots.get(channel.targetNodeId)
    if (!snapshot) {
      snapshot = captureSnapshot(object)
      entry.jointSnapshots.set(channel.targetNodeId, snapshot)
    }
    restoreSnapshot(object, snapshot)

    const value = numericValue(jointBindingValue(binding))
    const output = mapRange(
      value,
      binding.inputRange ?? channel.inputRange ?? [0, 100],
      binding.outputRange ??
        channel.outputRange ??
        (channel.motion === 'rotation' ? [0, Math.PI / 2] : [0, 1]),
    )
    const axis = jointAxisIndex(channel.axis)
    if (channel.motion === 'translation') {
      const next = snapshot.position.clone()
      next.setComponent(axis, next.getComponent(axis) + output)
      object.position.copy(next)
    } else {
      const next = [...snapshot.rotation] as [number, number, number]
      next[axis] += output
      object.rotation.set(next[0], next[1], next[2])
    }
  }
}

function materialCloneForObject(object: Object3D) {
  object.traverse((child) => {
    const mesh = child as Mesh
    const material = mesh.material
    if (Array.isArray(material)) {
      mesh.material = material.map((item) => item.clone())
    } else if (material) {
      mesh.material = material.clone()
    }
  })
}

function createFallbackCargo() {
  const mesh = new Mesh(
    new BoxGeometry(0.45, 0.35, 0.45),
    new MeshBasicMaterial({ color: '#f59e0b' }),
  )
  mesh.userData.dynamicFallbackCargo = true
  return mesh
}

function normalizedConveyorEndpointBehavior(binding: DynamicBinding) {
  if (binding.endpointBehavior) return binding.endpointBehavior
  return binding.loop === false ? 'disappear' : 'loop'
}

function conveyorCloneCount(binding: DynamicBinding, distance: number, speed: number) {
  if (typeof binding.maxItems === 'number' && Number.isFinite(binding.maxItems)) {
    return Math.max(1, Math.min(50, Math.floor(binding.maxItems)))
  }
  if (
    typeof binding.cadenceSeconds === 'number' &&
    Number.isFinite(binding.cadenceSeconds) &&
    binding.cadenceSeconds > 0 &&
    speed > 0.001
  ) {
    return Math.max(1, Math.min(50, Math.ceil(distance / (speed * binding.cadenceSeconds)) + 1))
  }
  const spacing = Math.max(0.1, binding.spacing ?? 1.2)
  return Math.max(1, Math.min(50, Math.ceil(distance / spacing) + 1))
}

function conveyorItemTravel(
  binding: DynamicBinding,
  elapsedSeconds: number,
  speed: number,
  index: number,
) {
  if (
    typeof binding.cadenceSeconds === 'number' &&
    Number.isFinite(binding.cadenceSeconds) &&
    binding.cadenceSeconds > 0
  ) {
    return (elapsedSeconds - index * binding.cadenceSeconds) * speed
  }
  return elapsedSeconds * speed + index * Math.max(0.1, binding.spacing ?? 1.2)
}

function resolveConveyorOffset(binding: DynamicBinding, travel: number, distance: number) {
  const behavior = normalizedConveyorEndpointBehavior(binding)
  if (behavior === 'loop') {
    return { offset: ((travel % distance) + distance) % distance, visible: travel >= 0 }
  }
  if (behavior === 'accumulate') {
    return { offset: Math.min(distance, Math.max(0, travel)), visible: travel >= 0 }
  }
  return {
    offset: Math.min(distance, Math.max(0, travel)),
    visible: travel >= 0 && travel <= distance,
  }
}

function ensureConveyorClones(
  entry: RuntimeEntry,
  binding: DynamicBinding,
  travelDistance?: number,
  desiredCount?: number,
) {
  const distance = Math.max(0.1, travelDistance ?? binding.distance ?? 6)
  const spacing = Math.max(0.1, binding.spacing ?? 1.2)
  const count = Math.max(1, Math.min(50, desiredCount ?? Math.ceil(distance / spacing) + 1))
  const key = `${binding.itemTemplateNodeId ?? 'fallback'}:${count}:${distance.toFixed(2)}`
  const template = binding.itemTemplateNodeId
    ? sceneRegistry.nodes.get(binding.itemTemplateNodeId)
    : undefined
  hideConveyorTemplate(entry, template)

  if (entry.conveyorKey === key && entry.conveyorClones.length === count) return

  clearConveyorClones(entry)
  hideConveyorTemplate(entry, template)

  const parent = entry.object.parent

  for (let index = 0; index < count; index += 1) {
    const clone = template ? template.clone(true) : createFallbackCargo()
    materialCloneForObject(clone)
    clone.name = `dynamic-conveyor-cargo-${entry.node.id}-${index}`
    clone.visible = true
    parent?.add(clone)
    entry.conveyorClones.push(clone)
  }

  entry.conveyorKey = key
}

function axisVector(axis: DynamicBinding['direction']): [number, number, number] {
  if (axis === 'y') return [0, 1, 0]
  if (axis === 'z') return [0, 0, 1]
  return [1, 0, 0]
}

type ConveyorBeltLikeNode = AnyNode & {
  type: 'conveyor-belt'
  points?: Array<[number, number, number]>
  direction?: 'forward' | 'backward'
  elevation?: number
  thickness?: number
}

function isConveyorBeltNode(node: AnyNode): node is ConveyorBeltLikeNode {
  return node.type === 'conveyor-belt'
}

function conveyorRoutePoints(node: AnyNode) {
  if (!isConveyorBeltNode(node)) return null
  const points = node.points?.filter(
    (point): point is [number, number, number] =>
      Array.isArray(point) &&
      point.length === 3 &&
      point.every((value) => typeof value === 'number' && Number.isFinite(value)),
  )
  return points && points.length >= 2 ? points : null
}

function conveyorRouteLength(points: Array<[number, number, number]>) {
  let distance = 0
  for (let index = 1; index < points.length; index += 1) {
    const a = points[index - 1]!
    const b = points[index]!
    distance += Math.hypot(b[0] - a[0], b[2] - a[2])
  }
  return distance
}

function sampleConveyorRoute(points: Array<[number, number, number]>, distance: number) {
  let remaining = distance
  for (let index = 1; index < points.length; index += 1) {
    const a = points[index - 1]!
    const b = points[index]!
    const length = Math.hypot(b[0] - a[0], b[2] - a[2])
    if (length < 0.001) continue
    if (remaining <= length || index === points.length - 1) {
      const ratio = Math.max(0, Math.min(1, remaining / length))
      const direction = new Vector3((b[0] - a[0]) / length, 0, (b[2] - a[2]) / length)
      return {
        point: new Vector3(
          a[0] + (b[0] - a[0]) * ratio,
          a[1] + (b[1] - a[1]) * ratio,
          a[2] + (b[2] - a[2]) * ratio,
        ),
        direction,
      }
    }
    remaining -= length
  }
  const last = points[points.length - 1]!
  const prev = points[points.length - 2] ?? last
  const length = Math.max(0.001, Math.hypot(last[0] - prev[0], last[2] - prev[2]))
  return {
    point: new Vector3(last[0], last[1], last[2]),
    direction: new Vector3((last[0] - prev[0]) / length, 0, (last[2] - prev[2]) / length),
  }
}

function applyRouteConveyorFlow(
  entry: RuntimeEntry,
  binding: DynamicBinding,
  elapsedSeconds: number,
  points: Array<[number, number, number]>,
) {
  const routeDistance = conveyorRouteLength(points)
  const configuredDistance = Math.max(0.1, binding.distance ?? routeDistance)
  const distance =
    normalizedConveyorEndpointBehavior(binding) === 'continue'
      ? Math.max(configuredDistance, routeDistance)
      : configuredDistance

  const node = entry.node as ConveyorBeltLikeNode
  const value = numericValue(getBindingValue(binding))
  const speed = mapRange(value, binding.inputRange ?? [0, 100], binding.speedRange ?? [0, 2])
  ensureConveyorClones(entry, binding, distance, conveyorCloneCount(binding, distance, speed))
  const backward = binding.direction === 'backward' || node.direction === 'backward'
  const surfaceY = (node.elevation ?? 0.8) + (node.thickness ?? 0.08) + 0.28

  for (let index = 0; index < entry.conveyorClones.length; index += 1) {
    const clone = entry.conveyorClones[index]!
    const travel = conveyorItemTravel(binding, elapsedSeconds, speed, index)
    const resolved = resolveConveyorOffset(binding, travel, distance)
    const offset = backward ? distance - resolved.offset : resolved.offset
    const sample = sampleConveyorRoute(points, offset)
    const direction = backward ? sample.direction.clone().multiplyScalar(-1) : sample.direction
    clone.position.set(sample.point.x, sample.point.y + surfaceY, sample.point.z)
    clone.rotation.copy(entry.object.rotation)
    clone.rotation.y = -Math.atan2(direction.z, direction.x)
    clone.visible = value > 0 && resolved.visible
  }
}

function routeEndpointDistance(a: [number, number, number], b: [number, number, number]) {
  return Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2])
}

function findNextConveyorNodeByTouching(
  current: ConveyorBeltLikeNode,
  nodes: Record<string, AnyNode>,
  visited: Set<string>,
) {
  const currentOut = current.points?.[current.points.length - 1]
  if (!currentOut) return null
  let best: ConveyorBeltLikeNode | null = null
  let bestDistance = 0.001
  for (const node of Object.values(nodes)) {
    if (!isConveyorBeltNode(node) || visited.has(node.id)) continue
    const input = node.points?.[0]
    if (!input) continue
    const distance = routeEndpointDistance(currentOut, input)
    if (distance <= bestDistance) {
      best = node
      bestDistance = distance
    }
  }
  return best
}

function findNextConveyorNode(
  current: ConveyorBeltLikeNode,
  nodes: Record<string, AnyNode>,
  visited: Set<string>,
) {
  const connection = getTransferConnections(current).find(
    (candidate) => candidate.fromNodeId === current.id && candidate.fromPort === 'out',
  )
  if (connection) {
    const target = nodes[connection.toNodeId]
    if (target && isConveyorBeltNode(target) && !visited.has(target.id)) return target
  }
  return findNextConveyorNodeByTouching(current, nodes, visited)
}

function buildConveyorRuntimeRoute(node: AnyNode, nodes: Record<string, AnyNode>) {
  const firstPoints = conveyorRoutePoints(node)
  if (!firstPoints || !isConveyorBeltNode(node)) return firstPoints
  const route = [...firstPoints]
  const visited = new Set<string>([node.id])
  let current: ConveyorBeltLikeNode = node

  for (let guard = 0; guard < 32; guard += 1) {
    const next = findNextConveyorNode(current, nodes, visited)
    const nextPoints = next ? conveyorRoutePoints(next) : null
    if (!(next && nextPoints)) break
    visited.add(next.id)
    route.push(...nextPoints.slice(1))
    current = next
  }

  return route
}

function applyConveyorFlow(
  entry: RuntimeEntry,
  binding: DynamicBinding,
  elapsedSeconds: number,
  nodes: Record<string, AnyNode>,
) {
  const routePoints = buildConveyorRuntimeRoute(entry.node, nodes)
  if (routePoints) {
    applyRouteConveyorFlow(entry, binding, elapsedSeconds, routePoints)
    return
  }

  const value = numericValue(getBindingValue(binding))
  const distance = Math.max(0.1, binding.distance ?? 6)
  const speed = mapRange(value, binding.inputRange ?? [0, 100], binding.speedRange ?? [0, 2])
  ensureConveyorClones(entry, binding, distance, conveyorCloneCount(binding, distance, speed))
  const [axisX, axisY, axisZ] = axisVector(binding.direction)

  for (let index = 0; index < entry.conveyorClones.length; index += 1) {
    const clone = entry.conveyorClones[index]!
    const travel = conveyorItemTravel(binding, elapsedSeconds, speed, index)
    const resolved = resolveConveyorOffset(binding, travel, distance)
    const offset = resolved.offset - distance / 2
    clone.position.set(
      entry.snapshot.position.x + axisX * offset,
      entry.snapshot.position.y + axisY * offset + 0.35,
      entry.snapshot.position.z + axisZ * offset,
    )
    clone.rotation.copy(entry.object.rotation)
    clone.visible = value > 0 && resolved.visible
  }
}

function applyRuntimeEntry(
  entry: RuntimeEntry,
  elapsedSeconds: number,
  deltaSeconds: number,
  nodes: Record<string, AnyNode>,
) {
  restoreSnapshot(entry.object, entry.snapshot)
  let usedFlowArrows = false
  let usedLevelFill = false
  let usedValveHandle = false

  for (const binding of entry.bindings) {
    if (binding.type === 'visible') applyVisible(entry.object, binding)
    if (binding.type === 'blink') applyBlink(entry.object, entry.snapshot, binding, elapsedSeconds)
    if (binding.type === 'color') applyColor(entry.object, entry.snapshot, binding)
    if (binding.type === 'flow') {
      usedFlowArrows = true
      applyFlow(entry, binding, elapsedSeconds, nodes)
    }
    if (binding.type === 'brightness' || binding.type === 'valueDisplay') {
      applyBrightness(entry.snapshot, binding)
    }
    if (binding.type === 'move') applyMove(entry, binding, deltaSeconds)
    if (binding.type === 'fill' || binding.type === 'level') {
      usedLevelFill = true
      applyLevel(entry, binding, elapsedSeconds)
    }
    if (binding.type === 'scale') applyScale(entry.object, entry.snapshot, binding, elapsedSeconds)
    if (binding.type === 'openClose') {
      usedValveHandle = true
      applyOpenClose(entry, binding)
    }
    if (binding.type === 'rotate' || binding.type === 'speed') {
      applyRotate(entry.object, entry.snapshot, binding, elapsedSeconds)
    }
    if (binding.type === 'running' && truthyValue(getBindingValue(binding))) {
      applyRotate(
        entry.object,
        entry.snapshot,
        { ...binding, axis: binding.axis ?? 'y' },
        elapsedSeconds,
      )
    }
    if (binding.type === 'conveyorFlow') applyConveyorFlow(entry, binding, elapsedSeconds, nodes)
  }
  applyJointBindings(entry)

  if (!usedFlowArrows) clearFlowArrows(entry)
  if (!usedFlowArrows) clearFlowRipples(entry)
  if (!usedFlowArrows) clearFlowFill(entry)
  if (!usedLevelFill) clearLevelFill(entry)
  if (!usedValveHandle) clearValveHandle(entry)
}

const SUPPORTED_PREVIEW_DYNAMIC_TYPES = new Set<DynamicType>([
  'visible',
  'move',
  'blink',
  'fill',
  'scale',
  'color',
  'rotate',
  'flow',
  'conveyorFlow',
  'level',
  'speed',
  'openClose',
  'running',
  'brightness',
  'valueDisplay',
])

function syncRuntimeEntries(nodes: Record<string, AnyNode>, entries: Map<string, RuntimeEntry>) {
  const activeNodeIds = new Set<string>()

  for (const node of Object.values(nodes)) {
    const semanticType = getNodeSemanticType(node)
    const dynamicMetadata = readDynamicMetadata(node)
    const bindings = dynamicMetadata.dynamicBindings?.filter(
      (binding) =>
        SUPPORTED_PREVIEW_DYNAMIC_TYPES.has(binding.type) &&
        (binding.type !== 'conveyorFlow' || isConveyorSemanticType(semanticType)),
    )
    const jointChannels = dynamicMetadata.jointChannels ?? []
    const jointBindings = dynamicMetadata.jointBindings ?? []
    if (!bindings?.length && !(jointChannels.length && jointBindings.length)) continue

    const object = sceneRegistry.nodes.get(node.id as AnyNodeId)
    if (!object) continue

    activeNodeIds.add(node.id)
    const existing = entries.get(node.id)
    entries.set(node.id, {
      node,
      object,
      bindings: bindings ?? [],
      jointChannels,
      jointBindings,
      snapshot: existing?.snapshot ?? captureSnapshot(object),
      jointSnapshots: existing?.jointSnapshots ?? new Map(),
      conveyorClones: existing?.conveyorClones ?? [],
      conveyorKey: existing?.conveyorKey ?? null,
      conveyorTemplateObject: existing?.conveyorTemplateObject ?? null,
      flowArrows: existing?.flowArrows ?? [],
      flowArrowKey: existing?.flowArrowKey ?? null,
      flowRipples: existing?.flowRipples ?? [],
      flowRippleKey: existing?.flowRippleKey ?? null,
      flowFill: existing?.flowFill ?? null,
      flowFillKey: existing?.flowFillKey ?? null,
      levelFill: existing?.levelFill ?? null,
      levelFillKey: existing?.levelFillKey ?? null,
      hiddenLevelObjects: existing?.hiddenLevelObjects ?? [],
      valveHandle: existing?.valveHandle ?? null,
      moveOffsets: existing?.moveOffsets ?? {},
    })
  }

  for (const [nodeId, entry] of entries) {
    if (activeNodeIds.has(nodeId)) continue
    restoreJointSnapshots(entry)
    restoreSnapshot(entry.object, entry.snapshot)
    clearConveyorClones(entry)
    clearIndustrialVisuals(entry)
    entries.delete(nodeId)
  }
}

function writePreviewDebug(entries: Map<string, RuntimeEntry>, elapsedSeconds: number) {
  if (typeof window === 'undefined') return
  if (new URLSearchParams(window.location.search).get('factoryE2e') !== '1') return
  ;(window as Window & { __pascalDynamicPreviewRuntime?: unknown }).__pascalDynamicPreviewRuntime =
    {
      elapsedSeconds,
      entries: Array.from(entries.values()).map((entry) => ({
        nodeId: entry.node.id,
        bindings: entry.bindings.map((binding) => ({
          type: binding.type,
          path: binding.path,
          value: getBindingValue(binding),
        })),
        position: [entry.object.position.x, entry.object.position.y, entry.object.position.z],
        rotation: [entry.object.rotation.x, entry.object.rotation.y, entry.object.rotation.z],
        scale: [entry.object.scale.x, entry.object.scale.y, entry.object.scale.z],
        visible: entry.object.visible,
        materialColors: summarizeMaterialColors(entry),
        flowArrowCount: entry.flowArrows.length,
        flowArrowPositions: entry.flowArrows.map((arrow) => [
          arrow.position.x,
          arrow.position.y,
          arrow.position.z,
        ]),
        flowRippleCount: entry.flowRipples.length,
        flowRipplePositions: entry.flowRipples.map((ripple) => [
          ripple.position.x,
          ripple.position.y,
          ripple.position.z,
        ]),
        flowFill: entry.flowFill
          ? {
              position: [
                entry.flowFill.position.x,
                entry.flowFill.position.y,
                entry.flowFill.position.z,
              ],
              bounds: (() => {
                entry.flowFill.geometry.computeBoundingBox()
                const box = entry.flowFill.geometry.boundingBox
                return box
                  ? {
                      min: [box.min.x, box.min.y, box.min.z],
                      max: [box.max.x, box.max.y, box.max.z],
                    }
                  : null
              })(),
              visible: entry.flowFill.visible,
            }
          : null,
        levelFill: entry.levelFill
          ? {
              position: [
                entry.levelFill.position.x,
                entry.levelFill.position.y,
                entry.levelFill.position.z,
              ],
              scale: [entry.levelFill.scale.x, entry.levelFill.scale.y, entry.levelFill.scale.z],
              visible: entry.levelFill.visible,
              wave: !!entry.levelFill.userData.tankWave,
              castShadow: entry.levelFill.castShadow,
              receiveShadow: entry.levelFill.receiveShadow,
            }
          : null,
        valveHandle: entry.valveHandle
          ? {
              position: [
                entry.valveHandle.position.x,
                entry.valveHandle.position.y,
                entry.valveHandle.position.z,
              ],
              rotation: [
                entry.valveHandle.rotation.x,
                entry.valveHandle.rotation.y,
                entry.valveHandle.rotation.z,
              ],
              visible: entry.valveHandle.visible,
            }
          : null,
        conveyorCloneCount: entry.conveyorClones.length,
        conveyorClonePositions: entry.conveyorClones.map((clone) => [
          clone.position.x,
          clone.position.y,
          clone.position.z,
        ]),
      })),
    }
}

function clearRuntimeEntries(entries: Map<string, RuntimeEntry>) {
  for (const entry of entries.values()) {
    restoreJointSnapshots(entry)
    restoreSnapshot(entry.object, entry.snapshot)
    clearConveyorClones(entry)
    clearIndustrialVisuals(entry)
  }
  entries.clear()
  if (typeof window !== 'undefined') {
    delete (window as Window & { __pascalDynamicPreviewRuntime?: unknown })
      .__pascalDynamicPreviewRuntime
  }
}

export function DynamicPreviewRuntime() {
  const nodes = useScene((state) => state.nodes)
  const isPreviewMode = useEditor((state) => state.isPreviewMode)
  const entriesRef = useRef(new Map<string, RuntimeEntry>())
  const runtimeStartRef = useRef<number | null>(null)

  useEffect(() => {
    if (!isPreviewMode) {
      clearRuntimeEntries(entriesRef.current)
      runtimeStartRef.current = null
      return
    }
    syncRuntimeEntries(nodes, entriesRef.current)
  }, [isPreviewMode, nodes])

  useFrame(({ clock }) => {
    if (!isPreviewMode) {
      if (entriesRef.current.size > 0) clearRuntimeEntries(entriesRef.current)
      runtimeStartRef.current = null
      return
    }
    syncRuntimeEntries(nodes, entriesRef.current)
    const now = clock.getElapsedTime()
    const delta = clock.getDelta()
    if (runtimeStartRef.current == null) runtimeStartRef.current = now
    const elapsed = now - runtimeStartRef.current
    for (const entry of entriesRef.current.values()) {
      applyRuntimeEntry(entry, elapsed, delta, nodes)
    }
    writePreviewDebug(entriesRef.current, elapsed)
  })

  useEffect(() => {
    return () => {
      clearRuntimeEntries(entriesRef.current)
    }
  }, [])

  return null
}
