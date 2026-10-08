import { emitter, nodeRegistry, type RoofType } from '@pascal-app/core'
import {
  CATALOG_ITEMS,
  type FloorplanMode,
  getFloorplanNodeExtension,
  isFloorplanToolAvailableInMode,
  useEditor,
  useFloorplanMode,
} from '@pascal-app/editor'
import { beginFenceFeaturePlacement } from '@pascal-app/nodes'
import { useViewer } from '@pascal-app/viewer'
import { getRoofFootprintSource, type RoofFootprintSource } from '@/lib/build-tab-state'

export type BuildType = {
  id: string
  label: string
  iconSrc: string
  kind?: string
  paletteOrder?: number
  mode?: 'terrain-sculpt'
  /**
   * The Build panel group listing the tile; registry-discovered kinds land in
   * Advanced. The wall has none: the Rooms group's variant tiles arm it.
   */
  section?: 'add' | 'outdoor' | 'advanced'
}

export type MepItem = {
  id: string
  label: string
  iconSrc: string
  kind: string
}

export type RoofFeature = {
  id: string
  label: string
  iconSrc: string
  kind?: string
}

export const BASE_BUILD_TYPES: BuildType[] = [
  { id: 'wall', label: 'Wall', iconSrc: '/icons/wall.webp', kind: 'wall' },
  { id: 'fence', label: 'Fence', iconSrc: '/icons/fence.webp', kind: 'fence', section: 'outdoor' },
  { id: 'slab', label: 'Slab', iconSrc: '/icons/floor.webp', kind: 'slab', section: 'advanced' },
  {
    id: 'ceiling',
    label: 'Ceiling',
    iconSrc: '/icons/ceiling.webp',
    kind: 'ceiling',
    section: 'advanced',
  },
  { id: 'roof', label: 'Roof', iconSrc: '/icons/roof.webp', kind: 'roof', section: 'add' },
  { id: 'stair', label: 'Stairs', iconSrc: '/icons/stairs.webp', kind: 'stair', section: 'add' },
  {
    id: 'elevator',
    label: 'Elevator',
    iconSrc: '/icons/elevator.webp',
    kind: 'elevator',
    section: 'advanced',
  },
  { id: 'door', label: 'Door', iconSrc: '/icons/door.webp', kind: 'door', section: 'add' },
  { id: 'window', label: 'Window', iconSrc: '/icons/window.webp', kind: 'window', section: 'add' },
  {
    id: 'column',
    label: 'Column',
    iconSrc: '/icons/column.webp',
    kind: 'column',
    section: 'advanced',
  },
  { id: 'shelf', label: 'Shelf', iconSrc: '/icons/shelf.webp', kind: 'shelf', section: 'add' },
  {
    id: 'spawn',
    label: 'Spawn point',
    iconSrc: '/icons/spawn-point.webp',
    kind: 'spawn',
    section: 'advanced',
  },
  { id: 'kitchen', label: 'Kitchen', iconSrc: '/icons/kitchen.webp', section: 'add' },
  { id: 'mep', label: 'MEP', iconSrc: '/icons/HVAC.webp', section: 'advanced' },
  {
    id: 'terrain',
    label: 'Terrain',
    iconSrc: '/icons/mesh.webp',
    mode: 'terrain-sculpt',
    section: 'outdoor',
  },
  // An outdoor room (no walls, no ceiling), drawn like a room; see `startTerraceDraft`.
  { id: 'terrace', label: 'Terrace', iconSrc: '/icons/floor.webp', section: 'outdoor' },
]

export const MEP_ITEMS: MepItem[] = [
  { id: 'duct-segment', label: 'Duct', iconSrc: '/icons/duct.webp', kind: 'duct-segment' },
  {
    id: 'duct-terminal',
    label: 'Register',
    iconSrc: '/icons/registers.webp',
    kind: 'duct-terminal',
  },
  { id: 'hvac-equipment', label: 'HVAC Unit', iconSrc: '/icons/HVAC.webp', kind: 'hvac-equipment' },
  { id: 'lineset', label: 'Lineset', iconSrc: '/icons/lineset.webp', kind: 'lineset' },
  { id: 'liquid-line', label: 'Liquid Line', iconSrc: '/icons/lineset.webp', kind: 'liquid-line' },
  { id: 'pipe-segment', label: 'DWV Pipe', iconSrc: '/icons/dwv-pipes.webp', kind: 'pipe-segment' },
]

export const MEP_TOOL_KINDS = new Set<string>([
  ...MEP_ITEMS.map((item) => item.kind),
  'duct-fitting',
  'pipe-fitting',
  'pipe-trap',
])

const MODULAR_CABINET_CATALOG_ITEM = CATALOG_ITEMS.find((item) => item.id === 'cabinet')
export const MODULAR_CABINET_ICON = MODULAR_CABINET_CATALOG_ITEM?.thumbnail ?? '/icons/item.webp'

