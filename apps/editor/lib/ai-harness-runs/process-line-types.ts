import type { Vec3 } from '@pascal-app/core/lib/primitive-compose'

export type ProcessLineDomain =
  | 'chemical'
  | 'energy'
  | 'food'
  | 'assembly'
  | 'logistics'
  | 'metallurgy'
  | 'generic'

export type ProcessLineLayoutStyle = 'linear' | 'u_shape' | 'cell' | 'parallel_bays'

export type ProcessLineFootprintHint = 'small' | 'medium' | 'large' | 'long' | 'tall'

export type ProcessConnectionMedium =
  | 'water'
  | 'hydrogen'
  | 'oxygen'
  | 'power'
  | 'cooling'
  | 'material'
  | 'gas'
  | 'molten_metal'

export type ProcessConnectionVisualKind =
  | 'pipe'
  | 'cable_tray'
  | 'flow_arrow'
  | 'material_conveyor'
  | 'hot_material_chute'
  | 'air_duct'
  | 'hot_gas_duct'

export type ProcessEquipmentEnvelope = {
  length: number
  width: number
  height: number
  origin: 'station_profile' | 'user' | 'vendor_profile'
  tolerance?: number
}

export type ProcessEquipmentPortSide = 'left' | 'right' | 'front' | 'back' | 'top'

export type ProcessEquipmentPort = {
  id: string
  medium: ProcessConnectionMedium
  side: ProcessEquipmentPortSide
  height: number
  offset?: number
  direction?: Vec3
}

export type ProcessEquipmentContract = {
  profileId: string
  equipmentFamily: string
  scaleClass: string
  envelope: ProcessEquipmentEnvelope
  ports: ProcessEquipmentPort[]
  requiredRoles?: string[]
  preferredTool?: 'compose_parts' | 'compose_assembly'
  preferredResolver?: 'catalog-item' | 'native-box' | 'native-tank' | 'primitive' | 'profile-parts'
  profileParts?: Record<string, unknown>[]
  primarySemanticRole?: string
}

export type ProcessStationPlan = {
  id: string
  label: string
  displayLabel?: string
  role: string
  equipmentHint: string
  footprintHint?: ProcessLineFootprintHint
  safetyTags?: string[]
}

export type ProcessConnectionPlan = {
  fromStationId: string
  toStationId: string
  medium?: ProcessConnectionMedium
  visualKind: ProcessConnectionVisualKind
  fromPortId?: string
  toPortId?: string
}

export type ProcessLinePlan = {
  processId?: string
  processLabel: string
  processDisplayLabel?: string
  architecture?: {
    id: string
    label?: string
    scopeId?: string
    scopeLabel?: string
    moduleIds?: string[]
    keyFocusStationIds?: string[]
    zoneDisplay?: 'subtle' | 'debug'
    omitPerimeterWalls?: boolean
  }
  sourcePack?: {
    id: string
    version: string
    industry: string
  }
  domain: ProcessLineDomain
  layoutStyle: ProcessLineLayoutStyle
  dimensions?: { length?: number; width?: number }
  stations: ProcessStationPlan[]
  connections: ProcessConnectionPlan[]
  safetyTags?: string[]
}

export type ProcessStationClearance = {
  left: number
  right: number
  front: number
  back: number
}

export type ProcessStationClearanceBox = {
  minX: number
  maxX: number
  minZ: number
  maxZ: number
}

export type StationPlacement = {
  stationId: string
  role: string
  label: string
  displayLabel?: string
  position: Vec3
  rotation: Vec3
  footprint: { length: number; width: number }
  clearance: ProcessStationClearance
  clearanceBox: ProcessStationClearanceBox
}

export type ProcessPrimitiveRequest = {
  station: ProcessStationPlan
  placement: StationPlacement
  prompt: string
  metadata: Record<string, unknown>
  equipmentContract?: ProcessEquipmentContract
}

export type ProcessLayoutDiagnosticSeverity = 'info' | 'warning' | 'error'

export type ProcessLayoutDiagnostic = {
  code: string
  message: string
  severity: ProcessLayoutDiagnosticSeverity
  stationId?: string
  relatedStationId?: string
  connectionIndex?: number
}

export type ProcessLayoutDiagnostics = {
  fits: boolean
  boundary: { length: number; width: number }
  diagnostics: ProcessLayoutDiagnostic[]
}

export type ProcessLayoutStrategy = {
  style: ProcessLineLayoutStyle
  repaired: boolean
  reason?: string
}

export type ProcessLineFocusBounds = {
  min: [number, number]
  max: [number, number]
  center: [number, number]
  size: [number, number]
  stationIds: string[]
  reason: 'factory-key-process' | 'process-line'
}

export type FactoryRouteObstacleMetadata = {
  stationId: string
  source: 'layout' | 'artifact' | 'native' | 'catalog' | 'profile-parts'
  minHeight?: number
  maxHeight?: number
  box: ProcessStationClearanceBox
}
