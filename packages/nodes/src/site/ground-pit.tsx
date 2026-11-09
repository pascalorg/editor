'use client'

import { groundHoleOpenNode, useViewer } from '@pascal-app/viewer'
import { useEffect, useMemo } from 'react'
import { BufferAttribute, BufferGeometry, FrontSide } from 'three'
import {
  attribute,
  color,
  float,
  mix,
  mx_noise_float,
  normalize,
  normalLocal,
  positionLocal,
  positionWorld,
  smoothstep,
  transformNormalToView,
  uniform,
  vec3,
} from 'three/tsl'
import { MeshLambertNodeMaterial } from 'three/webgpu'
import type { PitWalls } from './ground-pit-geometry'
import { noopRaycast } from './ground-veil'
import type { EdgeLook } from './underground-edge'

/**
 * The pit under the hole, seen from above: over a level that lies deep, the hole in the ground
 * reads as the ground cut open, not as a white plate. Its sides are a section — the topsoil's
 * layer, then strata of two anthracites cut by the same noisy threshold as the rim, darkening
 * with depth — standing from grade down to the shown level's floor, and at the bottom a dark
 * floor under the part of the hole the level does not fill. The levels between stay hidden: the
 * level display still hides them, the pit only says there is a drop.
 *
 * Everything that moves is a uniform (the pit's floor, how far the hole is open); the walls'
 * geometry is cut once per footprint change, as the hole's own field is, and rides the same
 * contour (`ground-pit-geometry.ts`). The materials exist from the moment the scene has a level
 * below grade, so a floor switch compiles nothing.
 */

/**
 * The two looks: `true` the section walls and a dark floor under the hole's unbuilt part, `false`
 * the walls alone (the level is then seen over the backdrop, as the hole always showed it).
 */
export const PIT_FLOOR = true

const TOPSOIL_DEPTH = 0.5
const STRATA = { light: '#6e6e6e', dark: '#5e5e5e' } as const
const PIT_FOOT = '#2a2a2a'
const PIT_FLOOR_COLOR = '#4a4a4a'
/** How far (m) the strata's undulation lifts and sinks the layers along the wall. */
const STRATA_WAVE = 0.6
/** Strata noise per metre along the wall: low, so a layer runs long. */
const STRATA_RUN = 0.05
/** Layers per metre of height. */
const STRATA_FREQUENCY = 1.6
/** How far the walls' normals ease toward up, 0 the contour's own shading, 1 none. */
const WALL_SHADE_EASE = 0.75
/** How far (m) the cut's roughness pushes a wall sideways, outward (into the earth) or inward. */
const CRUMBLE = 0.9
/** The roughness's noise per metre along the wall and per metre of depth. */
const CRUMBLE_RUN = 0.55
const CRUMBLE_DEPTH = 0.45
/** Depth (m) below the rim where the roughness starts, and above the foot where it ends. */
const CRUMBLE_RIM = 0.25
const CRUMBLE_FOOT = 0.9
/** The walls' foot goes this far under the pit's floor, so no gap shows between them. */
const FOOT_TUCK = 0.03

/**
 * The section cut's face (`EdgeLook.section`): one flat tone and a darker line at grade. Without
 * it (`section-earth` too) the wall is the earth's: topsoil band, strata, a low crumble that is
 * zero at the rim.
 */
const SECTION_TONE = '#747474'
const SECTION_LINE = '#1e1e1e'
const SECTION_LINE_DEPTH = 0.07

const pitTopY = uniform(0)
const pitFloorY = uniform(0)
// Where the dark floor is drawn: under the plate (`groundPitFloorY` in core), clear of the
// plane the foundation stops on.
const pitDrawnFloorY = uniform(0)
const pitCrumble = uniform(CRUMBLE)
const pitSection = uniform(0)

/** Sets the walls' look for an edge look (uniforms: nothing recompiles). */
export function setGroundPitEdge(look: EdgeLook): void {
  pitCrumble.value = look.crumble
  pitSection.value = look.section
}

/** The floor the pit goes down to now, world Y (the last level shown below grade). */
export function groundPitFloorNow(): number {
  return pitFloorY.value as number
}

