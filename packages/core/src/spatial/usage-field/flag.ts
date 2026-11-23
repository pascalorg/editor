let enabled = false

/**
 * Usage checks (passages, turning circles, pockets, wall objects, measured flow) are off until a
 * host turns them on. Core reads no environment: the app and the servers set this once at start,
 * from `PASCAL_SDF_CHECKS`.
 */
export function setSdfChecks(on: boolean): void {
  enabled = on
}

export const sdfChecksOn = (): boolean => enabled

/** What `PASCAL_SDF_CHECKS` (or its `NEXT_PUBLIC_` mirror) says: `1` or `true` turns the checks on, anything else, or nothing, leaves them off. */
export const sdfChecksFromEnv = (value: string | undefined): boolean =>
  value === '1' || value?.toLowerCase() === 'true'
