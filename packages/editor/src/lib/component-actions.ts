import { type AnyNodeId, type DefinitionId, nodeRegistry, useScene } from '@pascal-app/core'

function escapeXml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => {
    if (character === '&') return '&amp;'
    if (character === '<') return '&lt;'
    if (character === '>') return '&gt;'
    if (character === '"') return '&quot;'
    return '&apos;'
  })
}

export function createDefinitionThumbnail(name: string): string {
  const initials =
    name
      .trim()
      .split(/\s+/)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase() ?? '')
      .join('') || 'C'
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 160 120"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#312e81"/><stop offset="1" stop-color="#7c3aed"/></linearGradient></defs><rect width="160" height="120" rx="16" fill="url(#g)"/><path d="M48 42l32-18 32 18v36L80 96 48 78V42zm32-10L58 44l22 12 22-12-22-12zm-26 20v22l23 13V63L54 52zm29 35l23-13V52L83 63v24z" fill="white" fill-opacity=".22"/><text x="80" y="70" text-anchor="middle" font-family="system-ui,sans-serif" font-size="28" font-weight="700" fill="white">${escapeXml(initials)}</text></svg>`
  return `data:image/svg+xml,${encodeURIComponent(svg)}`
}

export function makeNodeComponent(nodeId: AnyNodeId) {
  const state = useScene.getState()
  const node = state.nodes[nodeId]
  if (!node) return null
  const name = node.name ?? nodeRegistry.get(node.type)?.presentation?.label ?? 'Component'
  return state.makeComponent(nodeId, {
    name,
    thumbnail: createDefinitionThumbnail(name),
  })
}

export function makeInstanceUnique(instanceId: AnyNodeId): DefinitionId | null {
  const state = useScene.getState()
  const instance = state.nodes[instanceId]
  if (instance?.type !== 'instance') return null
  const source = state.definitions[instance.definitionId]
  if (!source) return null
  const name = `${source.name} copy`
  return state.makeInstanceUnique(instanceId, {
    name,
    thumbnail: createDefinitionThumbnail(name),
  })
}
