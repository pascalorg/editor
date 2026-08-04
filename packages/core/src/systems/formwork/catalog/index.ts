import { DOKA_FRAMAX_XLIFE } from './doka-framax'
import { PERI_TRIO } from './peri-trio'
import type { FormworkSystem } from './types'

/**
 * The shipped systems. A project picks one and the layout works in its widths,
 * its corners and its tie holes — which is the difference between a drawing that
 * can be ordered off and a drawing of panels that do not exist.
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

export {
  ADJUSTABLE_COLUMN_CLAMPS,
  COLUMN_FORMS,
  columnFormSizeMm,
  columnStackCount,
  DOKA_KS_XLIFE,
  FRAMAX_COLUMN,
} from './columns'
export {
  DOKA_FRAMAX_XLIFE,
  FRAMAX_OUTSIDE_CORNER_PRESSURE_KN_M2,
  FRAMAX_SURFACE_CLASS,
} from './doka-framax'
export { type CornerFit, fitCorner, legLengthM, unfittableCorners } from './junction-fit'
export { PERI_TRIO, TRIO_PRACTICAL_PRESSURE_KN_M2 } from './peri-trio'
export {
  expectedReusesForFilm,
  SAW_KERF_MM,
  SHEET_STOCK,
  SHEET_WASTE_FRACTION,
  STEEL_PANEL_FORMLINING_REUSES,
  STEEL_PANEL_FRAME_REUSES,
  sheetStock,
} from './sheets'
export {
  type CapacityBasis,
  type CatalogEntry,
  type ColumnClampType,
  type ColumnFormType,
  type CornerLegSpec,
  type CornerType,
  clampForSizeMm,
  cornerForAngle,
  cornerLegsMm,
  type FillerType,
  type FormworkSystem,
  fillerForGap,
  type PanelType,
  type PermissiblePressure,
  panelHeightsMm,
  panelWidthsMm,
  permissiblePressureKnM2,
  type SheetStock,
  type TieHoleGrid,
  type TieType,
  type Verification,
} from './types'
