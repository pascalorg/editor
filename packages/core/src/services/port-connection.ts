import { findLevelAncestorId } from '../lib/node-ancestry'
import { type NodePort, nodeRegistry } from '../registry'
import type { AnyNode } from '../schema'

export type ConnectionProfile = Pick<
  NodePort,
  'system' | 'diameter' | 'shape' | 'width' | 'height' | 'connectionType'
>
export type ConnectionCompatibility = {
  status: 'match' | 'adapter' | 'incompatible' | 'unknown'
  label: string
}

export function connectionCompatibility(
  source: ConnectionProfile,
  target: ConnectionProfile,
): ConnectionCompatibility {
  if (source.system && target.system && source.system !== target.system) {
    return {
      status: 'incompatible',
      label: `Different systems: ${source.system} / ${target.system}`,
    }
  }
  if (
    source.connectionType &&
    target.connectionType &&
    source.connectionType !== target.connectionType
  ) {
    return {
      status: 'incompatible',
      label: `Different connections: ${source.connectionType} / ${target.connectionType}`,
    }
  }
  const sourceShape = source.shape ?? 'round'
  const targetShape = target.shape ?? 'round'
  if (sourceShape !== targetShape) {
    return { status: 'adapter', label: `Transition needed: ${sourceShape} / ${targetShape}` }
  }
  const sourceSize = sourceShape === 'round' ? [source.diameter] : [source.width, source.height]
  const targetSize = targetShape === 'round' ? [target.diameter] : [target.width, target.height]
  if (
    [...sourceSize, ...targetSize].some(
      (value) => value === undefined || !Number.isFinite(value) || value <= 0,
    )
  ) {
    return { status: 'unknown', label: 'Connection size unavailable' }
  }
  if (sourceSize.some((value, index) => Math.abs(value! - targetSize[index]!) > 0.001)) {
    return {
      status: 'adapter',
      label: `Reducer needed: ${sourceSize.join(' × ')}″ / ${targetSize.join(' × ')}″`,
    }
  }
  if (!source.system || !target.system) {
    return { status: 'unknown', label: 'Size matches; system unspecified' }
  }
  return { status: 'match', label: `Matching system and size: ${target.system}` }
}

/** Evaluate a proposed physical joint; positions and directions must share a frame. */
export function portConnection(source: NodePort, target: NodePort): ConnectionCompatibility {
  if (
    ![...source.position, ...target.position, ...source.direction, ...target.direction].every(
      Number.isFinite,
    )
  ) {
    return { status: 'unknown', label: 'Connection coordinates unavailable' }
  }
  if (
    Math.hypot(...source.position.map((value, index) => value - target.position[index]!)) > 0.05
  ) {
    return { status: 'incompatible', label: 'Ports are not joined' }
  }
  const compatibility = connectionCompatibility(source, target)
  if (compatibility.status !== 'match') return compatibility
  const a = Math.hypot(...source.direction)
  const b = Math.hypot(...target.direction)
  if (a < 1e-9 || b < 1e-9) return { status: 'unknown', label: 'Connection direction unavailable' }
  const dot =
    source.direction.reduce((sum, value, index) => sum + value * target.direction[index]!, 0) /
    (a * b)
  if (dot > -0.95) return { status: 'incompatible', label: 'Ports must face each other' }
  return compatibility
}

/** Snap a planar move only where its fixed-height ports can form a valid joint. */
export function snapPlanarPortPosition(
  node: AnyNode,
  candidate: [number, number],
  nodes: Readonly<Record<string, AnyNode>>,
  config: { systems?: readonly string[]; radius?: number },
): [number, number] | null {
  const nodePos = (node as { position?: [number, number, number] }).position
  if (!nodePos) return null
  const ownPorts = nodeRegistry.get(node.type)?.ports?.(node)
  if (!ownPorts || ownPorts.length === 0) return null

  const radius = config.radius ?? 0.5
  const radiusSq = radius * radius
  const { systems } = config
  const dragDx = candidate[0] - nodePos[0]
  const dragDz = candidate[1] - nodePos[2]

  const levelId = findLevelAncestorId(node.id, nodes)
  let bestDistSq = radiusSq
  let snap: [number, number] | null = null

  for (const node2 of Object.values(nodes)) {
    if (
      !node2 ||
      node2.id === node.id ||
      node2.visible === false ||
      findLevelAncestorId(node2.id, nodes) !== levelId
    )
      continue
    const targets = nodeRegistry.get(node2.type)?.ports?.(node2)
    if (!targets) continue
    for (const target of targets) {
      if (systems && target.system !== undefined && !systems.includes(target.system)) continue
      for (const own of ownPorts) {
        // Own port at the candidate position = stored port + drag delta.
        const ownX = own.position[0] + dragDx
        const ownZ = own.position[2] + dragDz
        const dx = target.position[0] - ownX
        const dz = target.position[2] - ownZ
        const distSq = dx * dx + dz * dz
        if (
          distSq <= bestDistSq &&
          portConnection(
            { ...own, position: [target.position[0], own.position[1], target.position[2]] },
            target,
          ).status === 'match'
        ) {
          bestDistSq = distSq
          // Shift the node so this own port lands on the target (XZ only).
          snap = [candidate[0] + dx, candidate[1] + dz]
        }
      }
    }
  }
  return snap
}
