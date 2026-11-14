import {
  groundWindowEnabledNode,
  inGroundWindowNode,
  SITE_GROUND,
  useViewer,
} from '@pascal-app/viewer'
import { type BufferGeometry, DoubleSide, type Material } from 'three'
import { color, float, mrt, output, positionWorld, select, smoothstep, vec2, vec4 } from 'three/tsl'
import { MeshBasicNodeMaterial, type Node } from 'three/webgpu'
import { insideLotNode } from './lot-mask'

// The ground over a level below grade. Wholesale (a level fully below grade, the ground on Auto)
// the solid ground stays and a hole opens in it (`ground-hole.ts`); the veil sheets here are the
// faint see-through ground of the ground window (a hillside in the eye's way) and of a capture
// (which sets the solid ground aside and shows them).

/** Presentation-only meshes are never picked: clicks fall through to what lies under them. */
export const noopRaycast = () => {}

/** How much of the ground shows as a veil: enough to read where grade is, and no more. */
const VEIL_OPACITY = 0.1

type Point = readonly [number, number]

/**
 * Unlit and seen from both sides (an eye under grade sees it overhead), drawn over what lies under
 * it without hiding it: no depth, and nothing written to the scene pass's normals and diffuse
 * colour, or the screen-space ink would outline the whole sheet. `coverage` (0 to 1) is how much
 * of the ground this sheet draws.
 */
function veilMaterial(groundColor: string, coverage: Node<'float'>) {
  const material = new MeshBasicNodeMaterial({
    transparent: true,
    depthWrite: false,
    side: DoubleSide,
  })
  material.colorNode = color(groundColor)
  // Wholesale, the veil is the whole ground at `VEIL_OPACITY`. While the ground window is open
  // (the hillside in the way, not a floor under it), only the ground in the window veils —
  // at the same faintness — and the rest of this sheet draws nothing over the solid ground.
  material.opacityNode = select(
    groundWindowEnabledNode(),
    select(inGroundWindowNode(), float(VEIL_OPACITY), float(0)),
    coverage.mul(VEIL_OPACITY),
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

/**
 * Drawn only while the ground is veiled: the veil of one solid ground surface (the same geometry
 * in the same place). A direct child of the site, as the surfaces are, so the captures find it
 * (`siteGround`) and hide it with the site's other surfaces. A live view draws it only where the
 * ground window veils a hillside in the eye's way (wholesale the ground is a hole, not a sheet); a
 * capture shows it by setting `visible` itself.
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
  const veiled = useViewer((state) => state.groundMode === 'auto' && state.groundWindowVeiled)
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
