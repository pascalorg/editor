import type { BufferGeometry } from 'three'

/** A run of one face's base, in wall-local x (m) and local y. */
export type WallFaceBaseRun = { start: number; end: number; y: number }

/**
 * What the wall's material array and the paint resolver need from a build: the
 * finish refs behind material indices 3.. and each face's base runs (null when
 * both faces stand on the wall's own base).
 */
export type WallFinishGeometryData = {
  refs: readonly string[]
  faceBase: Record<'a' | 'b', WallFaceBaseRun[]> | null
}

export function getWallFinishData(
  geometry: BufferGeometry | undefined | null,
): WallFinishGeometryData | undefined {
  return geometry?.userData.wallFinish as WallFinishGeometryData | undefined
}

/** Finish refs a built wall geometry's material indices 3.. point at. */
export function getWallFinishRefs(geometry: BufferGeometry | undefined | null): readonly string[] {
  return getWallFinishData(geometry)?.refs ?? []
}

/** Local y of a face's base at wall-local station `x` (0 when the faces share the wall base). */
export function getWallFaceBaseAt(
  data: Pick<WallFinishGeometryData, 'faceBase'> | undefined,
  face: 'a' | 'b',
  x: number,
): number {
  const runs = data?.faceBase?.[face]
  if (!runs?.length) return 0
  for (const run of runs) if (x >= run.start && x < run.end) return run.y
  return x < runs[0]!.start ? runs[0]!.y : runs.at(-1)!.y
}