/** Where the pit draws its dark floor now, world Y: under the plate of that floor. */
export function groundPitDrawnFloorNow(): number {
  return pitDrawnFloorY.value as number
}

function pitEase() {
  return smoothstep(float(0), float(1), groundHoleOpenNode())
}

function wallMaterial(topsoil: string, foot: string) {
  const material = new MeshLambertNodeMaterial({ side: FrontSide })
  const drop = attribute<'float'>('drop', 'float')
  const slide = drop.mul(pitEase())
  const drawnY = mix(positionLocal.y, pitDrawnFloorY.sub(FOOT_TUCK), slide)
  // An earth cut is rough in depth: past the rim's own cut the wall is pushed sideways by a 3D
  // noise that changes with depth, so a wiggle of the rim does not run straight down as a fold.
  // Nothing at the rim (the top stays on the shader's cut) nor at the foot (it stays under the
  // floor's plate), both eased in over a few tenths of a metre.
  const belowRim = positionLocal.y.sub(drawnY)
  const aboveFoot = drawnY.sub(pitDrawnFloorY.sub(FOOT_TUCK))
  const rough = smoothstep(float(CRUMBLE_RIM), float(CRUMBLE_RIM * 5), belowRim).mul(
    smoothstep(float(0), float(CRUMBLE_FOOT), aboveFoot),
  )
  const crumble = (scale: number) =>
    mx_noise_float(
      vec3(
        positionLocal.x.mul(CRUMBLE_RUN * scale),
        drawnY.mul(CRUMBLE_DEPTH * scale),
        positionLocal.z.mul(CRUMBLE_RUN * scale),
      ),
    )
  // A broad lump and a finer one over it.
  const bulge = crumble(1).add(crumble(2.7).mul(0.4)).mul(pitCrumble).mul(rough)
  material.positionNode = vec3(
    positionLocal.x.sub(normalLocal.x.mul(bulge)),
    drawnY,
    positionLocal.z.sub(normalLocal.z.mul(bulge)),
  )
  // `positionWorld` is the displaced vertex (the position node feeds it), so `.y` is the height the
  // wall is drawn at. Layers run long and flat: a wide, slow wave lifts and sinks them along the
  // wall, and the strata's own noise is stretched along it so a band reads as a band, not a patch.
  const wave = mx_noise_float(positionWorld.mul(vec3(0.07, 0, 0.07))).mul(STRATA_WAVE)
  const sample = vec3(
    positionWorld.x.mul(STRATA_RUN),
    positionWorld.y.add(wave).mul(STRATA_FREQUENCY),
    positionWorld.z.mul(STRATA_RUN),
  )
  // The contour's folds are real, but lit as a wall each fold is a light or dark column. The pit
  // is in shade: the normal is eased toward up so the folds shade softly and the strata lead.
  material.normalNode = transformNormalToView(
    normalize(mix(normalLocal, vec3(0, 1, 0), WALL_SHADE_EASE)),
  )
  const strata = smoothstep(float(-0.06), float(0.06), mx_noise_float(sample))
  const layers = mix(color(STRATA.dark), color(STRATA.light), strata)
  const toFoot = mix(layers, color(foot), drop.mul(0.6).mul(float(1).sub(pitSection)))
  // The ground's own layer along the cut, its lower edge a noise threshold like the rim.
  const depthBelowTop = drop.mul(pitTopY.sub(pitFloorY)).mul(pitEase())
  const edge = float(TOPSOIL_DEPTH).add(
    mx_noise_float(positionWorld.mul(vec3(1.3, 0, 1.3))).mul(0.12),
  )
  const soil = float(1)
    .sub(smoothstep(edge.sub(0.04), edge, depthBelowTop))
    .mul(float(1).sub(pitSection))
  const earth = mix(toFoot, color(topsoil), soil)
  // The section cut: a flat face and a thin dark line where it meets grade.
  const gradeLine = float(1).sub(
    smoothstep(float(SECTION_LINE_DEPTH), float(SECTION_LINE_DEPTH * 1.6), depthBelowTop),
  )
  const section = mix(color(SECTION_TONE), color(SECTION_LINE), gradeLine)
  material.colorNode = mix(earth, section, pitSection)
  return material
}

