'use client'

import {
  type FootingDesign,
  type FootingNode,
  type FoundationMember,
  footingDesign,
  useLiveNodeOverrides,
  useRegistry,
  useScene,
} from '@pascal-app/core'
import { concreteMaterial, useNodeEvents, useViewer } from '@pascal-app/viewer'
import { useEffect, useMemo, useRef } from 'react'
import { type BufferGeometry, type Group, Matrix4, Quaternion, Vector3 } from 'three'
import { sameFoundation } from '../site/generic-foundation'
import { buildFoundationMembersMesh, geometryOf } from '../site/generic-foundation-geometry'

const material = concreteMaterial()
const UP = new Vector3(0, 1, 0)
const UNIT = new Vector3(1, 1, 1)

/** World → level-local, the level's frame inverted. */
function toLevel({ origin, yaw }: FootingDesign['levelFrame']): Matrix4 {
  return new Matrix4()
    .compose(new Vector3(...origin), new Quaternion().setFromAxisAngle(UP, yaw), UNIT)
    .invert()
}

/**
 * A footing design's concrete as one level-local geometry, rebuilt only when its members or the
 * level's frame change. The members are world; the mesh is moved into the level so it rides the
 * level's stacking.
 */
export function useFootingGeometry(design: FootingDesign | null): BufferGeometry | null {
  const kept = useRef<{ members: readonly FoundationMember[]; frame: string }>({
    members: [],
    frame: '',
  })
  const frame = design ? JSON.stringify(design.levelFrame) : ''
  const members = design?.members ?? []
  if (frame !== kept.current.frame || !sameFoundation(members, kept.current.members))
    kept.current = { members, frame }
  const current = kept.current
  const geometry = useMemo(() => {
    const built = geometryOf(buildFoundationMembersMesh(current.members))
    if (built && current.frame) built.applyMatrix4(toLevel(JSON.parse(current.frame)))
    return built
  }, [current])
  useEffect(() => () => geometry?.dispose(), [geometry])
  return geometry
}

/** A footing's concrete (`footingDesign` in core), drawn with the foundation's look. */
export default function FootingRenderer({ node: stored }: { node: FootingNode }) {
  const ref = useRef<Group>(null!)
  useRegistry(stored.id, 'footing', ref)
  const live = useLiveNodeOverrides((state) => state.overrides.get(stored.id))
  const node = useMemo(
    () => (live ? ({ ...stored, ...live } as FootingNode) : stored),
    [stored, live],
  )
  const handlers = useNodeEvents(node, 'footing')
  const nodes = useScene((state) => state.nodes)
  const geometry = useFootingGeometry(useMemo(() => footingDesign(nodes, node), [nodes, node]))
  const shown = useViewer((state) => !state.walkthroughMode)

  return (
    <group ref={ref} visible={shown}>
      {geometry && <mesh geometry={geometry} material={material} {...handlers} />}
    </group>
  )
}
