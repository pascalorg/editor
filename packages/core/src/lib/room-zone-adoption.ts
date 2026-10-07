import { area, containsPoint, intersection, type Polygon, type Ring } from './polygon-boolean'

/**
 * Which existing zone becomes the room of an enclosed face. Shared by the M3 load
 * migration and the structure kernel so both load paths and live edits agree.
 *
 * Hand-drawn zones are loose: drawn to wall centre lines, inner or outer faces,
 * tens of centimetres off, sometimes spanning a closet or a second space behind a
 * wall. A zone is its face's room when the face holds most of the zone and the zone
 * covers most of the face's clear floor, or when the two simply match (IoU).
 */
export const ROOM_MATCH_IOU = 0.9
/** Part of the face's clear floor the zone must cover. */
export const ROOM_ADOPT_COVER = 0.5
/** Part of the zone that must lie in the face (its dominant face). */
export const ROOM_ADOPT_SHARE = 0.5

/** `key` is the face's canonical id (its room id), so ties never depend on face order. */
export type AdoptionFace = { key: string; polygon: Polygon; clear: Polygon }
export type IdentityFace = AdoptionFace & {
  boundaryWallIds: readonly string[]
  boundarySeparatorIds: readonly string[]
}
export type ExistingRoom = {
  id: string
  polygon: Ring
  holes?: Ring[]
  seed?: [number, number]
  boundaryWallIds?: readonly string[]
  boundarySeparatorIds?: readonly string[]
}
export type AdoptionZone = { id: string; polygon: Ring; holes?: Ring[] }
export type ZoneFaceFit = {
  face: number
  key: string
  /** Zone area inside the face reference polygon / zone area. */
  share: number
  /** Zone area inside the face clear polygon / clear area. */
  cover: number
  /** Best IoU against the reference or the clear polygon. */
  iou: number
}

const EPSILON = 1e-9

function bounds(rings: Ring[]) {
  let minX = Number.POSITIVE_INFINITY
  let minY = Number.POSITIVE_INFINITY
  let maxX = Number.NEGATIVE_INFINITY
  let maxY = Number.NEGATIVE_INFINITY
  for (const ring of rings)
    for (const [x, y] of ring) {
      minX = Math.min(minX, x)
      minY = Math.min(minY, y)
      maxX = Math.max(maxX, x)
      maxY = Math.max(maxY, y)
    }
  return { minX, minY, maxX, maxY }
}

function overlaps(a: ReturnType<typeof bounds>, b: ReturnType<typeof bounds>) {
  return a.minX < b.maxX && b.minX < a.maxX && a.minY < b.maxY && b.minY < a.maxY
}

/** Every face the zone overlaps, with its fit numbers, in face order. */
export function zoneFaceFits(zone: AdoptionZone, faces: readonly AdoptionFace[]): ZoneFaceFit[] {
  const polygon: Polygon = { outer: zone.polygon, holes: zone.holes ?? [] }
  const zoneArea = area([polygon])
  if (!(zoneArea > EPSILON)) return []
  const box = bounds([zone.polygon])
  const fits: ZoneFaceFit[] = []
  faces.forEach((face, index) => {
    if (!overlaps(box, bounds([face.polygon.outer]))) return
    const overlap = area(intersection(polygon, face.polygon))
    if (!(overlap > EPSILON)) return
    const faceArea = area([face.polygon])
    const clearArea = face.clear.outer.length >= 3 ? area([face.clear]) : 0
    const clearOverlap = clearArea > EPSILON ? area(intersection(polygon, face.clear)) : overlap
    fits.push({
      face: index,
      key: face.key,
      share: overlap / zoneArea,
      cover: clearOverlap / (clearArea > EPSILON ? clearArea : faceArea),
      iou: Math.max(
        overlap / (zoneArea + faceArea - overlap),
        clearArea > EPSILON ? clearOverlap / (zoneArea + clearArea - clearOverlap) : 0,
      ),
    })
  })
  return fits
}

