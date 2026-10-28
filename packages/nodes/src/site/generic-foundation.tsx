'use client'

import {
  type AnyNode,
  type AnyNodeId,
  type FoundationMember,
  genericFoundation,
  isCaptureSessionOn,
  type LiveNodeOverrides,
  subscribeCaptureSessions,
  useLiveNodeOverrides,
  useScene,
} from '@pascal-app/core'
import {
  BLOCK_MASONRY,
  concreteMaterial,
  framingMaterial,
  masonryMaterial,
  SITE_FOUNDATION,
  useViewer,
} from '@pascal-app/viewer'
import { useEffect, useMemo, useRef, useSyncExternalStore } from 'react'
import type { BufferGeometry } from 'three'
import type { MeshLambertNodeMaterial } from 'three/webgpu'
import {
  buildDesignedFoundationMesh,
  buildFoundationMesh,
  geometryOf,
} from './generic-foundation-geometry'
import { noopRaycast } from './ground-veil'

/**
 * The foundation under the buildings (`genericFoundation` in core). A building stands on its
 * designed foundation unless its record is switched off: the slab, its turned-down edge, stem
 * walls, footings, grade beams and piles in one concrete mesh (`designed`), a raised floor's
 * cripple walls in framing over their stems (in the foundation view: elsewhere the walls carry
 * their siding down over them), under its own outline
 * where it has one, following that outline live while it is dragged. Switched off, it stands on
 * the generic one: a concrete footing and a poured foundation wall drawn from the walls and never
 * stored (each stem run carries its `material`). It is
 * always drawn: the ground hides the part below it from above
 * (the eye under the ground, or looking through the hole over a level below grade, is what sees
 * it), and the course the building's seat leaves above grade reads as what it is built of in the
 * normal view. The walkthrough draws none of it.
 *
 * One mesh per material in use, the materials made once; nothing about them depends on the level
 * shown or on where the eye is, so a floor switch or a dive compiles nothing. Geometry is rebuilt
 * only when the foundation itself changes, or when a plugin takes a level's foundation over under
 * the ground (`pluginFoundationLevelIds`): that level's members leave the geometry while it draws
 * them.
 */

/** The stem runs built of `material` as one geometry. */
function stemGeometry(
  members: readonly FoundationMember[],
  material: FoundationMember['material'],
) {
  return geometryOf(
    buildFoundationMesh(
      members.filter((member) => member.material === material),
      'stem',
    ),
  )
}

export function sameFoundation(a: readonly FoundationMember[], b: readonly FoundationMember[]) {
  return (
    a.length === b.length &&
    a.every((member, index) => {
      const other = b[index]
      return (
        other !== undefined &&
        member.kind === other.kind &&
        member.material === other.material &&
        member.levelId === other.levelId &&
        member.width === other.width &&
        member.bottomY === other.bottomY &&
        member.topY === other.topY &&
        member.from[0] === other.from[0] &&
        member.from[1] === other.from[1] &&
        member.to[0] === other.to[0] &&
        member.to[1] === other.to[1] &&
        member.designed === other.designed &&
        samePoints(member.section, other.section) &&
        samePoints(member.outline, other.outline) &&
        samePoints(member.holes?.flat(), other.holes?.flat()) &&
        member.holes?.length === other.holes?.length
      )
    })
  )
}

function samePoints(
  a: ReadonlyArray<readonly [number, number]> | undefined,
  b: ReadonlyArray<readonly [number, number]> | undefined,
) {
  if (a === b) return true
  if (!(a && b) || a.length !== b.length) return false
  return a.every((point, index) => point[0] === b[index]![0] && point[1] === b[index]![1])
}

/**
 * The scene with each foundation outline being dragged at its live shape (the outline editors
 * preview through the live overrides), so the concrete follows the drag; the scene itself
 * otherwise, which keeps the foundation's own memo.
 */
