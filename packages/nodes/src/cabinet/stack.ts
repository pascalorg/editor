import type { CabinetModuleNode, CabinetNode } from '@pascal-app/core'

type CabinetStackOwner = CabinetNode | CabinetModuleNode

export const CABINET_COMPARTMENT_TYPES = ['shelf', 'drawer', 'door', 'oven', 'microwave'] as const
export type CabinetCompartmentType = (typeof CABINET_COMPARTMENT_TYPES)[number]

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

function makeId() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return `cc_${crypto.randomUUID().slice(0, 8)}`
  }
  return `cc_${(compartmentIdCounter++).toString(36)}`
}

export function defaultDoorType(width: number): CabinetDoorType {
  return width > 0.5 ? 'double' : 'single-left'
}

export function newCabinetCompartment(type: CabinetCompartmentType): CabinetCompartment {
  if (type === 'drawer') return { id: makeId(), type: 'drawer', drawerCount: 1 }
  if (type === 'shelf') return { id: makeId(), type: 'shelf', shelfCount: 1 }
  if (type === 'oven') return { id: makeId(), type: 'oven', height: OVEN_DEFAULT_HEIGHT }
  if (type === 'microwave')
    return { id: makeId(), type: 'microwave', height: MICROWAVE_DEFAULT_HEIGHT }
  return { id: makeId(), type: 'door' }
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
  return typeof compartment.drawerCount === 'number' && compartment.drawerCount > 0
    ? Math.max(1, Math.min(6, Math.floor(compartment.drawerCount)))
    : 2
}

export function compartmentShelfCount(compartment: CabinetCompartment): number {
  return typeof compartment.shelfCount === 'number'
    ? Math.max(0, Math.min(8, Math.floor(compartment.shelfCount)))
    : DEFAULT_SHELF_COUNT
}

export function compartmentDoorType(
  compartment: CabinetCompartment,
  width: number,
): CabinetDoorType {
  return compartment.doorType ?? defaultDoorType(width)
}

function explicitCompartmentHeight(compartment: CabinetCompartment): number | null {
  return typeof compartment.height === 'number' && compartment.height > 0
    ? compartment.height
    : null
}

function lockedApplianceHeight(compartment: CabinetCompartment): number | null {
  if (compartment.type !== 'oven' && compartment.type !== 'microwave') return null
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

export function reflowCabinetRunModules<T extends Pick<CabinetModuleNode, 'id' | 'position' | 'width'>>(
  modules: T[],
  selectedId: CabinetModuleNode['id'],
  selectedWidth: number,
): Array<{ id: T['id']; position: T['position']; width: number }> {
  const sorted = [...modules].sort((a, b) => a.position[0] - b.position[0])
  if (!sorted.some((module) => module.id === selectedId)) return []

  let nextLeft = Math.min(...sorted.map((module) => module.position[0] - module.width / 2))
  return sorted.map((module) => {
    const width = module.id === selectedId ? selectedWidth : module.width
    const position: T['position'] = [
      nextLeft + width / 2,
      module.position[1],
      module.position[2],
    ] as T['position']
    nextLeft += width
    return { id: module.id, position, width }
  })
}
