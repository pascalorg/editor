import { ElevatorNode, normalizeElevatorDimensions } from '@pascal-app/core'

export const ELEVATOR_PRESETS = {
  passenger: {
    label: 'Passenger',
    width: 1.84,
    depth: 1.84,
    cabHeight: 2.35,
    doorWidth: 0.95,
    doorHeight: 2.1,
    shaftStyle: 'solid',
    doorStyle: 'center-opening',
    doorPanelStyle: 'solid-panel',
  },
  service: {
    label: 'Service',
    width: 2.4,
    depth: 3,
    cabHeight: 2.7,
    doorWidth: 1.4,
    doorHeight: 2.4,
    shaftStyle: 'solid',
    doorStyle: 'single-left',
    doorPanelStyle: 'segmented-panel',
  },
  glass: {
    label: 'Glass',
    width: 1.84,
    depth: 1.84,
    cabHeight: 2.35,
    doorWidth: 0.95,
    doorHeight: 2.1,
    shaftStyle: 'glass',
    doorStyle: 'center-opening',
    doorPanelStyle: 'glass-frame',
  },
} as const

export function elevatorPresetPatch(
  node: ElevatorNode,
  id: keyof typeof ELEVATOR_PRESETS,
): Partial<ElevatorNode> {
  const { label: _label, ...preset } = ELEVATOR_PRESETS[id]
  const next = { ...node, ...preset, shaftWidth: undefined, shaftDepth: undefined }
  return { ...preset, ...normalizeElevatorDimensions(next) }
}

export const ELEVATOR_SECTION_FIELDS: Record<string, readonly (keyof ElevatorNode)[]> = {
  Cab: ['width', 'depth', 'cabHeight'],
  Shaft: ['shaftWidth', 'shaftDepth', 'shaftStyle', 'shaftWallThickness'],
  Doors: ['doorWidth', 'doorHeight', 'doorStyle', 'doorPanelStyle'],
  Motion: ['speed', 'doorDurationMs', 'dwellMs'],
}

export function elevatorSectionReset(node: ElevatorNode, section: string) {
  const defaults = ElevatorNode.parse({})
  const patch = Object.fromEntries(
    (ELEVATOR_SECTION_FIELDS[section] ?? []).map((key) => [key, defaults[key]]),
  )
  return { ...patch, ...normalizeElevatorDimensions({ ...node, ...patch }) }
}