export function withLiveOutlines(
  nodes: Record<AnyNodeId, AnyNode>,
  overrides: ReadonlyMap<string, LiveNodeOverrides>,
): Record<AnyNodeId, AnyNode> {
  let merged: Record<AnyNodeId, AnyNode> | null = null
  for (const [id, patch] of overrides) {
    const node = nodes[id as AnyNodeId]
    if (node?.type !== 'foundation') continue
    merged ??= { ...nodes }
    merged[id as AnyNodeId] = { ...node, ...patch } as AnyNode
  }
  return merged ?? nodes
}

function useFoundationMembers(): readonly FoundationMember[] {
  // Stable across store writes that leave the foundation as it was.
  const kept = useRef<readonly FoundationMember[]>([])
  // A capture session starting or ending changes what a plugin claims, though no node changes:
  // the picture shows the finished house, with the generic course a framing plugin gives back.
  const capturing = useSyncExternalStore(subscribeCaptureSessions, isCaptureSessionOn, () => false)
  const nodes = useScene((state) => state.nodes)
  const overrides = useLiveNodeOverrides((state) => state.overrides)
  return useMemo(() => {
    void capturing
    const next = genericFoundation(withLiveOutlines(nodes, overrides))
    if (sameFoundation(next, kept.current)) return kept.current
    kept.current = next
    return next
  }, [nodes, overrides, capturing])
}

function FoundationPart({
  geometry,
  material,
  visible,
  part,
}: {
  geometry: BufferGeometry | null
  material: MeshLambertNodeMaterial
  visible: boolean
  part: 'footing' | 'stem' | 'cripple' | 'designed'
}) {
  useEffect(() => () => geometry?.dispose(), [geometry])
  if (!geometry) return null
  return (
    <mesh
      geometry={geometry}
      material={material}
      raycast={noopRaycast}
      userData={{ [SITE_FOUNDATION]: true, genericFoundation: part, pascalExport: 'strip' }}
      visible={visible}
    />
  )
}

export function GenericFoundation() {
  const derived = useFoundationMembers()
  const takenOver = useViewer((state) => state.pluginFoundationLevelIds)
  const members = useMemo(
    () =>
      takenOver.length === 0
        ? derived
        : derived.filter((member) => member.designed || !takenOver.includes(member.levelId)),
    [derived, takenOver],
  )
  const shown = useViewer((state) => !state.walkthroughMode)
  const concrete = useMemo(concreteMaterial, [])
  const block = useMemo(() => masonryMaterial(BLOCK_MASONRY), [])
  const framing = useMemo(() => framingMaterial(), [])
  useEffect(
    () => () => {
      concrete.dispose()
      block.dispose()
      framing.dispose()
    },
    [concrete, block, framing],
  )
  const footing = useMemo(() => geometryOf(buildFoundationMesh(members, 'footing')), [members])
  const blockStem = useMemo(() => stemGeometry(members, 'cmu'), [members])
  const concreteStem = useMemo(() => stemGeometry(members, 'concrete'), [members])
  const designed = useMemo(() => geometryOf(buildDesignedFoundationMesh(members)), [members])
  const cripple = useMemo(() => geometryOf(buildFoundationMesh(members, 'cripple')), [members])
  // The house's walls carry their siding down over a cripple wall; the foundation view, the
  // house hidden, shows its framing.
  const framed = useViewer((state) => state.foundationView)
  return (
    <>
      <FoundationPart geometry={footing} material={concrete} part="footing" visible={shown} />
      <FoundationPart geometry={blockStem} material={block} part="stem" visible={shown} />
      <FoundationPart geometry={concreteStem} material={concrete} part="stem" visible={shown} />
      <FoundationPart geometry={designed} material={concrete} part="designed" visible={shown} />
      <FoundationPart
        geometry={cripple}
        material={framing}
        part="cripple"
        visible={shown && framed}
      />
    </>
  )
}
