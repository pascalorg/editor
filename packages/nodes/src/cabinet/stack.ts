import type { CabinetModuleNode, CabinetNode } from '@pascal-app/core'

type CabinetStackOwner = CabinetNode | CabinetModuleNode

export const CABINET_COMPARTMENT_TYPES = [
  'shelf',
  'drawer',
  'door',
  'oven',
  'microwave',
  'dishwasher',
  'cooktop-gas',
  'cooktop-induction',
  'pull-out-pantry',
  'fridge-single',
  'fridge-double',
  'fridge-top-freezer',
  'fridge-bottom-freezer',
  'hood-pyramid',
  'hood-curved-glass',
] as const
export type CabinetCompartmentType = (typeof CABINET_COMPARTMENT_TYPES)[number]
export type CabinetFridgeCompartmentType = Extract<
  CabinetCompartmentType,
  'fridge-single' | 'fridge-double' | 'fridge-top-freezer' | 'fridge-bottom-freezer'
>
export type CabinetHoodCompartmentType = Extract<
  CabinetCompartmentType,
  'hood-pyramid' | 'hood-curved-glass'
>
export type CabinetCooktopCompartmentType = Extract<
  CabinetCompartmentType,
  'cooktop-gas' | 'cooktop-induction'
>
export const COOKTOP_LAYOUTS = [
  'gas-2burner',
  'gas-4burner',
  'gas-5burner-wok',
  'gas-6burner',
  'induction-2zone',
  'induction-4zone',
] as const
export type CooktopLayout = (typeof COOKTOP_LAYOUTS)[number]
export const PULL_OUT_PANTRY_RACK_STYLES = ['wire', 'tray', 'glass'] as const
export type PullOutPantryRackStyle = (typeof PULL_OUT_PANTRY_RACK_STYLES)[number]

export const CABINET_DOOR_TYPES = ['single-left', 'single-right', 'double', 'glass'] as const
export type CabinetDoorType = (typeof CABINET_DOOR_TYPES)[number]

export type CabinetCompartment = NonNullable<CabinetStackOwner['stack']>[number]

let compartmentIdCounter = 0
const DEFAULT_SHELF_COUNT = 2
const DEFAULT_MIN_COMPARTMENT_HEIGHT = 0.1

export const OVEN_DEFAULT_HEIGHT = 0.595
export const MICROWAVE_STANDARD_WIDTH = 0.61
export const MICROWAVE_STANDARD_HEIGHT = 0.39
export const MICROWAVE_DEFAULT_HEIGHT = MICROWAVE_STANDARD_HEIGHT
export const DISHWASHER_STANDARD_WIDTH = 0.6
export const DISHWASHER_STANDARD_HEIGHT = 0.72
export const COOKTOP_STANDARD_WIDTH = 0.75
export const COOKTOP_DEFAULT_HEIGHT = 0.08
export const COOKTOP_DEFAULT_GAS_LAYOUT: CooktopLayout = 'gas-5burner-wok'
export const COOKTOP_DEFAULT_INDUCTION_LAYOUT: CooktopLayout = 'induction-4zone'
export const PULL_OUT_PANTRY_STANDARD_WIDTH = 0.3
export const PULL_OUT_PANTRY_DEFAULT_SHELF_COUNT = 5
export const PULL_OUT_PANTRY_DEFAULT_RACK_STYLE: PullOutPantryRackStyle = 'wire'
export const FRIDGE_COLUMN_WIDTH = 0.76
export const FRIDGE_WIDE_WIDTH = 0.91
export const FRIDGE_STANDARD_DEPTH = 0.76
export const FRIDGE_COLUMN_HEIGHT = 1.78
export const TALL_CABINET_CARCASS_HEIGHT = 2.07
export const HOOD_CANOPY_DEPTH = 0.5
export const HOOD_PYRAMID_CANOPY_HEIGHT = 0.38
export const HOOD_CURVED_BODY_HEIGHT = 0.16
export const HOOD_CURVED_TOTAL_HEIGHT = 0.44
export const HOOD_DUCT_SIZE = 0.28
export const DEFAULT_CEILING_HEIGHT = 2.5

export function hoodCompartmentHeight(type: CabinetHoodCompartmentType): number {
  if (type === 'hood-pyramid') return HOOD_PYRAMID_CANOPY_HEIGHT
  return HOOD_CURVED_TOTAL_HEIGHT
}

