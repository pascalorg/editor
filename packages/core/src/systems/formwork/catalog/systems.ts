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
    'MIVAN is a contractor-traded aluminium tunnel system with no public item list — the 60 kN/m² figure in circulation is third-party marketing, not a vendor datasheet. Needs an actual product documentation set (panel sizes, weights, rated pressure, tie arrangement) before it can be laid out; none has been transcribed.',
    'No vendor-published catalogue located; third-party literature only',
  ),
  'peri-srs': unseeded(
    'peri-srs',
    'PERI',
    'PERI SRS circular column formwork',
    'SRS is a circular-column system, not a wall panel line: PERI publishes 150 kN/m² fresh concrete pressure for it, and the wall-panel catalog cannot represent a curved panel. Needs a modelling decision (how a column system carries ratings in this registry) before any value can be transcribed.',
    'PERI SRS Circular Column Formwork product data (150 kN/m²)',
  ),
  'peri-quattro': unseeded(
    'peri-quattro',
    'PERI',
    'PERI QUATTRO column formwork',
    'QUATTRO is a column system, not a wall panel line: PERI publishes 80 kN/m² fresh concrete pressure for it. Needs a modelling decision (how a column system carries ratings in this registry) before any value can be transcribed.',
    'PERI QUATTRO Column Formwork product data (80 kN/m²)',
  ),
  'peri-skydeck': unseeded(
    'peri-skydeck',
    'PERI',
    'PERI Skydeck panel slab formwork',
    'Skydeck is a slab-soffit system (panel on drop-head props), not a wall panel line, and this registry lays out walls against a rated pressure. Needs a modelling decision (how a soffit system carries its prop table) before any value can be transcribed.',
    'PERI Skydeck product documentation',
  ),
  'peri-multiflex': unseeded(
    'peri-multiflex',
    'PERI',
    'PERI MULTIFLEX girder slab formwork',
    'MULTIFLEX is a slab-soffit system (beams and props), not a wall panel line, and this registry lays out walls against a rated pressure. Needs a modelling decision (how a soffit system carries its beam/prop tables) before any value can be transcribed.',
    'PERI MULTIFLEX product documentation',
  ),
  'doka-frami': unseeded(
    'doka-frami',
    'Doka',
    'Doka Frami panel system',
    "Frami is Doka's small-area wall/foundation panel line; Doka's own literature permits 40 kN/m² of fresh concrete pressure on it. The panel item list (sizes, weights, article numbers) sits in a Doka PDF that has not been transcribed — the 40 kN/m² alone cannot seed a layout.",
    'Doka Frami product documentation (40 kN/m² permitted pressure)',
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
