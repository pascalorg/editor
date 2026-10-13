import {
  groundVeiled,
  hideFromScene,
  SITE_GROUND,
  showInScene,
  useViewer,
} from '@pascal-app/viewer'
import { useCallback } from 'react'
import { type BufferGeometry, DoubleSide, type Material, type Object3D } from 'three'
import { color, float, mrt, output, positionWorld, select, smoothstep, vec2, vec4 } from 'three/tsl'
import { MeshBasicNodeMaterial, type Node } from 'three/webgpu'
import { insideLotNode } from './lot-mask'

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
 * colour, or the screen-space ink would outline the whole sheet.
 */
function veilMaterial(groundColor: string, opacity: Node<'float'>) {
  const material = new MeshBasicNodeMaterial({
    transparent: true,
    depthWrite: false,
    side: DoubleSide,
  })
  material.colorNode = color(groundColor)
  material.opacityNode = opacity
  // The plain field too: Follow's sight reads it, not the node, to tell what it sees through.
  material.opacity = VEIL_OPACITY
  material.mrtNode = mrt({ output, diffuseColor: vec4(0), normal: vec4(0) })
  return material
}

/** The veil of the lot's own ground: its fill, or its sculpted terrain. */
export function groundVeilMaterial(groundColor: string) {
  return veilMaterial(groundColor, float(VEIL_OPACITY))
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
  return veilMaterial(groundColor, select(outsideLot, fade.mul(VEIL_OPACITY), float(0)))
}

/**
 * The veil drawn in place of one solid ground surface while the ground is veiled: the same
 * geometry in the same place. A direct child of the site, as the surface it stands for, so the
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
  const veiled = useViewer(groundVeiled)
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
