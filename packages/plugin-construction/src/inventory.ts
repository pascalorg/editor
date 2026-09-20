import { ELEMENT_CATEGORIES, type ElementCategoryId } from './catalog'

export type ConstructionSceneNode = {
  id: string
  type: string
  name?: string
  parentId?: string | null
  serviceType?: unknown
}

export type ConstructionScene = Readonly<Record<string, ConstructionSceneNode | undefined>>

export type InventoryRecord = {
  id: string
  type: string
  name: string
  category: ElementCategoryId
  buildingId: string
  levelId: string
}

const kindCategories = new Map<string, ElementCategoryId>(
  ELEMENT_CATEGORIES.flatMap((category) =>
    category.kinds.map((kind) => [kind, category.id] as const),
  ),
)

export function elementCategory(node: ConstructionSceneNode): ElementCategoryId | undefined {
  if (node.type === 'bones:service') {
    if (['panel', 'power-entry', 'electric-meter'].includes(String(node.serviceType)))
      return 'electrical'
    if (['water-heater', 'water-entry', 'sewer-exit'].includes(String(node.serviceType)))
      return 'plumbing'
    if (['thermostat', 'heat-pump'].includes(String(node.serviceType))) return 'hvac'
    if (node.serviceType === 'utility-pole') return 'site'
    return undefined
  }
  return kindCategories.get(node.type)
}

function ancestry(node: ConstructionSceneNode, nodes: ConstructionScene) {
  let buildingId = ''
  let levelId = ''
  let siteId = ''
  let current: ConstructionSceneNode | undefined = node
  const seen = new Set<string>()
  while (current && !seen.has(current.id)) {
    seen.add(current.id)
    if (current.type === 'building' && !buildingId) buildingId = current.id
    if (current.type === 'level' && !levelId) levelId = current.id
    if (current.type === 'site' && !siteId) siteId = current.id
    current = current.parentId ? nodes[current.parentId] : undefined
  }
  return { buildingId, levelId, siteId }
}

export function inspectConstruction(nodes: ConstructionScene, buildingId?: string) {
  const buildings = Object.values(nodes)
    .filter((node): node is ConstructionSceneNode => node?.type === 'building')
    .map((node) => ({ id: node.id, name: node.name || 'Unnamed building' }))
    .sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id))
  const scopeRequired = buildings.length > 1 && !buildingId
  const invalidScope = Boolean(
    buildingId && !buildings.some((building) => building.id === buildingId),
  )
  const selectedBuildingId = buildingId ?? (buildings.length === 1 ? buildings[0]?.id : undefined)
  const selectedBuilding = selectedBuildingId ? nodes[selectedBuildingId] : undefined
  const selectedSiteId = selectedBuilding ? ancestry(selectedBuilding, nodes).siteId : ''
  const records: InventoryRecord[] = []
  let unrecognizedCount = 0
  let unscopedCount = 0

  if (!scopeRequired && !invalidScope) {
    for (const node of Object.values(nodes)) {
      if (
        !node ||
        ['building', 'level', 'section-marker', 'elevation-marker'].includes(node.type) ||
        node.type.startsWith('sheets:')
      )
        continue
      const scope = ancestry(node, nodes)
      if (
        selectedBuildingId &&
        scope.buildingId !== selectedBuildingId &&
        !(scope.siteId === selectedSiteId && selectedSiteId && !scope.buildingId)
      ) {
        if (!scope.buildingId && !scope.siteId) unscopedCount += 1
        continue
      }
      const category = elementCategory(node)
      if (!category) {
        unrecognizedCount += 1
        continue
      }
      records.push({
        id: node.id,
        type: node.type,
        name: node.name ?? '',
        category,
        buildingId: scope.buildingId,
        levelId: scope.levelId,
      })
    }
  }

  records.sort(
    (a, b) =>
      a.category.localeCompare(b.category) ||
      a.type.localeCompare(b.type) ||
      a.id.localeCompare(b.id),
  )
  return {
    buildings,
    selectedBuildingId,
    scopeRequired,
    invalidScope,
    records,
    unrecognizedCount,
    unscopedCount,
  }
}

function csvCell(value: string): string {
  const safe = /^[\s]*[=+@-]/.test(value) ? `'${value}` : value
  return `"${safe.replaceAll('"', '""')}"`
}

export function inventoryCsv(records: readonly InventoryRecord[]): string {
  const labels = new Map(ELEMENT_CATEGORIES.map((category) => [category.id, category.label]))
  const rows = [
    ['Record ID', 'Name', 'Type', 'Category', 'Building ID', 'Level ID'],
    ...records.map((record) => [
      record.id,
      record.name,
      record.type,
      labels.get(record.category) ?? record.category,
      record.buildingId,
      record.levelId,
    ]),
  ]
  return `${rows.map((row) => row.map(csvCell).join(',')).join('\r\n')}\r\n`
}
