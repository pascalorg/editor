import {
  type AnyNode,
  type AnyNodeId,
  getScaledDimensions,
  getSurfaceProvider,
  type HandleDescriptor,
  nodeRegistry,
  type SceneApi,
  surfaceRegionContainsFootprint,
} from '@pascal-app/core'
import { boundsOf, boxCorners, frame, transformPoint } from '@pascal-app/core/procedural-items'

export type HostedEditPolicy = {
  host: (node: AnyNode) => boolean
  child: (node: AnyNode) => boolean
}

type Nodes = Record<AnyNodeId, AnyNode>
export type HostedUpdate = readonly [AnyNodeId, Partial<AnyNode>]

function surfaceScene(nodes: Nodes) {
  return {
    nodes: () => nodes,
    get: <N extends AnyNode = AnyNode>(id: AnyNodeId) => nodes[id] as N | undefined,
  }
}

export function hostedChildUpdates(
  before: Nodes,
  after: Nodes,
  policy: HostedEditPolicy,
): HostedUpdate[] | null {
  const updates: HostedUpdate[] = []
  for (const host of Object.values(before)) {
    if (!policy.host(host)) continue
    const children = ((host as AnyNode & { children?: string[] }).children ?? [])
      .map((id) => before[id as AnyNodeId])
      .filter((child) => child?.parentId === host.id && policy.child(child))
    if (!children.length) continue
    const nextHost = after[host.id]
    if (!nextHost || !policy.host(nextHost)) return null
    const provider = getSurfaceProvider(host)
    const nextSurfaces = provider.surfaces?.(nextHost, { scene: surfaceScene(after) }) ?? []
    if (
      JSON.stringify(provider.surfaces?.(host, { scene: surfaceScene(before) })) ===
      JSON.stringify(nextSurfaces)
    )
      continue
    for (const child of children) {
      if (!child || !('position' in child) || !('rotation' in child)) continue
      const bounds =
        child.type === 'item'
          ? { size: getScaledDimensions(child), center: undefined }
          : nodeRegistry.get(child.type)?.capabilities.dragBounds?.(child, before)
      if (!bounds) continue
      const center = bounds.center ?? [0, bounds.size[1] / 2, 0]
      const localBounds = {
        min: center.map((v, i) => v - bounds.size[i]! / 2) as [number, number, number],
        max: center.map((v, i) => v + bounds.size[i]! / 2) as [number, number, number],
      }
      const position = child.position as [number, number, number]
      const rotation = (
        typeof child.rotation === 'number' ? [0, child.rotation, 0] : child.rotation
      ) as [number, number, number]
      const projected = boundsOf(
        boxCorners(localBounds.min, localBounds.max).map((p) =>
          transformPoint(frame(position, rotation), p),
        ),
      )
      const hit = {
        point: [
          (projected.min[0] + projected.max[0]) / 2,
          projected.min[1],
          (projected.min[2] + projected.max[2]) / 2,
        ] as const,
        normalWorldY: 1,
      }
      const previousSurface = provider.resolveHit(host, hit, { scene: surfaceScene(before) })
      if (!previousSurface || Math.abs(previousSurface.position[1] - projected.min[1]) > 1e-5)
        continue
      const nextSurface = nextSurfaces.find((surface) => surface.id === previousSurface.id)
      if (!nextSurface) return null
      const nextPosition: [number, number, number] = [
        position[0],
        position[1] + nextSurface.position[1] - previousSurface.position[1],
        position[2],
      ]
      const surfaceLocal: [number, number, number] = [
        nextPosition[0] - nextSurface.position[0],
        nextPosition[1] - nextSurface.position[1],
        nextPosition[2] - nextSurface.position[2],
      ]
      if (
        !surfaceRegionContainsFootprint(
          nextSurface.region,
          surfaceLocal,
          bounds.size,
          rotation,
          localBounds,
        )
      )
        return null
      if (Math.abs(nextPosition[1] - position[1]) > 1e-8)
        updates.push([child.id, { position: nextPosition } as Partial<AnyNode>])
    }
  }
  return updates
}