export function isFridgeCompartmentType(
  type: CabinetCompartmentType,
): type is CabinetFridgeCompartmentType {
  return (
    type === 'fridge-single' ||
    type === 'fridge-double' ||
    type === 'fridge-top-freezer' ||
    type === 'fridge-bottom-freezer'
  )
}

export function isHoodCompartmentType(
  type: CabinetCompartmentType,
): type is CabinetHoodCompartmentType {
  return type === 'hood-pyramid' || type === 'hood-curved-glass'
}

export function isCooktopCompartmentType(
  type: CabinetCompartmentType,
): type is CabinetCooktopCompartmentType {
  return type === 'cooktop-gas' || type === 'cooktop-induction'
}

function makeId() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return `cc_${crypto.randomUUID().slice(0, 8)}`
  }
  return `cc_${(compartmentIdCounter++).toString(36)}`
}

export function defaultDoorType(width: number): CabinetDoorType {
  return width > 0.5 ? 'double' : 'single-left'
}

export function newCabinetCompartment<T extends CabinetCompartmentType>(
  type: T,
): Extract<CabinetCompartment, { type: T }> {
  const build = (): CabinetCompartment => {
    if (type === 'drawer') return { id: makeId(), type: 'drawer', drawerCount: 1 }
    if (type === 'shelf') return { id: makeId(), type: 'shelf', shelfCount: 1 }
    if (type === 'oven') return { id: makeId(), type: 'oven', height: OVEN_DEFAULT_HEIGHT }
    if (type === 'microwave')
      return { id: makeId(), type: 'microwave', height: MICROWAVE_DEFAULT_HEIGHT }
    if (type === 'dishwasher')
      return { id: makeId(), type: 'dishwasher', height: DISHWASHER_STANDARD_HEIGHT }
    if (type === 'cooktop-gas')
      return {
        id: makeId(),
        type: 'cooktop-gas',
        height: COOKTOP_DEFAULT_HEIGHT,
        cooktopLayout: COOKTOP_DEFAULT_GAS_LAYOUT as Extract<CooktopLayout, `gas-${string}`>,
        cooktopBurnersOn: false,
        cooktopActiveBurners: [],
        cooktopKnobProgress: [],
        cooktopShowGrate: true,
      }
    if (type === 'cooktop-induction')
      return {
        id: makeId(),
        type: 'cooktop-induction',
        height: COOKTOP_DEFAULT_HEIGHT,
        cooktopLayout: COOKTOP_DEFAULT_INDUCTION_LAYOUT as Extract<
          CooktopLayout,
          `induction-${string}`
        >,
        cooktopBurnersOn: false,
        cooktopActiveBurners: [],
        cooktopKnobProgress: [],
        cooktopShowGrate: true,
      }
    if (type === 'pull-out-pantry')
      return {
        id: makeId(),
        type: 'pull-out-pantry',
        height: TALL_CABINET_CARCASS_HEIGHT,
        shelfCount: PULL_OUT_PANTRY_DEFAULT_SHELF_COUNT,
        pantryRackStyle: PULL_OUT_PANTRY_DEFAULT_RACK_STYLE,
      }
    if (isFridgeCompartmentType(type as CabinetCompartmentType))
      return {
        id: makeId(),
        type: type as CabinetFridgeCompartmentType,
        height: FRIDGE_COLUMN_HEIGHT,
      }
    if (isHoodCompartmentType(type as CabinetCompartmentType)) {
      const hood = type as CabinetHoodCompartmentType
      return { id: makeId(), type: hood, height: hoodCompartmentHeight(hood) }
    }
    return { id: makeId(), type: 'door' }
  }
  return build() as Extract<CabinetCompartment, { type: T }>
}

export function fridgeCabinetStack(type: CabinetFridgeCompartmentType): CabinetCompartment[] {
  return [newCabinetCompartment(type), { ...newCabinetCompartment('drawer'), drawerCount: 1 }]
}

export function cooktopCabinetStack(type: CabinetCooktopCompartmentType): CabinetCompartment[] {
  return [{ ...newCabinetCompartment('drawer'), drawerCount: 2 }, newCabinetCompartment(type)]
}

