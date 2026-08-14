import { DOKA_FRAMAX_XLIFE } from './doka-framax'
import { PERI_TRIO } from './peri-trio'
import type { FormworkSystem, RegisteredFormworkSystem, UnseededFormworkSystem } from './types'

/**
 * The registered-but-unseeded systems, one per product family the proposal names.
 *
 * Each is registered so a project stating it gets a named refusal rather than a
 * silent fallback to cut ply, and nothing more — the design values have to come off
 * the cited datasheet, and none has been bought or transcribed yet. Seeding any of
 * these is `tasks.md` group 4's remaining items, and the reason text is the receipt
 * for what each needs.
 */
const UNSEEDED_SYSTEMS: Record<string, UnseededFormworkSystem> = {
  'mivan-generic': unseeded(
    'mivan-generic',
    'Mivan',
    'MIVAN aluminium panel system',
    'Needs the MIVAN aluminium formwork datasheet — panel sizes, weights, rated pressure and tie arrangement — before it can be laid out. None has been transcribed.',
    'MIVAN aluminium formwork product documentation',
  ),
  'peri-srs': unseeded(
    'peri-srs',
    'PERI',
    'PERI SRS shoring system',
    'Needs the PERI SRS brochure — panel sizes, weights, rated pressure and tie arrangement — before it can be laid out. None has been transcribed.',
    'PERI SRS product brochure',
  ),
  'peri-quattro': unseeded(
    'peri-quattro',
    'PERI',
    'PERI QUATTRO panel system',
    'Needs the PERI QUATTRO brochure — panel sizes, weights, rated pressure and tie arrangement — before it can be laid out. None has been transcribed.',
    'PERI QUATTRO product brochure',
  ),
  'peri-skydeck': unseeded(
    'peri-skydeck',
    'PERI',
    'PERI Skydeck panel slab formwork',
    'Needs the PERI Skydeck brochure — panel sizes, weights, rated pressure and tie arrangement — before it can be laid out. None has been transcribed.',
    'PERI Skydeck product brochure',
  ),
  'peri-multiflex': unseeded(
    'peri-multiflex',
    'PERI',
    'PERI MULTIFLEX girder slab formwork',
    'Needs the PERI MULTIFLEX brochure — beam and panel data — before it can be laid out. None has been transcribed.',
    'PERI MULTIFLEX product brochure',
  ),
  'doka-frami': unseeded(
    'doka-frami',
    'Doka',
    'Doka Frami panel system',
    'Needs the Doka Frami datasheet — panel sizes, weights, rated pressure and tie arrangement — before it can be laid out. None has been transcribed.',
    'Doka Frami product documentation',
  ),
}

function unseeded(
  id: string,
  manufacturer: string,
  label: string,
  unseededReason: string,
  sourceRef: string,
): UnseededFormworkSystem {
  return {
    id,
    manufacturer,
    label,
    seeded: false,
    unseededReason,
    verification: 'unverified',
    sourceRef,
  }
}

/**
 * The shipped systems. A project picks one and the layout works in its widths,
 * its corners and its tie holes — which is the difference between a drawing that
 * can be ordered off and a drawing of panels that do not exist.
 *
 * The registry carries more than the two seeded systems. Every id here names a
 * real product a project could state, and a stated id that resolves to nothing
 * is the failure where the design chain silently falls back to a default — so the
 * systems whose datasheets have not been transcribed yet are registered too,
 * seeded: false, and every design path refuses one rather than approximating it.
 *
 * Its own module rather than the catalog barrel because `stockable.ts` reads it to
 * enumerate every ownable id, and reading it from the barrel would be a cycle: the
 * barrel re-exports `stockable`, so the id list would be built before this record was
 * assigned and every system's parts would silently be missing from it.
 */
export const FORMWORK_SYSTEMS: Record<string, RegisteredFormworkSystem> = {
  [PERI_TRIO.id]: PERI_TRIO,
  [DOKA_FRAMAX_XLIFE.id]: DOKA_FRAMAX_XLIFE,
  ...UNSEEDED_SYSTEMS,
}

/**
 * The system assumed when a project has not chosen one. Framax is the verified
 * pair — panels from Doka's own item list, pressures from its User Information —
 * where TRIO's figures came off dealer listings, so it is the safer default to
 * quantify against.
 */
export const DEFAULT_FORMWORK_SYSTEM_ID = DOKA_FRAMAX_XLIFE.id

/** Any registered system, seeded or not. `undefined` only for an id that is not registered. */
export function formworkSystem(id: string): RegisteredFormworkSystem | undefined {
  return FORMWORK_SYSTEMS[id]
}

/**
 * A system with data to design against, or `undefined` where the id is unregistered
 * or names an unseeded entry.
 *
 * The layout paths resolve through this rather than through `formworkSystem`, so an
 * unseeded id can never be drawn as a conventional shutter by accident — it falls to
 * the caller's refusal path instead, which is the whole difference `seeded` exists
 * to draw. See `UnseededFormworkSystem`.
 */
export function seededFormworkSystem(id: string): FormworkSystem | undefined {
  const entry = FORMWORK_SYSTEMS[id]
  return entry?.seeded ? entry : undefined
}