export function planHostedEdit(
  sceneApi: SceneApi,
  apply: (staged: SceneApi) => void,
  policy: HostedEditPolicy,
): HostedUpdate[] | null {
  const before = sceneApi.nodes()
  const after = { ...before }
  const updates = new Map<AnyNodeId, Partial<AnyNode>>()
  let supported = true
  const staged: SceneApi = {
    ...sceneApi,
    ...surfaceScene(after),
    update(id, data) {
      if (!after[id]) return
      after[id] = { ...after[id], ...data } as AnyNode
      updates.set(id, { ...updates.get(id), ...data } as Partial<AnyNode>)
    },
    upsert(node) {
      supported = false
      return node.id
    },
    delete() {
      supported = false
    },
    markDirty() {},
    pauseHistory() {},
    resumeHistory() {},
  }
  apply(staged)
  if (!supported) return null
  const children = hostedChildUpdates(before, after, policy)
  if (!children) return null
  for (const [id, data] of children) updates.set(id, data)
  return [...updates] as HostedUpdate[]
}

export function withHostedChildren<N extends AnyNode>(
  descriptor: HandleDescriptor<N>,
  policy: HostedEditPolicy,
): HandleDescriptor<N> {
  if (descriptor.kind === 'radial-resize')
    return {
      ...descriptor,
      apply(node: N, value: number, scene: SceneApi) {
        const patch = descriptor.apply(node, value, scene)
        if (planHostedEdit(scene, (staged) => staged.update(node.id, patch), policy)) return patch
        return Object.fromEntries(
          Object.keys(patch).map((key) => [key, (node as Record<string, unknown>)[key]]),
        ) as Partial<N>
      },
    }
  if (descriptor.kind !== 'linear-resize') return descriptor
  const plan = (node: N, patch: Partial<N>, sceneApi: SceneApi, modifiers?: { altKey: boolean }) =>
    planHostedEdit(
      sceneApi,
      (staged) => {
        if (descriptor.commit) descriptor.commit(node, patch, staged, modifiers)
        else staged.update(descriptor.overrideTarget?.(node, staged) ?? node.id, patch)
      },
      policy,
    )
  const hasHostedChildren = (scene: SceneApi) =>
    Object.values(scene?.nodes() ?? {}).some(
      (node) =>
        policy.host(node) &&
        ((node as AnyNode & { children?: string[] }).children ?? []).some((id) => {
          const child = scene.get(id as AnyNodeId)
          return child && policy.child(child)
        }),
    )
  return {
    ...descriptor,
    apply(node, value, sceneApi, modifiers) {
      const patch = descriptor.apply(node, value, sceneApi, modifiers)
      if (!hasHostedChildren(sceneApi) || plan(node, patch, sceneApi, modifiers)) return patch
      const target = sceneApi.get(descriptor.overrideTarget?.(node, sceneApi) ?? node.id) ?? node
      return Object.fromEntries(
        Object.keys(patch).map((key) => [key, (target as Record<string, unknown>)[key]]),
      ) as Partial<N>
    },
    previewOverrides(node, value, sceneApi, modifiers) {
      if (!hasHostedChildren(sceneApi))
        return descriptor.previewOverrides?.(node, value, sceneApi, modifiers) ?? []
      const patch = descriptor.apply(node, value, sceneApi, modifiers)
      return plan(node, patch, sceneApi, modifiers) ?? []
    },
    commit(node, patch, sceneApi, modifiers) {
      if (!hasHostedChildren(sceneApi)) {
        if (descriptor.commit) descriptor.commit(node, patch, sceneApi, modifiers)
        else sceneApi.update(descriptor.overrideTarget?.(node, sceneApi) ?? node.id, patch)
        return
      }
      const updates = plan(node, patch, sceneApi, modifiers)
      if (!updates) return
      for (const [id, data] of updates) {
        sceneApi.update(id, data)
        sceneApi.markDirty(id)
      }
    },
  }
}
