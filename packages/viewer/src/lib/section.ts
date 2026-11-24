import { Plane, type Vector3 } from 'three'

export type SectionAxis = 'x' | 'y' | 'z'
export type SectionShadows = 'full' | 'cut'

export type SectionState = {
  sectionShadows?: SectionShadows
  sectionEnabled: boolean
  sectionAxis: SectionAxis
  sectionPosition: number
  sectionFlipped: boolean
  walkthroughMode?: boolean
}

export const SECTION_DEFAULTS = {
  sectionShadows: 'full',
  sectionEnabled: false,
  sectionAxis: 'y',
  sectionPosition: 0,
  sectionFlipped: false,
} as const

export function sectionActive(state: SectionState): boolean {
  return state.sectionEnabled && !state.walkthroughMode
}

/** Three keeps distance >= 0: the negative axis side is kept, then flip negates the plane. */
export function updateSectionPlane(plane: Plane, state: SectionState): Plane {
  plane.normal.set(0, 0, 0)
  plane.normal[state.sectionAxis] = -1
  plane.constant = state.sectionPosition
  if (state.sectionFlipped) plane.negate()
  return plane
}

/** Preserves hit order and identity, including the array itself when inactive. */
export function filterSectionHits<T extends { point: Vector3 }>(
  hits: T[],
  state: SectionState,
  appliesTo?: (hit: T) => boolean,
): T[] {
  if (!sectionActive(state)) return hits
  const plane = updateSectionPlane(new Plane(), state)
  return hits.filter(
    (hit) => (appliesTo && !appliesTo(hit)) || plane.distanceToPoint(hit.point) >= 0,
  )
}

/** Plane/presentation identity, including colour-only changes used by label anchors. */
export function sectionSignature(state: SectionState): string {
  return `${state.sectionEnabled}:${state.sectionAxis}:${state.sectionPosition}:${state.sectionFlipped}:${!!state.walkthroughMode}`
}

/** Full-building shadows do not depend on the colour-pass section plane. */
export function sectionShadowSignature(state: SectionState): string {
  return state.sectionShadows === 'cut' && sectionActive(state) ? sectionSignature(state) : ''
}
