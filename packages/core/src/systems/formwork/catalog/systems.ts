import { DOKA_FRAMAX_XLIFE } from './doka-framax'
import { PERI_TRIO } from './peri-trio'
import type { FormworkSystem } from './types'

/**
 * The shipped systems. A project picks one and the layout works in its widths,
 * its corners and its tie holes — which is the difference between a drawing that
 * can be ordered off and a drawing of panels that do not exist.
 *
 * Its own module rather than the catalog barrel because `stockable.ts` reads it to
 * enumerate every ownable id, and reading it from the barrel would be a cycle: the
 * barrel re-exports `stockable`, so the id list would be built before this record was
 * assigned and every system's parts would silently be missing from it.
 */
export const FORMWORK_SYSTEMS: Record<string, FormworkSystem> = {
  [PERI_TRIO.id]: PERI_TRIO,
  [DOKA_FRAMAX_XLIFE.id]: DOKA_FRAMAX_XLIFE,
}

/**
 * The system assumed when a project has not chosen one. Framax is the verified
 * pair — panels from Doka's own item list, pressures from its User Information —
 * where TRIO's figures came off dealer listings, so it is the safer default to
 * quantify against.
 */
export const DEFAULT_FORMWORK_SYSTEM_ID = DOKA_FRAMAX_XLIFE.id

export function formworkSystem(id: string): FormworkSystem | undefined {
  return FORMWORK_SYSTEMS[id]
}
