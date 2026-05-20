import type { RoofSegmentNode, SkylightNode } from '@pascal-app/core'
import * as THREE from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { getAnalyticalNormal, getSurfaceY } from '../solar-panel/geometry'

export { getAnalyticalNormal, getSurfaceY }

/**
 * Skylight geometry — **stub port**. Produces frame + glass as plain
 * boxes for every `skylightType`. The type-specific geometry from the
 * archive (lantern slope, opening swing, sliding panel offset) is
 * intentionally omitted in this commit — those rebuild against the
 * legacy CSG-based frame builder and the `useInteractive.skylight
 * Animations` store, neither of which has been ported yet.
 *
 * What this gives us:
 *   - kind exists in the registry, palette, sidebar tree, inspector.
 *   - placement / move / paint / delete / undo all work.
 *   - the schema's `operationState` / `slideFraction` round-trip
 *     correctly via the inspector but don't yet animate on commit
 *     and don't yet drive geometry — they're static knobs until the
 *     animation extension lands.
 *
 * Follow-up work tracked in the commit message.
 */
export function buildSkylightGeometry(node: SkylightNode): {
  frame: THREE.BufferGeometry
  glass: THREE.BufferGeometry
} {
  const w = node.width
  const h = node.height
  const ft = node.frameThickness
  const fd = node.frameDepth
  const curbH = node.curb ? node.curbHeight : 0
  const totalDepth = fd + curbH

  // Frame as 4 box rails around the glass opening. Mid Y is half-way
  // through `totalDepth`, with the curb portion sitting above and the
  // frame portion sitting below.
  const frameY = totalDepth / 2

  const railLeft = new THREE.BoxGeometry(ft, totalDepth, h + 2 * ft)
  railLeft.translate(-w / 2 - ft / 2, frameY, 0)

  const railRight = new THREE.BoxGeometry(ft, totalDepth, h + 2 * ft)
  railRight.translate(w / 2 + ft / 2, frameY, 0)

  const railBack = new THREE.BoxGeometry(w, totalDepth, ft)
  railBack.translate(0, frameY, -h / 2 - ft / 2)

  const railFront = new THREE.BoxGeometry(w, totalDepth, ft)
  railFront.translate(0, frameY, h / 2 + ft / 2)

  const frame = mergeGeometries([railLeft, railRight, railBack, railFront], false)!
  railLeft.dispose()
  railRight.dispose()
  railBack.dispose()
  railFront.dispose()

  // Glass sits centered in the frame at the curb top.
  const glassY = curbH + fd / 2
  const glass = new THREE.BoxGeometry(w, node.glassThickness, h)
  glass.translate(0, glassY, 0)

  return { frame, glass }
}
