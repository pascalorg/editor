export const ROOF_ELEMENT_KINDS = [
  'chimney',
  'skylight',
  'solar-panel',
  'cupola',
  'box-vent',
  'ridge-vent',
  'turbine-vent',
  'eyebrow-vent',
] as const

export type RoofElementKind = (typeof ROOF_ELEMENT_KINDS)[number]
