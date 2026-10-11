export type IfcRolePart = { start: number; count: number; role: string }

export function isIfcRolePart(value: unknown): value is IfcRolePart {
  if (!value || typeof value !== 'object') return false
  const part = value as IfcRolePart
  return (
    Number.isInteger(part.start) &&
    part.start >= 0 &&
    part.start % 3 === 0 &&
    Number.isInteger(part.count) &&
    part.count > 0 &&
    part.count % 3 === 0 &&
    typeof part.role === 'string'
  )
}
