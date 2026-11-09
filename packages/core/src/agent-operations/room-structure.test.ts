import { expect, test } from 'bun:test'
import { z } from 'zod'
import { setFloorFoundationTool, setZoneIntentTool } from '../agent-tools/room-structure'
import { FloorFoundationPatch, ZoneIntentPatch } from '../commands/structure'

// The tools' patches are what agents may send, tuple-free; the commands validate them again with
// the node schemas. A field one has and the other lacks is refused or never offered.
function fields(schema: z.ZodType, path = ''): string[] {
  let inner: z.ZodType = schema
  while (inner instanceof z.ZodOptional || inner instanceof z.ZodNullable)
    inner = inner.unwrap() as z.ZodType
  if (!(inner instanceof z.ZodObject)) return []
  return Object.entries(inner.shape as Record<string, z.ZodType>)
    .flatMap(([key, value]) => [`${path}${key}`, ...fields(value, `${path}${key}.`)])
    .sort()
}

test('the room tools offer every field their commands take, and no other', () => {
  expect(fields(setZoneIntentTool.input.patch)).toEqual(fields(ZoneIntentPatch))
  expect(fields(setFloorFoundationTool.input.patch)).toEqual(fields(FloorFoundationPatch))
})
