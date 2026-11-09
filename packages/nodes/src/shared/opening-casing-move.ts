import {
  type AnyNode,
  type DoorNode,
  openingHostFacing,
  resolveWallExteriorSide,
  type WindowNode,
} from '@pascal-app/core'

type MovedOpening = Pick<
  DoorNode | WindowNode,
  'parentId' | 'roofSegmentId' | 'rotation' | 'casingFaceA' | 'casingFaceB'
>
type CasingFaces = Pick<DoorNode | WindowNode, 'casingFaceA' | 'casingFaceB'>

/** The face of a host that looks outdoors: +1 for `a`, -1 for `b`, null when it cannot tell. */
function hostOutside(host: AnyNode): 1 | -1 | null {
  if (host.type === 'wall') return resolveWallExteriorSide(host)
  // A roof face's `a` is its outside, as its casing has it.
  return host.type === 'roof-segment' ? 1 : null
}

/**
 * The casing faces a door or window keeps when a move takes it from its host to `hostId`, the
 * wall or roof face it lands on turned to `rotation`. Casing is kept per host face, and two hosts
 * need not name their faces alike: a wall drawn the other way round has its `a` where the first
 * has its `b`. So each face's casing goes to the matching face of the new host: outside to
 * outside where both hosts know their outside (an outside wall, as its rooms give it, or a roof
 * face), else the face the unit's front looks at to the face it looks at there. A slide along its
 * own host, or a host with no cased faces on either end (a dormer, open floor), keeps them as they
 * are.
 */
export function movedOpeningCasingFaces(
  opening: MovedOpening,
  hostId: string,
  rotation: DoorNode['rotation'],
  nodes: Readonly<Record<string, AnyNode>>,
): CasingFaces {
  const kept = { casingFaceA: opening.casingFaceA, casingFaceB: opening.casingFaceB }
  const fromId = opening.roofSegmentId ?? opening.parentId
  const [from, to] = [nodes[fromId ?? ''], nodes[hostId]]
  if (fromId === hostId || !from || !to) return kept
  const cased = (host: AnyNode) => host.type === 'wall' || host.type === 'roof-segment'
  if (!(cased(from) && cased(to))) return kept
  const [fromOutside, toOutside] = [hostOutside(from), hostOutside(to)]
  const swapped =
    fromOutside !== null && toOutside !== null
      ? fromOutside !== toOutside
      : openingHostFacing(opening) !== openingHostFacing({ rotation })
  return swapped ? { casingFaceA: kept.casingFaceB, casingFaceB: kept.casingFaceA } : kept
}