/** The face holding most of the zone, when the zone is that face's room. */
export function adoptableFace(fits: readonly ZoneFaceFit[]): ZoneFaceFit | undefined {
  let best: ZoneFaceFit | undefined
  for (const fit of fits)
    if (
      !best ||
      fit.share > best.share + EPSILON ||
      (Math.abs(fit.share - best.share) <= EPSILON &&
        (fit.cover > best.cover + EPSILON ||
          (Math.abs(fit.cover - best.cover) <= EPSILON && fit.key < best.key)))
    )
      best = fit
  if (!best) return
  return best.iou >= ROOM_MATCH_IOU ||
    (best.cover >= ROOM_ADOPT_COVER && best.share >= ROOM_ADOPT_SHARE)
    ? best
    : undefined
}

/** Orders two candidates for one face: the zone covering more of it wins. */
export function compareAdoptionFits(
  a: { id: string; fit: ZoneFaceFit },
  b: { id: string; fit: ZoneFaceFit },
) {
  return (
    b.fit.cover - a.fit.cover || b.fit.iou - a.fit.iou || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
  )
}

/** Face index → adopted zone id; at most one zone per face, one face per zone. */
export function electAdoptedZones(
  faces: readonly AdoptionFace[],
  zones: readonly AdoptionZone[],
): Map<number, string> {
  const candidates = new Map<number, { id: string; fit: ZoneFaceFit }[]>()
  for (const zone of zones) {
    const fit = adoptableFace(zoneFaceFits(zone, faces))
    if (!fit) continue
    const list = candidates.get(fit.face) ?? []
    list.push({ id: zone.id, fit })
    candidates.set(fit.face, list)
  }
  const elected = new Map<number, string>()
  for (const [face, list] of candidates) elected.set(face, list.sort(compareAdoptionFits)[0]!.id)
  return elected
}

function iou(a: Polygon, b: Polygon) {
  const overlap = area(intersection(a, b))
  const combined = area([a]) + area([b]) - overlap
  return combined > 0 ? overlap / combined : 0
}

const boundaryKey = (walls: readonly string[] = [], separators: readonly string[] = []) =>
  JSON.stringify([[...walls].sort(), [...separators].sort()])

/**
 * The face an existing room keeps: the face with exactly its boundaries (nothing
 * about it changed, even where degenerate faces overlap), then the outer face when
 * its separators just carved an island, then the face holding its seed, then the
 * largest overlap.
 * Shared by the load migration and the structure kernel, so a reload never trades an
 * existing room for a newly created one.
 */
export function existingRoomFace(
  room: ExistingRoom,
  faces: readonly IdentityFace[],
  overlaps: readonly number[] = faces.map((face) =>
    iou({ outer: room.polygon, holes: room.holes ?? [] }, face.polygon),
  ),
): number | undefined {
  const holes = room.holes ?? []
  const separators = room.boundarySeparatorIds ?? []
  const own = boundaryKey(room.boundaryWallIds, separators)
  return faces
    .map((face, index) => ({
      index,
      key: face.key,
      exact:
        own !== boundaryKey() &&
        boundaryKey(face.boundaryWallIds, face.boundarySeparatorIds) === own,
      overlap: overlaps[index]!,
      seed: !!room.seed && containsPoint([face.polygon], room.seed),
      // A new separator island takes area from the room, never its identity,
      // even when the old seed lies inside the new island.
      islandOuter:
        face.polygon.holes.length > holes.length &&
        face.boundarySeparatorIds.some((id) => !separators.includes(id)) &&
        iou({ outer: room.polygon, holes: [] }, { outer: face.polygon.outer, holes: [] }) >
          1 - 1e-6,
    }))
    .filter(({ overlap, seed }) => seed || overlap > 0)
    .sort(
      (a, b) =>
        Number(b.exact) - Number(a.exact) ||
        Number(b.islandOuter) - Number(a.islandOuter) ||
        Number(b.seed) - Number(a.seed) ||
        b.overlap - a.overlap ||
        (a.key < b.key ? -1 : a.key > b.key ? 1 : 0),
    )[0]?.index
}

/** Among existing rooms keeping one face, the one covering most of it survives. */
export function compareExistingRooms(face: IdentityFace) {
  const covered = new Map<string, number>()
  const cover = (room: ExistingRoom) => {
    let value = covered.get(room.id)
    if (value === undefined) {
      value = area(intersection({ outer: room.polygon, holes: room.holes ?? [] }, face.polygon))
      covered.set(room.id, value)
    }
    return value
  }
  return (a: ExistingRoom, b: ExistingRoom) =>
    cover(b) - cover(a) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
}
