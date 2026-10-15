import type { TerrainField } from '@pascal-app/core'
import {
  anyGroundVeiled,
  groundVeiled,
  groundWindowEnabledNode,
  hideFromScene,
  inGroundWindowNode,
  SITE_GROUND,
  SOIL_RING,
  SOIL_VEIL,
  SOIL_VEIL_OPACITY,
  showInScene,
  undergroundAmbianceNode,
  useViewer,
} from '@pascal-app/viewer'
import { useCallback } from 'react'
import { type BufferGeometry, DoubleSide, type Material, type Object3D } from 'three'
import {
  color,
  float,
  mix,
  mrt,
  output,
  positionWorld,
  select,
  smoothstep,
  vec2,
  vec4,
} from 'three/tsl'
import { MeshBasicNodeMaterial, type Node } from 'three/webgpu'
import { buildPatternedRibbon } from './line-ribbon'
import { insideLotNode } from './lot-mask'
import { buildDrapedPolyline } from './terrain-drape'

// The ground over a level below grade: the solid surfaces step aside and a veil is drawn in their
// place, so the floor under them is seen and clicked while grade still reads.

/** Presentation-only meshes are never picked: clicks fall through to what lies under them. */
export const noopRaycast = () => {}

/** How much of the ground shows as a veil: enough to read where grade is, and no more. */
const VEIL_OPACITY = 0.1

type Point = readonly [number, number]

/**
 * A ref for one of the solid ground surfaces that holds it off the scene while the ground is
 * veiled: out of the colour passes, the shadow map and every pick. A ref rather than a prop: the
 * surfaces mount and unmount with the terrain, and each must be held while it is there.
 */
export function useGroundAsideRef() {
  const veiled = useViewer(groundVeiled)
  return useCallback(
    (surface: Object3D | null) => {
      if (!(surface && veiled)) return
      hideFromScene(surface, 'ground-aside')
      return () => showInScene(surface, 'ground-aside')
    },
    [veiled],
  )
}

/**
 * Unlit and seen from both sides (an eye under grade sees it overhead), drawn over what lies under
 * it without hiding it: no depth, and nothing written to the scene pass's normals and diffuse
 * colour, or the screen-space ink would outline the whole sheet. `coverage` (0 to 1) is how much
 * of the ground this sheet draws; under the ground's ambiance the sheet turns to earth: its tone
 * goes to the soil's and it thickens a little, so the lid reads as what the earth is.
 */
function veilMaterial(groundColor: string, coverage: Node<'float'>) {
  const ambiance = undergroundAmbianceNode()
  const material = new MeshBasicNodeMaterial({
    transparent: true,
    depthWrite: false,
    side: DoubleSide,
  })
  material.colorNode = mix(color(groundColor), color(SOIL_VEIL), ambiance)
  const opacity = mix(float(VEIL_OPACITY), float(SOIL_VEIL_OPACITY), ambiance)
  // Wholesale, the veil is the whole ground at `opacity`. While the ground window is open
  // (the hillside in the way, not a floor under it), only the ground in the window veils —
  // at the same faintness — and the rest of this sheet draws nothing over the solid ground.
  material.opacityNode = select(
    groundWindowEnabledNode(),
    select(inGroundWindowNode(), opacity, float(0)),
    coverage.mul(opacity),
  )
  // The plain field too: Follow's sight reads it, not the node, to tell what it sees through.
  material.opacity = VEIL_OPACITY
  material.mrtNode = mrt({ output, diffuseColor: vec4(0), normal: vec4(0) })
  return material
}

/** The veil of the lot's own ground: its fill, or its sculpted terrain. */
export function groundVeilMaterial(groundColor: string) {
  return veilMaterial(groundColor, float(1))
}

/**
 * The veil of the horizon disc: the ground past the lot only (under the lot's own veil a second
 * one would read as a step at the property line), dissolving into the backdrop by twice the lot's
 * radius.
 */
export function horizonVeilMaterial(
  groundColor: string,
  lot: ReadonlyArray<Point>,
  bounds: { cx: number; cz: number; radius: number },
) {
  const distance = positionWorld.xz.sub(vec2(bounds.cx, bounds.cz)).length()
  const fade = float(1).sub(smoothstep(float(bounds.radius), float(bounds.radius * 2), distance))
  const outsideLot = insideLotNode(lot, positionWorld.xz).not()
  return veilMaterial(groundColor, select(outsideLot, fade, float(0)))
}

/** The grade ring: dark as the lot line, a little narrower, just over the ground. */
const GRADE_RING_COLOR = '#1c1917'
const GRADE_RING_WIDTH = 0.16
const GRADE_RING_LIFT = 0.015
/** One run, never broken: a ribbon pattern with no gap. */
const UNBROKEN: readonly number[] = [Number.POSITIVE_INFINITY, 0]

/** The grade ring's ribbon along one outline where the ground meets a level below grade. */
export function gradeRingGeometry(
  outline: ReadonlyArray<Point>,
  field: TerrainField | null,
): BufferGeometry {
  const drape = buildDrapedPolyline({ points: outline, field, lift: GRADE_RING_LIFT, closed: true })
  return buildPatternedRibbon(drape.positions, UNBROKEN, GRADE_RING_WIDTH)
}

export function gradeRingMaterial() {
  const material = new MeshBasicNodeMaterial({ color: GRADE_RING_COLOR, side: DoubleSide })
  // Under the ground's ambiance the ring is the lid's rim: a dark ring would vanish in the earth.
  material.colorNode = mix(color(GRADE_RING_COLOR), color(SOIL_RING), undergroundAmbianceNode())
  return material
}

/**
 * Drawn only while the ground is veiled: the veil of one solid ground surface (the same geometry
 * in the same place), or the grade ring. A direct child of the site, as the surfaces are, so the
 * captures find it (`siteGround`) and hide it with the site's other surfaces.
 */
export function GroundVeil({
  geometry,
  material,
  position,
  rotation,
}: {
  geometry: BufferGeometry
  material: Material
  position?: [number, number, number]
  rotation?: [number, number, number]
}) {
  const veiled = useViewer(anyGroundVeiled)
  return (
    <mesh
      geometry={geometry}
      material={material}
      position={position}
      raycast={noopRaycast}
      rotation={rotation}
      userData={{ [SITE_GROUND]: 'veil', pascalExport: 'strip' }}
      visible={veiled}
    />
  )
}
