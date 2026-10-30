'use client'

import {
  type FoundationMember,
  genericFoundation,
  isCaptureSessionOn,
  subscribeCaptureSessions,
  useScene,
} from '@pascal-app/core'
import {
  BLOCK_MASONRY,
  concreteMaterial,
  masonryMaterial,
  SITE_FOUNDATION,
  useViewer,
} from '@pascal-app/viewer'
import { useEffect, useMemo, useRef, useSyncExternalStore } from 'react'
import { BufferAttribute, BufferGeometry } from 'three'
import type { MeshLambertNodeMaterial } from 'three/webgpu'
import { buildFoundationMesh, type FoundationMesh } from './generic-foundation-geometry'
import { noopRaycast } from './ground-veil'

/**
 * The generic foundation under the buildings (`genericFoundation` in core): a concrete footing and
 * a foundation wall, drawn from the walls and never stored, of the building's foundation
 * construction: block by default, cast concrete in Europe (each stem run carries its `material`). It is always drawn: the ground hides the part below it from above
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

function geometryOf(mesh: FoundationMesh | null): BufferGeometry | null {
  if (!mesh) return null
  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new BufferAttribute(mesh.positions, 3))
  geometry.setAttribute('normal', new BufferAttribute(mesh.normals, 3))
  geometry.setAttribute('along', new BufferAttribute(mesh.along, 1))
  geometry.setIndex(new BufferAttribute(mesh.indices, 1))
  return geometry
}

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
        member.to[1] === other.to[1]
      )
    })
  )
}

function useFoundationMembers(): readonly FoundationMember[] {
  // Stable across store writes that leave the foundation as it was.
  const kept = useRef<readonly FoundationMember[]>([])
  // A capture session starting or ending changes what a plugin claims, though no node changes:
  // the picture shows the finished house, with the generic course a framing plugin gives back.
  useSyncExternalStore(subscribeCaptureSessions, isCaptureSessionOn, () => false)
  return useScene((state) => {
    const next = genericFoundation(state.nodes)
    if (sameFoundation(next, kept.current)) return kept.current
    kept.current = next
    return next
  })
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
  part: FoundationMember['kind']
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
        : derived.filter((member) => !takenOver.includes(member.levelId)),
    [derived, takenOver],
  )
  const shown = useViewer((state) => !state.walkthroughMode)
  const concrete = useMemo(concreteMaterial, [])
  const block = useMemo(() => masonryMaterial(BLOCK_MASONRY), [])
  useEffect(
    () => () => {
      concrete.dispose()
      block.dispose()
    },
    [concrete, block],
  )
  const footing = useMemo(() => geometryOf(buildFoundationMesh(members, 'footing')), [members])
  const blockStem = useMemo(() => stemGeometry(members, 'cmu'), [members])
  const concreteStem = useMemo(() => stemGeometry(members, 'concrete'), [members])
  return (
    <>
      <FoundationPart geometry={footing} material={concrete} part="footing" visible={shown} />
      <FoundationPart geometry={blockStem} material={block} part="stem" visible={shown} />
      <FoundationPart geometry={concreteStem} material={concrete} part="stem" visible={shown} />
    </>
  )
}
