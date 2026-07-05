import {
  Brush,
  csgEvaluator,
  csgGeometry,
  prepareBrushForCSG,
  SUBTRACTION,
} from '@pascal-app/viewer'
import {
  BoxGeometry,
  CylinderGeometry,
  Group,
  Mesh,
  MeshStandardMaterial,
  SphereGeometry,
  TorusGeometry,
} from 'three'
import type { SinkLayout } from '../stack'
import { createWorldScaleBoxGeometry, stampSlot } from './shared'

export const sinkBasinMaterial = new MeshStandardMaterial({
  color: '#c7cbcf',
  metalness: 0.85,
  roughness: 0.3,
})
export const sinkFaucetMaterial = new MeshStandardMaterial({
  color: '#b8bcc0',
  metalness: 0.9,
  roughness: 0.22,
})
export const sinkDrainMaterial = new MeshStandardMaterial({
  color: '#7d8288',
  metalness: 0.88,
  roughness: 0.35,
})

for (const material of [sinkBasinMaterial, sinkFaucetMaterial, sinkDrainMaterial]) {
  material.userData.__pascalCachedMaterial = true
}

const BASIN_WALL = 0.012
const BASIN_DEPTH = 0.19
const BASIN_CORNER_MARGIN = 0.06
// Centers the faucet base in the strip between the bowl's back edge and the
// countertop's back edge (BASIN_CORNER_MARGIN wide).
const FAUCET_SETBACK = 0.03

export type SinkBowlSpec = { centerX: number; width: number; depth: number }

/**
 * Bowl rects in module-local X/Z given the usable countertop footprint.
 * Shared by the 3D cut, the run-countertop cut, and the 2D floorplan symbol.
 */
export function sinkBowls(
  layout: SinkLayout,
  usableWidth: number,
  usableDepth: number,
): SinkBowlSpec[] {
  const depth = Math.max(0.1, usableDepth - BASIN_CORNER_MARGIN * 2)
  const full = Math.max(0.15, usableWidth - BASIN_CORNER_MARGIN * 2)
  if (layout === 'single') {
    const width = Math.min(0.7, full)
    return [{ centerX: 0, width, depth }]
  }
  const divider = 0.03
  if (layout === 'double') {
    const width = Math.min(0.42, (full - divider) / 2)
    return [
      { centerX: -(width + divider) / 2, width, depth },
      { centerX: (width + divider) / 2, width, depth },
    ]
  }
  // double-offset: 60/40 split
  const total = Math.min(0.86, full)
  const main = (total - divider) * 0.6
  const side = (total - divider) * 0.4
  return [
    { centerX: -(total / 2) + main / 2, width: main, depth },
    { centerX: total / 2 - side / 2, width: side, depth },
  ]
}

/**
 * Subtract the sink bowl openings from a countertop mesh via three-bvh-csg.
 * `cutCenterX/Z` position the sink footprint in the countertop mesh's local
 * frame (the run countertop spans several modules, so the sink is off-center
 * there). Returns a replacement mesh; the caller swaps it into the group.
 */
export function cutSinkIntoCountertop(
  countertop: Mesh,
  bowls: SinkBowlSpec[],
  cutCenterX: number,
  cutCenterZ: number,
  countertopThickness: number,
): Mesh {
  const slotId = countertop.userData.slotId
  let result = new Brush(countertop.geometry, countertop.material)
  result.position.copy(countertop.position)
  prepareBrushForCSG(result)

  for (const bowl of bowls) {
    // Rim reveal: the opening is slightly smaller than the basin shell so
    // the undermount lip tucks under the countertop.
    const cutter = new Brush(
      new BoxGeometry(bowl.width - BASIN_WALL, countertopThickness * 4, bowl.depth - BASIN_WALL),
    )
    cutter.position.set(cutCenterX + bowl.centerX, countertop.position.y, cutCenterZ)
    prepareBrushForCSG(cutter)
    const next = csgEvaluator.evaluate(result, cutter, SUBTRACTION) as Brush
    prepareBrushForCSG(next)
    cutter.geometry.dispose()
    if (result.geometry !== countertop.geometry) result.geometry.dispose()
    result = next
  }

  const mesh = new Mesh(csgGeometry(result), countertop.material)
  mesh.userData.slotId = slotId
  mesh.name = countertop.name
  // Brush geometry is baked in brush-local space with the brush transform
  // applied at evaluate time — position stays at the original mesh position.
  mesh.position.copy(countertop.position)
  mesh.castShadow = true
  mesh.receiveShadow = true
  return mesh
}

