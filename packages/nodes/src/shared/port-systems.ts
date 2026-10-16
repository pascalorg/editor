/** Air-loop port systems — what duct runs and fittings snap to. */
export const DUCT_PORT_SYSTEMS = ['supply', 'return'] as const
/** DWV port systems — what drain / waste / vent pipe runs snap to. */
export const DWV_PORT_SYSTEMS = ['waste', 'vent'] as const
/** Refrigerant-loop port system — what linesets snap to. */
export const REFRIGERANT_PORT_SYSTEMS = ['refrigerant'] as const

/** Half a run's section, in metres, from its nominal size in inches: how far its centerline sits off a support. */
export function runSectionHalfSizeM(nominalInches: number): number {
  return (nominalInches * 0.0254) / 2
}
