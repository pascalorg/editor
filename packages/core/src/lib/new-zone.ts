import type { z } from 'zod'
import { ZoneNode } from '../schema/nodes/zone'
import { zoneColorForSeed } from './zone-colors'

/**
 * A zone being created (never one being loaded): parsed, and given its
 * creation colour (`zoneColorForSeed`) unless the creator chose one.
 */
export function newZone(input: Omit<z.input<typeof ZoneNode>, 'id'> & { id?: string }): ZoneNode {
  const zone = ZoneNode.parse(input)
  return input.color === undefined ? { ...zone, color: zoneColorForSeed(zone.id) } : zone
}
