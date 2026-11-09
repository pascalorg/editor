import type { AnyNode } from '../../schema'
import type { Nodes } from './walls'

/** A node's name as a finding says it: its own, its asset's, or its kind and the tail of its id. */
export function nameOf(nodes: Nodes, id: string): string {
  const node = nodes[id] as (AnyNode & { name?: string; asset?: { name?: string } }) | undefined
  if (!node) return id
  const tail = id.slice(id.indexOf('_') + 1).slice(0, 4)
  return String(
    node.name ?? node.asset?.name ?? `${node.type[0]!.toUpperCase()}${node.type.slice(1)} ${tail}`,
  )
}

export const m = (v: number) => v.toFixed(2)
export const cm = (v: number) => `${Math.round(v * 100)} cm`
export const quote = (name: string) => `“${name}”`
export const unique = (ids: (string | undefined)[]) => [
  ...new Set(ids.filter((id): id is string => !!id)),
]
