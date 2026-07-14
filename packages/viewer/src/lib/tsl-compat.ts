import * as TSL from 'three/tsl'

/**
 * three runs at 0.185 but @types/three is pinned at 0.184: the 0.185 typings
 * make tsgo's type inference allocate unboundedly (microsoft/typescript-go
 * #2125 class) and OOM the machine. r185 renamed directionToColor /
 * colorToDirection to packNormalToRGB / unpackRGBToNormal — re-export the new
 * runtime names under the old names' signatures. Delete this file (and the
 * @types/three pin) once tsgo handles the 0.185 types; the `typeof` references
 * to the removed old names will fail the build as a reminder.
 */
export const packNormalToRGB = (TSL as unknown as { packNormalToRGB: typeof TSL.directionToColor })
  .packNormalToRGB
export const unpackRGBToNormal = (
  TSL as unknown as { unpackRGBToNormal: typeof TSL.colorToDirection }
).unpackRGBToNormal