function floorMaterial(inHole: unknown) {
  const material = new MeshLambertNodeMaterial({ side: FrontSide })
  material.positionNode = vec3(
    positionLocal.x,
    mix(pitTopY, pitDrawnFloorY, pitEase()),
    positionLocal.z,
  )
  const grain = mx_noise_float(positionWorld.mul(vec3(0.8, 0, 0.8)))
    .mul(0.5)
    .add(0.5)
  material.colorNode = mix(color(PIT_FLOOR_COLOR), color(PIT_FOOT), grain.mul(0.5))
  ;(material as unknown as { maskNode: unknown }).maskNode = inHole
  return material
}

/**
 * The pit's walls and floor. `walls` is the cut contour (null: no hole), `box` the field's
 * footprint the floor covers, `topY` the grade, `floorY` the shown level's floor and `drawnFloorY`
 * where the dark floor is drawn (`groundPitFloorY`), all world Y.
 */
export function GroundPit({
  walls,
  box,
  topY,
  floorY,
  drawnFloorY,
  topsoil,
  inHole,
}: {
  walls: PitWalls | null
  box: { originX: number; originZ: number; span: number } | null
  topY: number
  floorY: number | null
  drawnFloorY: number | null
  topsoil: string
  inHole: unknown
}) {
  const wall = useMemo(() => wallMaterial(topsoil, PIT_FOOT), [topsoil])
  const floor = useMemo(() => (PIT_FLOOR ? floorMaterial(inHole) : null), [inHole])
  useEffect(
    () => () => {
      wall.dispose()
      floor?.dispose()
    },
    [wall, floor],
  )
  const wallGeometry = useMemo(() => {
    if (!walls) return null
    const geometry = new BufferGeometry()
    geometry.setAttribute('position', new BufferAttribute(walls.positions, 3))
    geometry.setAttribute('normal', new BufferAttribute(walls.normals, 3))
    geometry.setAttribute('drop', new BufferAttribute(walls.drops, 1))
    geometry.setIndex(new BufferAttribute(walls.indices, 1))
    return geometry
  }, [walls])
  const floorGeometry = useMemo(() => {
    if (!box) return null
    const { originX: x0, originZ: z0, span } = box
    const geometry = new BufferGeometry()
    geometry.setAttribute(
      'position',
      new BufferAttribute(
        new Float32Array([x0, 0, z0, x0, 0, z0 + span, x0 + span, 0, z0 + span, x0 + span, 0, z0]),
        3,
      ),
    )
    geometry.setAttribute(
      'normal',
      new BufferAttribute(new Float32Array([0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0]), 3),
    )
    geometry.setIndex([0, 1, 2, 0, 2, 3])
    return geometry
  }, [box])
  useEffect(() => () => wallGeometry?.dispose(), [wallGeometry])
  useEffect(() => () => floorGeometry?.dispose(), [floorGeometry])
  // Under the ground the hole stays open but its pit does not: the eye there sees the earth's
  // dark mode, not the cut walls hanging in it. A flag, not a uniform: nothing recompiles.
  const eyeAbove = useViewer((state) => !state.eyeUnderGround)
  useEffect(() => {
    pitTopY.value = topY
    if (floorY !== null) pitFloorY.value = floorY
    if (drawnFloorY !== null) pitDrawnFloorY.value = drawnFloorY
  }, [topY, floorY, drawnFloorY])

  return (
    <>
      {wallGeometry && (
        <mesh
          frustumCulled={false}
          geometry={wallGeometry}
          material={wall}
          raycast={noopRaycast}
          userData={{ groundPit: 'walls', pascalExport: 'strip' }}
          visible={eyeAbove}
        />
      )}
      {floorGeometry && floor && (
        <mesh
          frustumCulled={false}
          geometry={floorGeometry}
          material={floor}
          raycast={noopRaycast}
          userData={{ groundPit: 'floor', pascalExport: 'strip' }}
          visible={eyeAbove}
        />
      )}
    </>
  )
}