function addBasinShell(
  group: Group,
  bowl: SinkBowlSpec,
  centerX: number,
  centerZ: number,
  rimY: number,
  name: string,
) {
  const x = centerX + bowl.centerX
  const bottomY = rimY - BASIN_DEPTH
  const innerWidth = bowl.width - BASIN_WALL * 2
  const innerDepth = bowl.depth - BASIN_WALL * 2

  const walls: Array<{
    size: [number, number, number]
    position: [number, number, number]
    suffix: string
  }> = [
    {
      size: [bowl.width, BASIN_WALL, bowl.depth],
      position: [x, bottomY + BASIN_WALL / 2, centerZ],
      suffix: 'bottom',
    },
    {
      size: [BASIN_WALL, BASIN_DEPTH, bowl.depth],
      position: [x - bowl.width / 2 + BASIN_WALL / 2, rimY - BASIN_DEPTH / 2, centerZ],
      suffix: 'left',
    },
    {
      size: [BASIN_WALL, BASIN_DEPTH, bowl.depth],
      position: [x + bowl.width / 2 - BASIN_WALL / 2, rimY - BASIN_DEPTH / 2, centerZ],
      suffix: 'right',
    },
    {
      size: [innerWidth, BASIN_DEPTH, BASIN_WALL],
      position: [x, rimY - BASIN_DEPTH / 2, centerZ - bowl.depth / 2 + BASIN_WALL / 2],
      suffix: 'back',
    },
    {
      size: [innerWidth, BASIN_DEPTH, BASIN_WALL],
      position: [x, rimY - BASIN_DEPTH / 2, centerZ + bowl.depth / 2 - BASIN_WALL / 2],
      suffix: 'front',
    },
  ]
  for (const wall of walls) {
    const mesh = stampSlot(
      new Mesh(createWorldScaleBoxGeometry(...wall.size), sinkBasinMaterial),
      'appliance',
    )
    mesh.name = `${name}-basin-${wall.suffix}`
    mesh.position.set(...wall.position)
    mesh.castShadow = true
    mesh.receiveShadow = true
    group.add(mesh)
  }

  const drain = stampSlot(
    new Mesh(new CylinderGeometry(0.024, 0.024, 0.004, 24), sinkDrainMaterial),
    'appliance',
  )
  drain.name = `${name}-drain`
  drain.position.set(x, bottomY + BASIN_WALL + 0.002, centerZ)
  group.add(drain)

  const trap = stampSlot(
    new Mesh(
      new CylinderGeometry(0.02, 0.02, Math.max(0.05, BASIN_DEPTH * 0.7), 16),
      sinkDrainMaterial,
    ),
    'appliance',
  )
  trap.name = `${name}-drain-pipe`
  trap.position.set(x, bottomY - Math.max(0.05, BASIN_DEPTH * 0.7) / 2, centerZ)
  group.add(trap)
}

// Proportions from Kohler Simplice / Moen Align / Delta Essa spec sheets:
// Ø52mm body ~95mm tall, straight riser to ~305mm, ~105mm-radius arc peaking
// near 400mm, spray-head outlet ~240mm above deck, ~210mm reach. Handle is a
// Grohe Minta-style horizontal pin lever off the side of the body.
const FAUCET_BODY_RADIUS = 0.026
const FAUCET_BODY_HEIGHT = 0.095
const FAUCET_TUBE_RADIUS = 0.0125
const FAUCET_ARC_RADIUS = 0.105
const FAUCET_RISER_TOP = 0.305

