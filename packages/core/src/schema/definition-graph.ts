import type { Definition, DefinitionId } from './definitions'

export type DefinitionGraphNode = {
  id?: string
  type?: string
  children?: unknown
  definitionId?: unknown
}

export type MissingDefinitionReference = {
  definitionId: DefinitionId
  nodeId: string
  referencedDefinitionId: DefinitionId
}

export type DefinitionGraphAnalysis = {
  cycles: DefinitionId[][]
  dependencies: Map<DefinitionId, Set<DefinitionId>>
  missingReferences: MissingDefinitionReference[]
}

function asDefinitionGraphNode(value: unknown): DefinitionGraphNode | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as DefinitionGraphNode)
    : null
}

export function collectDefinitionSubtreeNodeIds(
  nodes: Record<string, unknown>,
  rootNodeId: string,
): Set<string> {
  const ids = new Set<string>()
  const pending = [rootNodeId]

  while (pending.length > 0) {
    const id = pending.pop()
    if (!id || ids.has(id)) continue
    const node = asDefinitionGraphNode(nodes[id])
    if (!node) continue
    ids.add(id)
    if (!Array.isArray(node.children)) continue
    for (const childId of node.children) {
      if (typeof childId === 'string') pending.push(childId)
    }
  }

  return ids
}

function canonicalCycle(cycle: DefinitionId[]): string {
  const body = cycle.slice(0, -1)
  if (body.length === 0) return ''
  let best = body
  for (let index = 1; index < body.length; index += 1) {
    const rotated = [...body.slice(index), ...body.slice(0, index)]
    if (rotated.join('\0') < best.join('\0')) best = rotated
  }
  return [...best, best[0]].join('\0')
}

export function analyzeDefinitionGraph(
  definitions: Record<DefinitionId, Definition>,
  nodes: Record<string, unknown>,
): DefinitionGraphAnalysis {
  const dependencies = new Map<DefinitionId, Set<DefinitionId>>()
  const missingReferences: MissingDefinitionReference[] = []

  for (const definition of Object.values(definitions)) {
    const referencedIds = new Set<DefinitionId>()
    for (const nodeId of collectDefinitionSubtreeNodeIds(nodes, definition.rootNodeId)) {
      const node = asDefinitionGraphNode(nodes[nodeId])
      if (node?.type !== 'instance' || typeof node.definitionId !== 'string') continue
      const referencedDefinitionId = node.definitionId as DefinitionId
      referencedIds.add(referencedDefinitionId)
      if (!definitions[referencedDefinitionId]) {
        missingReferences.push({
          definitionId: definition.id,
          nodeId,
          referencedDefinitionId,
        })
      }
    }
    dependencies.set(definition.id, referencedIds)
  }

  const cycles: DefinitionId[][] = []
  const seenCycles = new Set<string>()
  const visited = new Set<DefinitionId>()
  const active = new Set<DefinitionId>()
  const stack: DefinitionId[] = []

  const visit = (definitionId: DefinitionId) => {
    if (visited.has(definitionId)) return
    active.add(definitionId)
    stack.push(definitionId)

    for (const dependencyId of dependencies.get(definitionId) ?? []) {
      if (!definitions[dependencyId]) continue
      if (!active.has(dependencyId)) {
        visit(dependencyId)
        continue
      }
      const start = stack.indexOf(dependencyId)
      if (start === -1) continue
      const cycle = [...stack.slice(start), dependencyId]
      const key = canonicalCycle(cycle)
      if (!seenCycles.has(key)) {
        seenCycles.add(key)
        cycles.push(cycle)
      }
    }

    stack.pop()
    active.delete(definitionId)
    visited.add(definitionId)
  }

  for (const definitionId of Object.keys(definitions).sort() as DefinitionId[]) {
    visit(definitionId)
  }

  return { cycles, dependencies, missingReferences }
}

export function wouldCreateDefinitionCycle(
  definitions: Record<DefinitionId, Definition>,
  nodes: Record<string, unknown>,
  ownerDefinitionId: DefinitionId,
  referencedDefinitionId: DefinitionId,
): boolean {
  if (ownerDefinitionId === referencedDefinitionId) return true
  const { dependencies } = analyzeDefinitionGraph(definitions, nodes)
  const pending = [referencedDefinitionId]
  const visited = new Set<DefinitionId>()

  while (pending.length > 0) {
    const definitionId = pending.pop()
    if (!definitionId || visited.has(definitionId)) continue
    if (definitionId === ownerDefinitionId) return true
    visited.add(definitionId)
    pending.push(...(dependencies.get(definitionId) ?? []))
  }

  return false
}
