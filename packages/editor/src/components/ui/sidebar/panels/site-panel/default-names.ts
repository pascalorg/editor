import type { PascalI18n, RoofType, StairSegmentNode, ZoneNode } from '@pascal-app/core'

/** Names a layer row shows (and its drag preview) until the user renames it. */

export function zoneDefaultName(
  i18n: PascalI18n,
  zone: { spaceRole?: ZoneNode['spaceRole'] } | undefined,
  area: string,
): string {
  return zone?.spaceRole === 'room'
    ? i18n._({ id: 'editor.layers.defaultName.room', message: 'Room ({area})', values: { area } })
    : i18n._({ id: 'editor.layers.defaultName.zone', message: 'Zone ({area})', values: { area } })
}

export function slabDefaultName(i18n: PascalI18n, area: string): string {
  return i18n._({ id: 'editor.layers.defaultName.slab', message: 'Slab ({area})', values: { area } })
}

export function ceilingDefaultName(i18n: PascalI18n, area: string): string {
  return i18n._({
    id: 'editor.layers.defaultName.ceiling',
    message: 'Ceiling ({area})',
    values: { area },
  })
}

export function roofDefaultName(i18n: PascalI18n, count: number): string {
  return i18n._({
    id: 'editor.layers.defaultName.roof',
    message: 'Roof ({count, plural, one {# segment} other {# segments}})',
    values: { count },
  })
}

export function staircaseDefaultName(i18n: PascalI18n, count: number): string {
  return i18n._({
    id: 'editor.layers.defaultName.staircase',
    message: 'Staircase ({count, plural, one {# segment} other {# segments}})',
    values: { count },
  })
}

export function roofSegmentDefaultName(
  i18n: PascalI18n,
  roofType: RoofType,
  width: number,
  depth: number,
): string {
  return i18n._({
    id: 'editor.layers.defaultName.roofSegment',
    message:
      '{roofType, select, hip {Hip} gable {Gable} shed {Shed} gambrel {Gambrel} dutch {Dutch} mansard {Mansard} flat {Flat} conical {Conical} barrel {Barrel} other {Roof}} ({width}×{depth}m)',
    values: { roofType, width: width.toFixed(1), depth: depth.toFixed(1) },
  })
}

export function stairSegmentDefaultName(
  i18n: PascalI18n,
  segmentType: StairSegmentNode['segmentType'],
  width: number,
  length: number,
): string {
  const values = { width: width.toFixed(1), length: length.toFixed(1) }
  return segmentType === 'stair'
    ? i18n._({
        id: 'editor.layers.defaultName.flight',
        message: 'Flight ({width}×{length}m)',
        values,
      })
    : i18n._({
        id: 'editor.layers.defaultName.landing',
        message: 'Landing ({width}×{length}m)',
        values,
      })
}