function addFaucetHandle(group: Group, x: number, y: number, z: number, name: string) {
  const handle = new Group()
  handle.name = `${name}-faucet-handle`
  handle.position.set(x, y, z)

  const barrelRadius = 0.021
  const barrelLength = 0.064
  const rootInset = 0.022

  const saddle = stampSlot(
    new Mesh(new SphereGeometry(barrelRadius * 1.08, 24, 14), sinkFaucetMaterial),
    'appliance',
  )
  saddle.name = `${name}-faucet-handle-saddle`
  saddle.scale.set(0.62, 1.05, 1.05)
  saddle.position.set(-0.003, 0, 0)
  saddle.castShadow = true
  handle.add(saddle)

  const barrel = stampSlot(
    new Mesh(
      new CylinderGeometry(barrelRadius, barrelRadius, barrelLength + rootInset, 28),
      sinkFaucetMaterial,
    ),
    'appliance',
  )
  barrel.name = `${name}-faucet-handle-barrel`
  barrel.rotation.z = Math.PI / 2
  barrel.position.set((barrelLength - rootInset) / 2, 0, 0)
  barrel.castShadow = true
  handle.add(barrel)

  const endCapThickness = 0.007
  const endCap = stampSlot(
    new Mesh(
      new CylinderGeometry(barrelRadius * 1.03, barrelRadius * 1.03, endCapThickness, 28),
      sinkFaucetMaterial,
    ),
    'appliance',
  )
  endCap.name = `${name}-faucet-handle-cap`
  endCap.rotation.z = Math.PI / 2
  endCap.position.set(barrelLength + endCapThickness * 0.35, 0, 0)
  endCap.castShadow = true
  handle.add(endCap)

  const pinRadius = 0.0042
  const pinHeight = 0.072
  const pinX = barrelLength - 0.012
  const pin = stampSlot(
    new Mesh(new CylinderGeometry(pinRadius, pinRadius, pinHeight, 14), sinkFaucetMaterial),
    'appliance',
  )
  pin.name = `${name}-faucet-handle-pin`
  pin.position.set(pinX, barrelRadius + pinHeight / 2 - 0.001, 0)
  pin.castShadow = true
  handle.add(pin)

  const pinCapHeight = 0.003
  const pinCap = stampSlot(
    new Mesh(new CylinderGeometry(pinRadius, pinRadius, pinCapHeight, 14), sinkFaucetMaterial),
    'appliance',
  )
  pinCap.name = `${name}-faucet-handle-pin-tip`
  pinCap.position.set(pinX, barrelRadius + pinHeight + pinCapHeight / 2 - 0.001, 0)
  pinCap.castShadow = true
  handle.add(pinCap)

  group.add(handle)
}

