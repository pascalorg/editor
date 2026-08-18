import {
  type AnyNode,
  type AnyNodeId,
  type ParametricDescriptor,
  useLiveNodeOverrides,
  useScene,
} from '@pascal-app/core'

export type ReducedFieldValue<T = unknown> =
  | { kind: 'same'; value: T }
  | { kind: 'mixed' }

const MIXED: { kind: 'mixed' } = { kind: 'mixed' }

function fieldValuesEqual(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true
  if (Array.isArray(a) && Array.isArray(b) && a.length === b.length) {
    return a.every((value, i) => Object.is(value, b[i]))
  }
  return false
}

export function reduceFieldValue(
  nodeIds: readonly string[],
  key: string,
  nodes: Readonly<Record<string, AnyNode | undefined>>,
): ReducedFieldValue {
  let seen = false
  let shared: unknown
  for (const id of nodeIds) {
    const node = nodes[id]
    if (!node) continue
    const value = (node as Record<string, unknown>)[key]
    if (!seen) {
      seen = true
      shared = value
      continue
    }
    if (!fieldValuesEqual(shared, value)) return MIXED
  }
  if (!seen) return MIXED
  return { kind: 'same', value: shared }
}

export type HeightBoundMode = 'storey' | 'custom'

export function reduceHeightBoundMode(
  nodeIds: readonly string[],
  nodes: Readonly<Record<string, AnyNode | undefined>>,
): ReducedFieldValue<HeightBoundMode> {
  let seen = false
  let shared: HeightBoundMode | undefined
  for (const id of nodeIds) {
    const node = nodes[id]
    if (!node) continue
    const mode: HeightBoundMode = (node as { height?: number }).height == null ? 'storey' : 'custom'
    if (!seen) {
      seen = true
      shared = mode
      continue
    }
    if (mode !== shared) return MIXED
  }
  if (!seen || !shared) return MIXED
  return { kind: 'same', value: shared }
}

export function fieldVisibleForAll(
  nodeIds: readonly string[],
  visibleIf: ((node: AnyNode) => boolean) | undefined,
  nodes: Readonly<Record<string, AnyNode | undefined>>,
): boolean {
  if (!visibleIf) return true
  for (const id of nodeIds) {
    const node = nodes[id]
    if (!node || !visibleIf(node)) return false
  }
  return true
}

export function firstNumericFieldValue(
  nodeIds: readonly string[],
  key: string,
  nodes: Readonly<Record<string, AnyNode | undefined>>,
  fallback = 0,
): number {
  for (const id of nodeIds) {
    const node = nodes[id]
    const value = node ? (node as Record<string, unknown>)[key] : undefined
    if (typeof value === 'number' && Number.isFinite(value)) return value
  }
  return fallback
}

export function firstVec3FieldValue(
  nodeIds: readonly string[],
  key: string,
  nodes: Readonly<Record<string, AnyNode | undefined>>,
): [number, number, number] {
  for (const id of nodeIds) {
    const node = nodes[id]
    const value = node ? (node as Record<string, unknown>)[key] : undefined
    if (Array.isArray(value) && value.length >= 3) {
      return [Number(value[0]) || 0, Number(value[1]) || 0, Number(value[2]) || 0]
    }
  }
  return [0, 0, 0]
}

export function buildMultiNodePatches(
  nodeIds: readonly AnyNodeId[],
  patchFor: (node: AnyNode) => Partial<AnyNode>,
  nodes: Readonly<Record<string, AnyNode | undefined>>,
  parametrics?: Pick<ParametricDescriptor<AnyNode>, 'derive' | 'reconcile'>,
): Array<{ id: AnyNodeId; data: Partial<AnyNode> }> {
  const updates: Array<{ id: AnyNodeId; data: Partial<AnyNode> }> = []
  const followUps: Array<{ id: AnyNodeId; data: Partial<AnyNode> }> = []
  for (const id of nodeIds) {
    const node = nodes[id]
    if (!node) continue
    let patch = patchFor(node)
    if (Object.keys(patch).length === 0) continue
    if (parametrics?.derive) {
      const next = { ...node, ...patch } as AnyNode
      patch = { ...patch, ...parametrics.derive(next, patch) } as Partial<AnyNode>
    }
    updates.push({ id, data: patch })
    if (parametrics?.reconcile) {
      const next = { ...node, ...patch } as AnyNode
      followUps.push(...parametrics.reconcile(node, next))
    }
  }
  return [...updates, ...followUps]
}

export function previewMultiNodeFields(
  entries: ReadonlyArray<readonly [AnyNodeId, Partial<AnyNode>]>,
): void {
  if (entries.length === 0) return
  useLiveNodeOverrides.getState().setMany(entries)
  const scene = useScene.getState()
  for (const [id] of entries) scene.markDirty(id)
}

export function commitMultiNodeFields(
  nodeIds: readonly AnyNodeId[],
  patchFor: (node: AnyNode) => Partial<AnyNode>,
  parametrics?: Pick<ParametricDescriptor<AnyNode>, 'derive' | 'reconcile'>,
): void {
  const scene = useScene.getState()
  const patches = buildMultiNodePatches(nodeIds, patchFor, scene.nodes, parametrics)
  const keys = new Set<string>()
  for (const patch of patches) {
    for (const key of Object.keys(patch.data)) keys.add(key)
  }
  const live = useLiveNodeOverrides.getState()
  const keyList = [...keys]
  for (const id of nodeIds) {
    if (keyList.length > 0) live.clearFields(id, keyList)
    scene.markDirty(id)
  }
  if (patches.length > 0) scene.updateNodes(patches)
}
