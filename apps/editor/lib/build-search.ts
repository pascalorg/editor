type SearchableBuildTool = {
  id: string
  label: string
}

const TOOL_ALIASES: Record<string, readonly string[]> = {
  slab: ['floor', 'floor plate', 'platform'],
  'hvac-equipment': ['ac', 'air conditioning', 'air conditioner', 'heat pump'],
  'duct-terminal': ['air vent', 'register', 'diffuser'],
  'pipe-segment': ['plumbing', 'drain', 'waste', 'vent pipe'],
  lineset: ['refrigerant line'],
  'room-rectangle': ['rectangular room'],
  'room-polygon': ['polygonal room', 'l shaped room'],
}

function normalize(value: string): string {
  return value.toLowerCase().replace(/[-_]/g, ' ').trim()
}

export function searchBuildTools<T extends SearchableBuildTool>(
  tools: readonly T[],
  query: string,
): T[] {
  const terms = normalize(query).split(/\s+/).filter(Boolean)
  const seen = new Set<string>()
  return tools.filter((tool) => {
    if (seen.has(tool.id)) return false
    seen.add(tool.id)
    const words = normalize(
      [tool.label, tool.id, ...(TOOL_ALIASES[tool.id] ?? [])].join(' '),
    ).split(/\s+/)
    return terms.every((term) =>
      words.some((word) => (term.length <= 2 ? word.startsWith(term) : word.includes(term))),
    )
  })
}