/**
 * Read an optional field off the compartment union without narrowing. The
 * `compartment*` accessors below are deliberately defensive — they accept any
 * compartment (saved scenes may carry stale fields from before the
 * discriminated union) and validate what they find.
 */
function loose<T>(compartment: CabinetCompartment, key: string): T | undefined {
  return (compartment as Record<string, unknown>)[key] as T | undefined
}

/** Union of every field any compartment variant can carry. */
type AnyCompartmentFields = Partial<{
  type: CabinetCompartmentType
  height: number
  doorType: CabinetDoorType
  drawerCount: number
  shelfCount: number
  pantryRackStyle: PullOutPantryRackStyle
  cooktopLayout: CooktopLayout
  cooktopBurnersOn: boolean
  cooktopShowGrate: boolean
  cooktopActiveBurners: number[]
  cooktopKnobProgress: number[]
}>

/**
 * Spread-with-override for the compartment union. Callers patch fields that
 * are valid for the compartment's actual variant (the UI only offers
 * variant-appropriate controls); the cast is contained here so every call
 * site stays clean under the discriminated union.
 */
export function patchCompartment(
  compartment: CabinetCompartment,
  patch: AnyCompartmentFields,
): CabinetCompartment {
  return { ...compartment, ...patch } as CabinetCompartment
}

export function defaultCabinetStack(node: Pick<CabinetStackOwner, 'width'>): CabinetCompartment[] {
  return [
    {
      id: makeId(),
      type: 'door',
      doorType: defaultDoorType(node.width),
      shelfCount: 1,
    },
  ]
}

export function stackForCabinet(
  node: Pick<CabinetStackOwner, 'width' | 'stack'>,
): CabinetCompartment[] {
  if (Array.isArray(node.stack) && node.stack.length > 0) return node.stack
  return defaultCabinetStack(node)
}

export function compartmentDrawerCount(compartment: CabinetCompartment): number {
  const drawerCount = loose<number>(compartment, 'drawerCount')
  return typeof drawerCount === 'number' && drawerCount > 0
    ? Math.max(1, Math.min(6, Math.floor(drawerCount)))
    : 2
}

export function compartmentShelfCount(compartment: CabinetCompartment): number {
  const shelfCount = loose<number>(compartment, 'shelfCount')
  return typeof shelfCount === 'number'
    ? Math.max(0, Math.min(8, Math.floor(shelfCount)))
    : DEFAULT_SHELF_COUNT
}

export function compartmentPullOutPantryRackStyle(
  compartment: CabinetCompartment,
): PullOutPantryRackStyle {
  const style = loose<PullOutPantryRackStyle>(compartment, 'pantryRackStyle')
  return style && PULL_OUT_PANTRY_RACK_STYLES.includes(style)
    ? style
    : PULL_OUT_PANTRY_DEFAULT_RACK_STYLE
}

export function compartmentCooktopLayout(
  compartment: CabinetCompartment,
  type: CabinetCooktopCompartmentType,
): CooktopLayout {
  const layout = loose<CooktopLayout>(compartment, 'cooktopLayout') as CooktopLayout
  const allowedPrefix = type === 'cooktop-gas' ? 'gas-' : 'induction-'
  return COOKTOP_LAYOUTS.includes(layout) && layout.startsWith(allowedPrefix)
    ? layout
    : type === 'cooktop-gas'
      ? COOKTOP_DEFAULT_GAS_LAYOUT
      : COOKTOP_DEFAULT_INDUCTION_LAYOUT
}

export function cooktopLayoutElementCount(layout: CooktopLayout): number {
  switch (layout) {
    case 'gas-2burner':
    case 'induction-2zone':
      return 2
    case 'gas-6burner':
      return 6
    case 'gas-5burner-wok':
      return 5
    default:
      return 4
  }
}

export function compartmentCooktopElementCount(
  compartment: CabinetCompartment,
  type: CabinetCooktopCompartmentType,
): number {
  return cooktopLayoutElementCount(compartmentCooktopLayout(compartment, type))
}

export function compartmentCooktopBurnersOn(compartment: CabinetCompartment): boolean {
  const activeBurners = loose<number[]>(compartment, 'cooktopActiveBurners')
  if (Array.isArray(activeBurners)) {
    return activeBurners.length > 0
  }
  return loose<boolean>(compartment, 'cooktopBurnersOn') === true
}

