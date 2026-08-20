// Pure data: one KindDef per built-in measurement kind. The per-kind exports
// below are monorepo-internal (there is no `./units` npm subpath) — external
// consumers reach this data through `allKinds` on the main entry or the
// read-only `./catalog` queries.
import type { Kind, KindDef } from '../core/types'
import { acceleration } from './acceleration'
import { angle } from './angle'
import { area } from './area'
import { charge } from './charge'
import { concentration } from './concentration'
import { currency } from './currency'
import { current } from './current'
import { data } from './data'
import { dataRate } from './data-rate'
import { duration } from './duration'
import { energy } from './energy'
import { flowRate } from './flow-rate'
import { force } from './force'
import { frequency } from './frequency'
import { illuminance } from './illuminance'
import { length } from './length'
import { luminance } from './luminance'
import { luminousFlux } from './luminous-flux'
import { luminousIntensity } from './luminous-intensity'
import { mass } from './mass'
import { percent } from './percent'
import { power } from './power'
import { pressure } from './pressure'
import { radiationAbsorbedDose } from './radiation-absorbed-dose'
import { radiationEquivalentDose } from './radiation-equivalent-dose'
import { radioactivity } from './radioactivity'
import { resistance } from './resistance'
import { speed } from './speed'
import { substance } from './substance'
import { temperature } from './temperature'
import { torque } from './torque'
import { voltage } from './voltage'
import { volume } from './volume'

export { acceleration } from './acceleration'
export { angle } from './angle'
export { area } from './area'
export { charge } from './charge'
export { concentration } from './concentration'
export { currency } from './currency'
export { current } from './current'
export { data } from './data'
export { dataRate } from './data-rate'
export { duration } from './duration'
export { energy } from './energy'
export { flowRate } from './flow-rate'
export { force } from './force'
export { frequency } from './frequency'
export { illuminance } from './illuminance'
export { length } from './length'
export { luminance } from './luminance'
export { luminousFlux } from './luminous-flux'
export { luminousIntensity } from './luminous-intensity'
export { mass } from './mass'
export { percent } from './percent'
export { power } from './power'
export { pressure } from './pressure'
export { radiationAbsorbedDose } from './radiation-absorbed-dose'
export { radiationEquivalentDose } from './radiation-equivalent-dose'
export { radioactivity } from './radioactivity'
export { resistance } from './resistance'
export { speed } from './speed'
export { substance } from './substance'
export { temperature } from './temperature'
export { torque } from './torque'
export { voltage } from './voltage'
export { volume } from './volume'

/**
 * Every built-in measurement kind's `KindDef` — what the batteries-included
 * main entry registers by default. Pass a subset to `createRegistry()` for a
 * smaller, tree-shaken bundle.
 * @example
 * ```ts
 * import { allKinds, createRegistry } from '@pascal-app/lingo'
 * // Only length + mass, instead of all built-in kinds:
 * const reg = createRegistry(allKinds.filter((k) => k.kind === 'length' || k.kind === 'mass'))
 * ```
 */
export const allKinds = [
  length,
  mass,
  temperature,
  duration,
  volume,
  area,
  speed,
  data,
  dataRate,
  flowRate,
  acceleration,
  pressure,
  energy,
  force,
  torque,
  power,
  frequency,
  angle,
  percent,
  luminousIntensity,
  luminousFlux,
  illuminance,
  luminance,
  voltage,
  current,
  resistance,
  charge,
  substance,
  concentration,
  radiationAbsorbedDose,
  radiationEquivalentDose,
  radioactivity,
  currency,
] as const satisfies readonly KindDef[]

/**
 * Lowercase kb/mb/gb/tb are deliberately NOT data aliases — they collide with
 * the kilobit family (data.ts keeps kB/KB decimal-byte and Kb/kbit bit-sized).
 * They resolve only through the parser's alias-fallback path, which assumes
 * bytes and attaches an AMBIGUOUS_UNIT issue naming the bit-sized alternative.
 */
export const byteishFallbacks: Record<string, { kind: Kind; unit: string; alt: string }> = {
  kb: { kind: 'data', unit: 'kB', alt: 'kilobits (kbit)' },
  mb: { kind: 'data', unit: 'MB', alt: 'megabits (Mbit)' },
  gb: { kind: 'data', unit: 'GB', alt: 'gigabits (Gbit)' },
  tb: { kind: 'data', unit: 'TB', alt: 'terabits (Tbit)' },
}
