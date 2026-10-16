'use client'

import { type FoundationMember, genericFoundation, useScene } from '@pascal-app/core'
import { SITE_FOUNDATION, useViewer } from '@pascal-app/viewer'
import { useEffect, useMemo, useRef } from 'react'
import { BufferAttribute, BufferGeometry, FrontSide } from 'three'
import {
  attribute,
  color,
  float,
  floor,
  fract,
  mix,
  mod,
  mx_noise_float,
  normalLocal,
  positionWorld,
  smoothstep,
  step,
  vec3,
} from 'three/tsl'
import { MeshLambertNodeMaterial } from 'three/webgpu'
import { buildFoundationMesh, type FoundationMesh } from './generic-foundation-geometry'
import { noopRaycast } from './ground-veil'

/**
 * The generic foundation under the buildings (`genericFoundation` in core): a concrete footing and
 * a foundation wall of block, drawn from the walls and never stored. It is always drawn: the
 * ground hides the part below it from above (the eye under the ground, or looking through the hole
 * over a level below grade, is what sees it), and the course the building's seat leaves above
 * grade reads as block in the normal view. The walkthrough draws none of it.
 *
 * Two meshes and two materials, made once; nothing about them depends on the level shown or on
 * where the eye is, so a floor switch or a dive compiles nothing. Geometry is rebuilt only when
 * the foundation itself changes, or when a plugin takes a level's foundation over under the ground
 * (`pluginFoundationLevelIds`): that level's members leave the geometry while it draws them.
 */

const INCH = 0.0254
/** A nominal 8 × 8 × 16 in block: the course is 8 in with its joint, a block 16 in long. */
const COURSE = 8 * INCH
const BLOCK_LENGTH = 16 * INCH
const JOINT = (3 / 8) * INCH
const JOINT_SOFTNESS = 0.05
const BLOCK_COLORS = { light: '#97978f', dark: '#827f78' } as const
const MORTAR_COLOR = '#b5b3aa'
const CONCRETE_COLORS = { light: '#8a8a86', dark: '#6f6e6a' } as const

// TSL's own typings widen a float to a vec4 here, so the pieces are untyped.
function jointMask(inside: any, joint: number) {
  const edge = joint / 2
  return smoothstep(float(edge), float(edge + JOINT_SOFTNESS), inside).mul(
    smoothstep(float(edge), float(edge + JOINT_SOFTNESS), float(1).sub(inside)),
  )
}

/** Courses of running bond: each course half a block over the one under it, mortar between. */
function blockMaterial() {
  const material = new MeshLambertNodeMaterial({ side: FrontSide })
  const rows = positionWorld.y.div(COURSE)
  const course = floor(rows)
  const columns = attribute<'float'>('along', 'float')
    .div(BLOCK_LENGTH)
    .add(mod(course, 2).mul(0.5))
  const face: any = jointMask(fract(rows), JOINT / COURSE).mul(
    jointMask(fract(columns), JOINT / BLOCK_LENGTH),
  )
  const shade: any = mx_noise_float(vec3(floor(columns), course, 0.5))
    .mul(0.5)
    .add(0.5)
  const block = mix(color(BLOCK_COLORS.dark), color(BLOCK_COLORS.light), shade)
  const patterned = mix(color(MORTAR_COLOR), block, face)
  // The top of a run is the plain block, whatever course the shader finds there.
  const flat = step(float(0.5), normalLocal.y.abs())
  material.colorNode = mix(patterned, block, flat)
  return material
}

function concreteMaterial() {
  const material = new MeshLambertNodeMaterial({ side: FrontSide })
  const grain = mx_noise_float(positionWorld.mul(vec3(2.5, 2.5, 2.5)))
    .mul(0.5)
    .add(0.5)
  material.colorNode = mix(color(CONCRETE_COLORS.dark), color(CONCRETE_COLORS.light), grain)
  return material
}

function geometryOf(mesh: FoundationMesh | null): BufferGeometry | null {
  if (!mesh) return null
  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new BufferAttribute(mesh.positions, 3))
  geometry.setAttribute('normal', new BufferAttribute(mesh.normals, 3))
  geometry.setAttribute('along', new BufferAttribute(mesh.along, 1))
  geometry.setIndex(new BufferAttribute(mesh.indices, 1))
  return geometry
}

export function sameFoundation(a: readonly FoundationMember[], b: readonly FoundationMember[]) {
  return (
    a.length === b.length &&
    a.every((member, index) => {
      const other = b[index]
      return (
        other !== undefined &&
        member.kind === other.kind &&
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
  const block = useMemo(blockMaterial, [])
  useEffect(
    () => () => {
      concrete.dispose()
      block.dispose()
    },
    [concrete, block],
  )
  const footing = useMemo(() => geometryOf(buildFoundationMesh(members, 'footing')), [members])
  const stem = useMemo(() => geometryOf(buildFoundationMesh(members, 'stem')), [members])
  return (
    <>
      <FoundationPart geometry={footing} material={concrete} part="footing" visible={shown} />
      <FoundationPart geometry={stem} material={block} part="stem" visible={shown} />
    </>
  )
}