export function compartmentCooktopActiveBurners(
  compartment: CabinetCompartment,
  type: CabinetCooktopCompartmentType,
): number[] {
  const count = compartmentCooktopElementCount(compartment, type)
  const activeBurners = loose<number[]>(compartment, 'cooktopActiveBurners')
  if (Array.isArray(activeBurners)) {
    return [
      ...new Set(
        activeBurners.filter((index) => Number.isInteger(index) && index >= 0 && index < count),
      ),
    ].sort((a, b) => a - b)
  }
  return loose<boolean>(compartment, 'cooktopBurnersOn') === true
    ? Array.from({ length: count }, (_, index) => index)
    : []
}

export function compartmentCooktopKnobProgress(
  compartment: CabinetCompartment,
  type: CabinetCooktopCompartmentType,
): number[] {
  const count = compartmentCooktopElementCount(compartment, type)
  const active = new Set(compartmentCooktopActiveBurners(compartment, type))
  const knobProgress = loose<number[]>(compartment, 'cooktopKnobProgress')
  return Array.from({ length: count }, (_, index) => {
    const value = knobProgress?.[index]
    return typeof value === 'number' && Number.isFinite(value)
      ? Math.max(0, Math.min(1, value))
      : active.has(index)
        ? 1
        : 0
  })
}

export function compartmentCooktopShowGrate(compartment: CabinetCompartment): boolean {
  return loose<boolean>(compartment, 'cooktopShowGrate') !== false
}

export function compartmentDoorType(
  compartment: CabinetCompartment,
  width: number,
): CabinetDoorType {
  return loose<CabinetDoorType>(compartment, 'doorType') ?? defaultDoorType(width)
}

function explicitCompartmentHeight(compartment: CabinetCompartment): number | null {
  if (isCooktopCompartmentType(compartment.type)) return 0
  return typeof compartment.height === 'number' && compartment.height > 0
    ? compartment.height
    : null
}

function lockedApplianceHeight(compartment: CabinetCompartment): number | null {
  if (
    compartment.type !== 'oven' &&
    compartment.type !== 'microwave' &&
    compartment.type !== 'dishwasher' &&
    !isCooktopCompartmentType(compartment.type) &&
    compartment.type !== 'pull-out-pantry' &&
    !isFridgeCompartmentType(compartment.type) &&
    !isHoodCompartmentType(compartment.type)
  )
    return null
  return explicitCompartmentHeight(compartment)
}

export function minCabinetCarcassHeightForStack(
  node: Pick<CabinetStackOwner, 'stack' | 'width'>,
  minHeight = DEFAULT_MIN_COMPARTMENT_HEIGHT,
): number {
  const stack = stackForCabinet(node)
  return stack.reduce(
    (sum, compartment) => sum + (lockedApplianceHeight(compartment) ?? minHeight),
    0,
  )
}

export function replaceCabinetCompartmentStack(
  node: Pick<CabinetStackOwner, 'carcassHeight' | 'stack' | 'width'>,
  index: number,
  next: CabinetCompartment,
  fillerType: Extract<CabinetCompartmentType, 'drawer' | 'door' | 'shelf'> = 'drawer',
  minHeight = DEFAULT_MIN_COMPARTMENT_HEIGHT,
): CabinetCompartment[] {
  const stack = stackForCabinet(node)
  if (index < 0 || index >= stack.length) return stack

  const replaced = stack.map((compartment, compartmentIndex) =>
    compartmentIndex === index ? next : compartment,
  )
  if (lockedApplianceHeight(next) == null) return replaced
  if (isHoodCompartmentType(next.type)) return replaced
  if (next.type === 'dishwasher') return replaced
  if (next.type === 'pull-out-pantry') return replaced

  const hasFlexibleSibling = replaced.some(
    (compartment, compartmentIndex) =>
      compartmentIndex !== index && lockedApplianceHeight(compartment) == null,
  )
  if (hasFlexibleSibling) return replaced

  const lockedHeight = replaced.reduce(
    (sum, compartment) => sum + (lockedApplianceHeight(compartment) ?? 0),
    0,
  )
  if (node.carcassHeight - lockedHeight < minHeight) return replaced

  const filler = newCabinetCompartment(fillerType)
  if (isFridgeCompartmentType(next.type)) {
    return [...replaced.slice(0, index + 1), filler, ...replaced.slice(index + 1)]
  }
  return [...replaced.slice(0, index), filler, ...replaced.slice(index)]
}

