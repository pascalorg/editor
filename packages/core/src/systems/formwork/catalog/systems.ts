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
    { walls: true, columns: false, slabs: true, beams: true },
    'MIVAN is a contractor-traded aluminium tunnel system with no public item list — the 60 kN/m² figure in circulation is third-party marketing, not a vendor datasheet. Needs an actual product documentation set (panel sizes, weights, rated pressure, tie arrangement) before it can be laid out; none has been transcribed.',
    'No vendor-published catalogue located; third-party literature only',
  ),
  'peri-srs': unseeded(
    'peri-srs',
    'PERI',
    'PERI SRS circular column formwork',
    { walls: false, columns: true, slabs: false, beams: false },
    'SRS is a circular-column system, not a wall panel line: PERI publishes 150 kN/m² fresh concrete pressure for it, and the wall-panel catalog cannot represent a curved panel. The capability decision (a system declares what it forms) is recorded; the curved-panel geometry is a follow-on change before any value can be transcribed.',
    'PERI SRS Circular Column Formwork product data (150 kN/m²)',
  ),
  'peri-quattro': unseeded(
    'peri-quattro',
    'PERI',
    'PERI QUATTRO column formwork',
    { walls: false, columns: true, slabs: false, beams: false },
    'QUATTRO is a column system, not a wall panel line: PERI publishes 80 kN/m² fresh concrete pressure for it. The capability decision (a system declares what it forms) is recorded; seeding it needs the column rating transcribed with citation.',
    'PERI QUATTRO Column Formwork product data (80 kN/m²)',
  ),
  'peri-skydeck': unseeded(
    'peri-skydeck',
    'PERI',
    'PERI Skydeck panel slab formwork',
    { walls: false, columns: false, slabs: true, beams: false },
    'Skydeck is a slab-soffit system (panel on drop-head props), not a wall panel line, and this registry lays out walls against a rated pressure. Needs the soffit capacity shape (the beam/prop table a soffit design needs) before any value can be transcribed.',
    'PERI Skydeck product documentation',
  ),
  'peri-multiflex': unseeded(
    'peri-multiflex',
    'PERI',
    'PERI MULTIFLEX girder slab formwork',
    { walls: false, columns: false, slabs: true, beams: false },
    'MULTIFLEX is a slab-soffit system (beams and props), not a wall panel line, and this registry lays out walls against a rated pressure. Needs the soffit capacity shape (the beam/prop table a soffit design needs) before any value can be transcribed.',
    'PERI MULTIFLEX product documentation',
  ),
  'doka-frami': unseeded(
    'doka-frami',
    'Doka',
    'Doka Frami panel system',
    { walls: true, columns: true, slabs: false, beams: true },
    "Frami is Doka's small-area wall/foundation panel line; Doka's own literature permits 40 kN/m² of fresh concrete pressure on it, with a 0.75 m grid at 0.60/1.20/1.50 m heights. The panel item list (weights, article numbers) sits in the Doka Frami Xlife item list 189962 (direct.doka.com/_ext/downloads/itemlists/en/189962.pdf — a PDF that must be read in hand before transcription, because regular and universal panels share nominal sizes at different weights). The pressure and grid alone cannot seed a layout.",
    'Doka Frami Xlife item list 189962 (direct.doka.com) — 40 kN/m² permitted pressure, 0.75 m tie grid; the panel item table awaits transcription from the PDF',
  ),
}

function unseeded(
  id: string,
  manufacturer: string,
  label: string,
  supports: { walls: boolean; columns: boolean; slabs: boolean; beams: boolean },
  unseededReason: string,
  sourceRef: string,
): UnseededFormworkSystem {
  return {
    id,
    manufacturer,
    label,
    seeded: false,
    supports,
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