export function collectBuildTypes(floorplanMode: FloorplanMode): BuildType[] {
  const baseKinds = new Set(BASE_BUILD_TYPES.flatMap((type) => (type.kind ? [type.kind] : [])))
  const tools = BASE_BUILD_TYPES.filter((type) => type.kind).map((type, index) => ({
    ...type,
    paletteOrder:
      nodeRegistry.get(type.kind!)?.presentation?.paletteOrder ?? type.paletteOrder ?? index * 10,
  }))
  for (const [kind, definition] of nodeRegistry.entries()) {
    const presentation = definition.presentation
    const extension = getFloorplanNodeExtension(definition)
    if (
      baseKinds.has(kind) ||
      presentation?.paletteGroup === 'roof-features' ||
      !extension?.tool ||
      !isFloorplanToolAvailableInMode(extension.availableModes, floorplanMode) ||
      !presentation ||
      presentation.hidden ||
      presentation.paletteSection !== 'structure'
    )
      continue
    tools.push({
      id: kind,
      kind,
      label: presentation.label,
      iconSrc: presentation.icon.kind === 'url' ? presentation.icon.src : '/icons/spawn-point.webp',
      paletteOrder: presentation.paletteOrder ?? Number.MAX_SAFE_INTEGER,
      section: 'advanced',
    })
  }
  tools.sort((left, right) => (left.paletteOrder ?? 0) - (right.paletteOrder ?? 0))
  return [...tools, ...BASE_BUILD_TYPES.filter((type) => !type.kind)]
}

export function activateBuildTool(kind: string): void {
  const editor = useEditor.getState()
  const definition = nodeRegistry.get(kind)
  const extension = getFloorplanNodeExtension(definition)
  if (
    !isFloorplanToolAvailableInMode(extension?.availableModes, useFloorplanMode.getState().mode)
  ) {
    useFloorplanMode.getState().showExpertModeNotice(definition?.presentation?.label ?? kind)
    return
  }
  if (extension?.preferredView) editor.setViewMode(extension.preferredView)
  useViewer.getState().setSelection({ selectedIds: [], zoneId: null })
  editor.setPhase('building')
  editor.setCatalogCategory(null)
  editor.setToolDefaults(kind, null)
  editor.setMode('build')
  editor.setTool(kind)
}

export function activateFenceFeaturePlacement(kind: 'gate' | 'opening'): void {
  beginFenceFeaturePlacement(kind)
}

export function activateSelectMode(): void {
  emitter.emit('tool:cancel')
  useEditor.getState().setMode('select')
}

export function activateModularCabinetTool(): void {
  const editor = useEditor.getState()
  useViewer.getState().setSelection({ selectedIds: [], zoneId: null })
  if (MODULAR_CABINET_CATALOG_ITEM) editor.setSelectedItem(MODULAR_CABINET_CATALOG_ITEM)
  editor.setPhase('building')
  editor.setCatalogCategory(null)
  editor.setMode('build')
  editor.setTool('cabinet')
}

export function activatePaintMode(): void {
  const editor = useEditor.getState()
  if (editor.mode === 'material-paint') return
  editor.setPhase('building')
  editor.armMaterialPaint()
}

export function activateTerrainSculptMode(): void {
  useEditor.getState().setMode('terrain-sculpt')
}

export function collectRoofFeatures(): RoofFeature[] {
  const features: RoofFeature[] = []
  for (const [kind, definition] of nodeRegistry.entries()) {
    if (
      definition.capabilities.roofAccessory === undefined &&
      definition.presentation?.paletteGroup !== 'roof-features'
    )
      continue
    if (definition.capabilities.wallOpeningPlacement) continue
    const icon = definition.presentation?.icon
    features.push({
      id: kind,
      kind,
      label: definition.presentation?.label ?? kind,
      iconSrc: icon?.kind === 'url' ? icon.src : '/icons/roof.webp',
    })
  }
  return features
}

export function activateRoofFeatureTool(feature: RoofFeature): void {
  const editor = useEditor.getState()
  useViewer.getState().setSelection({ selectedIds: [], zoneId: null })
  editor.setPhase('building')
  editor.setCatalogCategory(null)
  editor.setMode('build')
  if (feature.kind) editor.setTool(feature.kind)
}

export function activateRoofType(roofType: RoofType): void {
  const editor = useEditor.getState()
  if (!(editor.mode === 'build' && editor.tool === 'roof')) activateBuildTool('roof')
  const footprintSource = getRoofFootprintSource(
    roofType,
    editor.toolDefaults.roof?.footprintSource,
  )
  editor.setToolDefaults('roof', { ...editor.toolDefaults.roof, roofType, footprintSource })
}

export function activateRoofFootprintSource(footprintSource: RoofFootprintSource): void {
  const editor = useEditor.getState()
  if (!(editor.mode === 'build' && editor.tool === 'roof')) activateBuildTool('roof')
  editor.setToolDefaults('roof', { ...editor.toolDefaults.roof, footprintSource })
}