export function normalizeCabinetStack(
  node: Pick<CabinetStackOwner, 'carcassHeight' | 'stack' | 'width'>,
): Array<{
  compartment: CabinetCompartment
  index: number
  height: number
  y0: number
  y1: number
}> {
  const stack = stackForCabinet(node)
  if (stack.length === 0) return []
  const fixed = stack.map(explicitCompartmentHeight)
  const fixedSum = fixed.reduce<number>((sum, height) => sum + (height ?? 0), 0)
  const freeCount = fixed.filter((height) => height == null).length
  const remainder = Math.max(0, node.carcassHeight - fixedSum)
  const freeHeight = freeCount > 0 ? remainder / freeCount : 0
  let y0 = 0
  return stack.map((compartment, index) => {
    const height = fixed[index] ?? freeHeight
    const y1 = y0 + height
    const row = { compartment, index, height, y0, y1 }
    y0 = y1
    return row
  })
}

export function resizeCabinetCompartmentStack(
  node: Pick<CabinetStackOwner, 'carcassHeight' | 'stack' | 'width'>,
  index: number,
  targetHeight: number,
  minHeight = DEFAULT_MIN_COMPARTMENT_HEIGHT,
): CabinetCompartment[] {
  const stack = stackForCabinet(node)
  if (stack.length === 0 || index < 0 || index >= stack.length) return stack
  if (stack.length === 1) {
    const compartment = stack[0]!
    return [
      {
        ...compartment,
        height:
          lockedApplianceHeight(compartment) != null
            ? Math.max(minHeight, Math.min(targetHeight, node.carcassHeight))
            : node.carcassHeight,
      },
    ]
  }

  const normalized = normalizeCabinetStack({ ...node, stack })
  const otherRows = normalized.filter((row) => row.index !== index)
  const lockedOtherRows = otherRows.filter((row) => lockedApplianceHeight(row.compartment) != null)
  const flexibleOtherRows = otherRows.filter(
    (row) => lockedApplianceHeight(row.compartment) == null,
  )
  const lockedOtherHeight = lockedOtherRows.reduce(
    (sum, row) => sum + (lockedApplianceHeight(row.compartment) ?? 0),
    0,
  )
  const availableForEditedAndFlexibleRows = Math.max(
    minHeight,
    node.carcassHeight - lockedOtherHeight,
  )
  const maxTargetHeight = Math.max(
    minHeight,
    availableForEditedAndFlexibleRows - flexibleOtherRows.length * minHeight,
  )
  const resizedHeight = Math.min(Math.max(targetHeight, minHeight), maxTargetHeight)
  const remainingFreeHeight = Math.max(
    minHeight * flexibleOtherRows.length,
    availableForEditedAndFlexibleRows - resizedHeight,
  )
  const distributableHeight = Math.max(
    0,
    remainingFreeHeight - flexibleOtherRows.length * minHeight,
  )
  const weights = flexibleOtherRows.map((row) => Math.max(0, row.height - minHeight))
  const totalWeight = weights.reduce((sum, weight) => sum + weight, 0)

  const otherHeights = new Map<number, number>()
  let assignedOtherHeight = 0
  lockedOtherRows.forEach((row) => {
    otherHeights.set(row.index, lockedApplianceHeight(row.compartment) ?? minHeight)
  })
  flexibleOtherRows.forEach((row, rowIndex) => {
    const isLastOther = rowIndex === flexibleOtherRows.length - 1
    const height = isLastOther
      ? Math.max(minHeight, remainingFreeHeight - assignedOtherHeight)
      : minHeight +
        (totalWeight > 0
          ? distributableHeight * (weights[rowIndex]! / totalWeight)
          : distributableHeight / Math.max(1, flexibleOtherRows.length))
    assignedOtherHeight += height
    otherHeights.set(row.index, height)
  })

  return stack.map((compartment, compartmentIndex) => ({
    ...compartment,
    height: compartmentIndex === index ? resizedHeight : otherHeights.get(compartmentIndex),
  }))
}

export { reflowRunModules as reflowCabinetRunModules } from './run-layout'

export function backAnchoredModuleZ(currentZ: number, currentDepth: number, nextDepth: number) {
  return currentZ + (nextDepth - currentDepth) / 2
}
