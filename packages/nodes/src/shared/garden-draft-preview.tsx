'use client'

import {
  CursorSphere,
  EDITOR_LAYER,
  TOOL_DRAFT_FILL_OPACITY,
  TOOL_INVALID_COLOR,
  TOOL_PREVIEW_COLOR,
} from '@pascal-app/editor'
import { useEffect, useMemo } from 'react'
import { BufferGeometry, DoubleSide, Float32BufferAttribute, ShapeUtils, Vector2 } from 'three'
import { GardenPreviewLine } from './garden-preview-line'

type Point = [number, number]
type Ground = { heightAt: (x: number, z: number) => number }

const NO_RAYCAST = () => {}

/**
 * The target under the pointer while a garden tool is in hand: the editor's own cursor (ground
 * dot, ring, drop line, the tool's icon), standing on the Site ground. Site metres; mount it
 * under the scene root, not under the active building.
 */
export function GardenToolTarget({ at, ground }: { at: Point | null; ground: Ground }) {
  return (
    <CursorSphere
      position={at ? [at[0], ground.heightAt(at[0], at[1]), at[1]] : [0, 0, 0]}
      visible={!!at}
    />
  )
}

/**
 * An area laid on the ground it covers, in the editor's preview colour: what a closed draft
 * encloses, or a selected lawn (the tint a selected slab shows). Corners in Site metres.
 */
export function GardenAreaFill({ outline }: { outline: [number, number, number][] }) {
  const geometry = useMemo(() => {
    const faces = ShapeUtils.triangulateShape(
      outline.map(([x, , z]) => new Vector2(x, z)),
      [],
    )
    const next = new BufferGeometry()
    next.setAttribute('position', new Float32BufferAttribute(outline.flat(), 3))
    next.setIndex(faces.flat())
    return next
  }, [outline])
  useEffect(() => () => geometry.dispose(), [geometry])
  return (
    <mesh
      frustumCulled={false}
      geometry={geometry}
      layers={EDITOR_LAYER}
      raycast={NO_RAYCAST}
      userData={{ pascalExport: 'strip' }}
    >
      <meshBasicMaterial
        color={TOOL_PREVIEW_COLOR}
        depthTest={false}
        depthWrite={false}
        opacity={TOOL_DRAFT_FILL_OPACITY}
        side={DoubleSide}
        transparent
      />
    </mesh>
  )
}

/**
 * A garden outline while it is drawn, as the slab and zone tools draw theirs: the target under
 * the pointer, a marker on every placed point, the outline through them to the pointer and, for
 * an area, its fill. Red while the draft is refused. Site metres, under the scene root.
 */
export function GardenDraftPreview({
  points,
  hover,
  closed,
  invalid,
  ground,
  lift,
}: {
  points: Point[]
  hover: Point | null
  /** An area (planting bed, lawn) closes back on its first point; a line (hedge) does not. */
  closed: boolean
  invalid: boolean
  ground: Ground
  /** Height of the outline above the ground, so it does not fight the surface it traces. */
  lift: number
}) {
  const outline = useMemo(() => {
    const line = hover && points.length ? [...points, hover] : points
    return line.map(([x, z]): [number, number, number] => [x, ground.heightAt(x, z) + lift, z])
  }, [points, hover, ground, lift])
  const area = closed && outline.length >= 3
  const loop = useMemo(
    () => (area && outline[0] ? [...outline, outline[0]] : outline),
    [area, outline],
  )
  return (
    <>
      <GardenToolTarget at={hover} ground={ground} />
      {points.map(([x, z], index) => (
        <CursorSphere
          color={TOOL_PREVIEW_COLOR}
          height={0}
          key={index}
          position={[x, ground.heightAt(x, z) + lift, z]}
          showTooltip={false}
        />
      ))}
      {area && !invalid && <GardenAreaFill outline={outline} />}
      {loop.length >= 2 && (
        <GardenPreviewLine
          color={invalid ? TOOL_INVALID_COLOR : TOOL_PREVIEW_COLOR}
          lineWidth={3}
          points={loop}
        />
      )}
    </>
  )
}
