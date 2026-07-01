import type { CabinetNode } from '@pascal-app/core'

export const CABINET_COMPARTMENT_TYPES = ['shelf', 'drawer', 'door'] as const
export type CabinetCompartmentType = (typeof CABINET_COMPARTMENT_TYPES)[number]

export const CABINET_DOOR_TYPES = ['single-left', 'single-right', 'double', 'glass'] as const
export type CabinetDoorType = (typeof CABINET_DOOR_TYPES)[number]

export type CabinetCompartment = NonNullable<CabinetNode['stack']>[number]

let compartmentIdCounter = 0
const DEFAULT_SHELF_COUNT = 2

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
  return { id: makeId(), type: 'door' }
}

export function defaultCabinetStack(node: Pick<CabinetNode, 'width'>): CabinetCompartment[] {
  return [
    {
      id: makeId(),
      type: 'door',
      doorType: defaultDoorType(node.width),
      shelfCount: 1,
    },
  ]
}

export function stackForCabinet(node: Pick<CabinetNode, 'width' | 'stack'>): CabinetCompartment[] {
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

export function normalizeCabinetStack(
  node: Pick<CabinetNode, 'carcassHeight' | 'stack' | 'width'>,
): Array<{ compartment: CabinetCompartment; index: number; height: number; y0: number; y1: number }> {
  const stack = stackForCabinet(node)
  if (stack.length === 0) return []
  const fixed = stack.map((compartment) =>
    typeof compartment.height === 'number' && compartment.height > 0 ? compartment.height : null,
  )
  const fixedSum = fixed.reduce<number>((sum, height) => sum + (height ?? 0), 0)
  const freeCount = fixed.filter((height) => height == null).length
  const remainder = Math.max(0, node.carcassHeight - fixedSum)
  const freeHeight = freeCount > 0 ? remainder / freeCount : 0
  let y0 = 0
  return stack.map((compartment, index) => {
    const isLast = index === stack.length - 1
    let height = fixed[index] ?? freeHeight
    if (isLast) height = Math.max(0.001, node.carcassHeight - y0)
    const y1 = y0 + height
    const row = { compartment, index, height, y0, y1 }
    y0 = y1
    return row
  })
}