function addFaucet(group: Group, x: number, z: number, rimY: number, name: string) {
  const bodyTopY = rimY + FAUCET_BODY_HEIGHT
  const riserTopY = rimY + FAUCET_RISER_TOP
  const reach = FAUCET_ARC_RADIUS * 2

  // Round base flare where the body meets the countertop.
  const flare = stampSlot(
    new Mesh(
      new CylinderGeometry(FAUCET_BODY_RADIUS + 0.002, 0.032, 0.008, 28),
      sinkFaucetMaterial,
    ),
    'appliance',
  )
  flare.name = `${name}-faucet-escutcheon`
  flare.position.set(x, rimY + 0.004, z)
  flare.castShadow = true
  group.add(flare)

  // Mixer body: straight Ø52mm column; riser, spout, and handle grow from it.
  const body = stampSlot(
    new Mesh(
      new CylinderGeometry(FAUCET_BODY_RADIUS, FAUCET_BODY_RADIUS, FAUCET_BODY_HEIGHT, 28),
      sinkFaucetMaterial,
    ),
    'appliance',
  )
  body.name = `${name}-faucet-base`
  body.position.set(x, rimY + FAUCET_BODY_HEIGHT / 2, z)
  body.castShadow = true
  group.add(body)

  // Domed shoulder capping the body.
  const shoulder = stampSlot(
    new Mesh(new SphereGeometry(FAUCET_BODY_RADIUS, 24, 16), sinkFaucetMaterial),
    'appliance',
  )
  shoulder.name = `${name}-faucet-shoulder`
  shoulder.scale.y = 0.5
  shoulder.position.set(x, bodyTopY, z)
  shoulder.castShadow = true
  group.add(shoulder)

  // Taper collar easing the Ø52 body into the Ø25 spout tube.
  const collarHeight = 0.022
  const collar = stampSlot(
    new Mesh(
      new CylinderGeometry(FAUCET_TUBE_RADIUS, FAUCET_BODY_RADIUS * 0.62, collarHeight, 20),
      sinkFaucetMaterial,
    ),
    'appliance',
  )
  collar.name = `${name}-faucet-collar`
  collar.position.set(x, bodyTopY + collarHeight / 2, z)
  collar.castShadow = true
  group.add(collar)

  // Straight riser from the collar up to where the arc begins (~55% of height).
  const riserLength = riserTopY - (bodyTopY + collarHeight) + 0.002
  const riser = stampSlot(
    new Mesh(
      new CylinderGeometry(FAUCET_TUBE_RADIUS, FAUCET_TUBE_RADIUS, riserLength, 18),
      sinkFaucetMaterial,
    ),
    'appliance',
  )
  riser.name = `${name}-faucet-riser`
  riser.position.set(x, bodyTopY + collarHeight + riserLength / 2 - 0.001, z)
  riser.castShadow = true
  group.add(riser)

  // Gooseneck: half-torus from the riser top over the apex (~400mm above
  // deck) and back down toward the bowl (+Z).
  const gooseneck = stampSlot(
    new Mesh(
      new TorusGeometry(FAUCET_ARC_RADIUS, FAUCET_TUBE_RADIUS, 14, 32, Math.PI),
      sinkFaucetMaterial,
    ),
    'appliance',
  )
  gooseneck.name = `${name}-faucet-gooseneck`
  gooseneck.rotation.y = Math.PI / 2
  gooseneck.position.set(x, riserTopY, z + FAUCET_ARC_RADIUS)
  gooseneck.castShadow = true
  group.add(gooseneck)

  // Down-leg: short tube, dark dock seam, then the conical pull-down spray
  // head. Outlet lands ~240mm above the deck per spec.
  const spoutZ = z + reach
  const downTubeLength = 0.02
  const downTube = stampSlot(
    new Mesh(
      new CylinderGeometry(FAUCET_TUBE_RADIUS, FAUCET_TUBE_RADIUS, downTubeLength, 18),
      sinkFaucetMaterial,
    ),
    'appliance',
  )
  downTube.name = `${name}-faucet-spout`
  downTube.position.set(x, riserTopY - downTubeLength / 2, spoutZ)
  downTube.castShadow = true
  group.add(downTube)

  const seamHeight = 0.005
  const seam = stampSlot(
    new Mesh(
      new CylinderGeometry(
        FAUCET_TUBE_RADIUS + 0.0008,
        FAUCET_TUBE_RADIUS + 0.0008,
        seamHeight,
        18,
      ),
      sinkDrainMaterial,
    ),
    'appliance',
  )
  seam.name = `${name}-faucet-spray-seam`
  seam.position.set(x, riserTopY - downTubeLength - seamHeight / 2, spoutZ)
  group.add(seam)

  const headLength = 0.032
  const headTopY = riserTopY - downTubeLength - seamHeight
  const sprayHead = stampSlot(
    new Mesh(
      new CylinderGeometry(FAUCET_TUBE_RADIUS + 0.0005, 0.019, headLength, 20),
      sinkFaucetMaterial,
    ),
    'appliance',
  )
  sprayHead.name = `${name}-faucet-spray-head`
  sprayHead.position.set(x, headTopY - headLength / 2, spoutZ)
  sprayHead.castShadow = true
  group.add(sprayHead)

  const faceHeight = 0.008
  const sprayFace = stampSlot(
    new Mesh(new CylinderGeometry(0.019, 0.018, faceHeight, 20), sinkDrainMaterial),
    'appliance',
  )
  sprayFace.name = `${name}-faucet-aerator`
  sprayFace.position.set(x, headTopY - headLength - faceHeight / 2, spoutZ)
  group.add(sprayFace)

  addFaucetHandle(group, x + FAUCET_BODY_RADIUS - 0.016, rimY + FAUCET_BODY_HEIGHT * 0.76, z, name)
}

/**
 * Undermount sink: basin shells + faucet, positioned under a countertop
 * opening the caller has already cut via {@link cutSinkIntoCountertop}.
 * `rimY` is the underside of the countertop (= carcass top);
 * `countertopThickness` is the effective slab thickness above the rim (the
 * parent run's when the module doesn't own its countertop).
 */
export function addSinkCompartment(
  group: Group,
  bowls: SinkBowlSpec[],
  centerX: number,
  centerZ: number,
  rimY: number,
  countertopThickness: number,
  index: number,
) {
  const name = `cabinet-sink-${index}`
  for (const [bowlIndex, bowl] of bowls.entries()) {
    addBasinShell(group, bowl, centerX, centerZ, rimY, `${name}-${bowlIndex}`)
  }

  const bowlsMinX = Math.min(...bowls.map((bowl) => bowl.centerX - bowl.width / 2))
  const bowlsMaxX = Math.max(...bowls.map((bowl) => bowl.centerX + bowl.width / 2))
  const faucetX = centerX + (bowlsMinX + bowlsMaxX) / 2
  const faucetZ = centerZ - bowls[0]!.depth / 2 - FAUCET_SETBACK
  addFaucet(group, faucetX, faucetZ, rimY + countertopThickness, name)
}
