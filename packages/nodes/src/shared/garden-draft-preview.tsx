'use client'

import { formatLinearMeasurement } from '@pascal-app/core'
import {
  CursorSphere,
  DraftMeasurementLabel,
  EDITOR_LAYER,
  TOOL_DRAFT_FILL_OPACITY,
  TOOL_INVALID_COLOR,
  TOOL_PREVIEW_COLOR,
} from '@pascal-app/editor'
import { getSceneTheme, useViewer } from '@pascal-app/viewer'
import { useEffect, useMemo } from 'react'
import {
  BoxGeometry,
  BufferGeometry,
  DoubleSide,
  Float32BufferAttribute,
  type Object3D,
  ShapeUtils,
  Vector2,
} from 'three'
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
 * A ghost of the object a click would set, standing on the ground under the pointer: built once
 * by the tool and only moved here. Site metres, under the scene root.
 */
export function GardenGhost({
  object,
  at,
  ground,
}: {
  object: Object3D | null
  at: Point | null
  ground: Ground
}) {
  if (!object) return null
  return (
    <group
      position={at ? [at[0], ground.heightAt(at[0], at[1]), at[1]] : [0, 0, 0]}
      userData={{ pascalExport: 'strip', gardenGhost: true }}
      visible={!!at}
    >
      <primitive dispose={null} object={object} />
    </group>
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

// One box for every segment of every run: scaled per segment, never rebuilt.
const UNIT_BOX = new BoxGeometry(1, 1, 1)
/** Opacity of a run's volume while it is drawn (the wall draft's). */
const RUN_VOLUME_OPACITY = 0.5
/** A length label stands this far above the volume it measures (the wall draft's offset). */
const RUN_LABEL_RISE = 0.22

/**
 * The volume a run will take while it is drawn, as the wall tool shows its wall: a translucent
 * box of the run's width and height on each segment, and the length of the segment in hand.
 * `path` is on the ground, in Site metres; the last point is the pointer.
 */
export function GardenRunVolume({
  path,
  width,
  height,
  invalid,
  measured,
}: {
  path: [number, number, number][]
  width: number
  height: number
  invalid: boolean
  /** Label the last segment with its length (the one the pointer is drawing). */
  measured: boolean
}) {
  const unit = useViewer((state) => state.unit)
  const metricNotation = useViewer((state) => state.metricNotation)
  const dark = useViewer((state) => getSceneTheme(state.sceneTheme).appearance === 'dark')
  const segments = path.slice(1).flatMap((end, index) => {
    const start = path[index]
    if (!start) return []
    const [dx, dz] = [end[0] - start[0], end[2] - start[2]]
    const length = Math.hypot(dx, dz)
    if (length < 1e-6) return []
    const middle: [number, number, number] = [
      (start[0] + end[0]) / 2,
      (start[1] + end[1]) / 2,
      (start[2] + end[2]) / 2,
    ]
    return [{ index, length, middle, turn: -Math.atan2(dz, dx) }]
  })
  const last = segments.at(-1)
  return (
    <>
      {segments.map(({ index, length, middle, turn }) => (
        <mesh
          geometry={UNIT_BOX}
          key={index}
          layers={EDITOR_LAYER}
          position={[middle[0], middle[1] + height / 2, middle[2]]}
          raycast={NO_RAYCAST}
          renderOrder={1}
          rotation={[0, turn, 0]}
          scale={[length, height, width]}
          userData={{ pascalExport: 'strip', gardenRunVolume: true }}
        >
          <meshBasicMaterial
            color={invalid ? TOOL_INVALID_COLOR : TOOL_PREVIEW_COLOR}
            depthTest={false}
            depthWrite={false}
            opacity={RUN_VOLUME_OPACITY}
            side={DoubleSide}
            transparent
          />
        </mesh>
      ))}
      {measured && last && (
        <DraftMeasurementLabel
          color={dark ? '#ffffff' : '#111111'}
          label={formatLinearMeasurement(last.length, unit, metricNotation)}
          position={[last.middle[0], last.middle[1] + height + RUN_LABEL_RISE, last.middle[2]]}
          shadowColor={dark ? '#111111' : '#ffffff'}
        />
      )}
    </>
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
  volume,
}: {
  points: Point[]
  hover: Point | null
  /** An area (planting bed, lawn) closes back on its first point; a line (hedge) does not. */
  closed: boolean
  invalid: boolean
  ground: Ground
  /** Height of the outline above the ground, so it does not fight the surface it traces. */
  lift: number
  /** A run with a body (a hedge): its width and height, shown as a volume along the line. */
  volume?: { width: number; height: number }
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
      {volume && outline.length >= 2 && (
        <GardenRunVolume
          height={volume.height}
          invalid={invalid}
          measured={!!hover}
          path={outline}
          width={volume.width}
        />
      )}
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
