import {
  AdditiveBlending,
  BoxGeometry,
  CylinderGeometry,
  DoubleSide,
  type Float32BufferAttribute,
  Group,
  Mesh,
  MeshBasicMaterial,
  RingGeometry,
  SphereGeometry,
  TorusGeometry,
} from 'three'
import {
  COOKTOP_FLAME_COUNT,
  cooktopFlameSeed,
  createCooktopFlameGeometry,
  updateCooktopFlameTube,
} from '../cooktop-flame'
import {
  type CabinetCompartment,
  type CabinetCooktopCompartmentType,
  type CooktopLayout,
  compartmentCooktopActiveBurners,
  compartmentCooktopBurnersOn,
  compartmentCooktopKnobProgress,
  compartmentCooktopLayout,
  compartmentCooktopShowGrate,
} from '../stack'
import {
  addBox,
  applianceDisplayMaterial,
  type CabinetGeometryNode,
  cooktopBurnerMaterial,
  cooktopGlassMaterial,
  cooktopGrateMaterial,
  cooktopInductionActiveZoneMaterial,
  cooktopInductionZoneMaterial,
  cooktopKnobHitMaterial,
  cooktopKnobOnMaterial,
  cooktopTrimMaterial,
  stampSlot,
} from './shared'

const GAS_HOB_BURNER_RADIUS = 0.052
type CooktopBurnerSpec = { x: number; z: number; size: number }
const GAS_HOB_BURNER_LAYOUTS: Record<
  Extract<CooktopLayout, 'gas-2burner' | 'gas-4burner' | 'gas-5burner-wok' | 'gas-6burner'>,
  CooktopBurnerSpec[]
> = {
  'gas-2burner': [
    { x: -0.11, z: 0, size: 1 },
    { x: 0.11, z: 0, size: 1 },
  ],
  'gas-4burner': [
    { x: -0.144, z: -0.096, size: 1 },
    { x: -0.144, z: 0.096, size: 0.85 },
    { x: 0.144, z: -0.096, size: 0.85 },
    { x: 0.144, z: 0.096, size: 1 },
  ],
  'gas-5burner-wok': [
    { x: -0.24, z: -0.11, size: 0.85 },
    { x: 0.24, z: -0.11, size: 1 },
    { x: -0.24, z: 0.11, size: 1 },
    { x: 0.24, z: 0.11, size: 0.85 },
    { x: 0, z: 0, size: 1.5 },
  ],
  'gas-6burner': [
    { x: -0.3, z: -0.11, size: 1 },
    { x: 0, z: -0.11, size: 0.85 },
    { x: 0.3, z: -0.11, size: 1 },
    { x: -0.3, z: 0.11, size: 0.85 },
    { x: 0, z: 0.11, size: 1 },
    { x: 0.3, z: 0.11, size: 0.85 },
  ],
}
type InductionZoneSpec = { x: number; z: number; radius: number; w?: number; d?: number }
const INDUCTION_ZONE_LAYOUTS: Record<
  Extract<CooktopLayout, 'induction-2zone' | 'induction-4zone'>,
  InductionZoneSpec[]
> = {
  'induction-2zone': [
    { x: -0.13, z: 0, radius: 0.072 },
    { x: 0.13, z: 0, radius: 0.072 },
  ],
  'induction-4zone': [
    { x: -0.18, z: 0.108, radius: 0.066 },
    { x: 0.18, z: 0.108, radius: 0.054 },
    { x: -0.18, z: -0.108, radius: 0.054 },
    { x: 0.18, z: -0.108, radius: 0.066 },
  ],
}
function gasHobBurners(layout: CooktopLayout): CooktopBurnerSpec[] {
  return layout in GAS_HOB_BURNER_LAYOUTS
    ? GAS_HOB_BURNER_LAYOUTS[
        layout as Extract<
          CooktopLayout,
          'gas-2burner' | 'gas-4burner' | 'gas-5burner-wok' | 'gas-6burner'
        >
      ]
    : GAS_HOB_BURNER_LAYOUTS['gas-5burner-wok']
}

function inductionZones(layout: CooktopLayout): InductionZoneSpec[] {
  return layout in INDUCTION_ZONE_LAYOUTS
    ? INDUCTION_ZONE_LAYOUTS[
        layout as Extract<CooktopLayout, 'induction-2zone' | 'induction-4zone'>
      ]
    : INDUCTION_ZONE_LAYOUTS['induction-4zone']
}

function addCooktopFrameBorder(
  group: Group,
  name: string,
  width: number,
  depth: number,
  y: number,
) {
  const t = 0.014
  const h = 0.012
  addBox(
    group,
    [width, h, t],
    [0, y, -depth / 2 + t / 2],
    cooktopTrimMaterial,
    `${name}-frame-back`,
    'appliance',
  )
  addBox(
    group,
    [width, h, t],
    [0, y, depth / 2 - t / 2],
    cooktopTrimMaterial,
    `${name}-frame-front`,
    'appliance',
  )
  addBox(
    group,
    [t, h, depth - 2 * t],
    [-width / 2 + t / 2, y, 0],
    cooktopTrimMaterial,
    `${name}-frame-left`,
    'appliance',
  )
  addBox(
    group,
    [t, h, depth - 2 * t],
    [width / 2 - t / 2, y, 0],
    cooktopTrimMaterial,
    `${name}-frame-right`,
    'appliance',
  )
}

function addGasHobBurner(
  group: Group,
  name: string,
  center: [number, number, number],
  size: number,
  burnerIndex: number,
  active: boolean,
  progress: number,
) {
  const r = GAS_HOB_BURNER_RADIUS * size
  const [x, y, z] = center
  const base = stampSlot(
    new Mesh(new CylinderGeometry(r, r * 1.1, 0.012, 28), cooktopBurnerMaterial),
    'appliance',
  )
  base.name = `${name}-burner-${burnerIndex}-base`
  base.position.set(x, y, z)
  base.castShadow = true
  base.receiveShadow = true
  group.add(base)

  const ring = stampSlot(
    new Mesh(new TorusGeometry(r * 0.72, 0.011, 10, 30), cooktopGrateMaterial),
    'appliance',
  )
  ring.name = `${name}-burner-${burnerIndex}-ring`
  ring.rotation.x = Math.PI / 2
  ring.position.set(x, y + 0.012, z)
  ring.castShadow = true
  group.add(ring)

  const cap = stampSlot(
    new Mesh(new CylinderGeometry(r * 0.48, r * 0.6, 0.012, 24), cooktopGrateMaterial),
    'hardware',
  )
  cap.name = `${name}-burner-${burnerIndex}-cap`
  cap.position.set(x, y + 0.017, z)
  cap.castShadow = true
  group.add(cap)

  if (active || progress > 0.04) {
    addCooktopCurvedFlames(group, name, x, y, z, r, burnerIndex, progress)
  }
}

function addContinuousCooktopGrate(
  group: Group,
  name: string,
  width: number,
  depth: number,
  y: number,
  burners: CooktopBurnerSpec[],
) {
  const t = 0.011
  const bar = 0.008
  addBox(
    group,
    [width, bar, t],
    [0, y, -depth / 2 + t / 2],
    cooktopGrateMaterial,
    `${name}-continuous-grate-back`,
    'appliance',
  )
  addBox(
    group,
    [width, bar, t],
    [0, y, depth / 2 - t / 2],
    cooktopGrateMaterial,
    `${name}-continuous-grate-front`,
    'appliance',
  )
  addBox(
    group,
    [t, bar, depth],
    [-width / 2 + t / 2, y, 0],
    cooktopGrateMaterial,
    `${name}-continuous-grate-left`,
    'appliance',
  )
  addBox(
    group,
    [t, bar, depth],
    [width / 2 - t / 2, y, 0],
    cooktopGrateMaterial,
    `${name}-continuous-grate-right`,
    'appliance',
  )

  const rowZs = [...new Set(burners.map((burner) => Number(burner.z.toFixed(3))))].sort(
    (a, b) => a - b,
  )
  const colXs = [...new Set(burners.map((burner) => Number(burner.x.toFixed(3))))].sort(
    (a, b) => a - b,
  )
  for (let i = 0; i < rowZs.length - 1; i += 1) {
    addBox(
      group,
      [width, bar, t],
      [0, y, (rowZs[i]! + rowZs[i + 1]!) / 2],
      cooktopGrateMaterial,
      `${name}-continuous-grate-row-${i}`,
      'appliance',
    )
  }
  for (let i = 0; i < colXs.length - 1; i += 1) {
    addBox(
      group,
      [t, bar, depth],
      [(colXs[i]! + colXs[i + 1]!) / 2, y, 0],
      cooktopGrateMaterial,
      `${name}-continuous-grate-column-${i}`,
      'appliance',
    )
  }
}

function createCooktopFlameMaterial(color: string, opacity: number) {
  return new MeshBasicMaterial({
    color,
    transparent: true,
    opacity,
    blending: AdditiveBlending,
    depthWrite: false,
    toneMapped: false,
    side: DoubleSide,
  })
}

function createCooktopFlameBodyMaterial() {
  return new MeshBasicMaterial({
    vertexColors: true,
    transparent: true,
    opacity: 0.92,
    blending: AdditiveBlending,
    depthWrite: false,
    toneMapped: false,
    side: DoubleSide,
  })
}

function addCooktopCurvedFlames(
  group: Group,
  name: string,
  x: number,
  y: number,
  z: number,
  radius: number,
  burnerIndex: number,
  progress: number,
) {
  const flameRoot = new Group()
  flameRoot.name = `${name}-burner-${burnerIndex}-flames`
  flameRoot.position.set(x, y + 0.028, z)
  flameRoot.userData.cabinetFlameRoot = { progress }
  flameRoot.scale.setScalar(Math.max(0.18, progress))
  group.add(flameRoot)

  // Faint heat shimmer only — anything stronger reads as a solid dome that
  // hides the flames inside it.
  const halo = stampSlot(
    new Mesh(
      new SphereGeometry(radius * 1.08, 14, 10),
      createCooktopFlameMaterial('#ff7a3a', 0.05),
    ),
    'appliance',
  )
  halo.name = `${name}-burner-${burnerIndex}-flame-halo`
  halo.userData.cabinetFlamePulse = { phase: 0.2, amplitude: 0.05, base: 1 }
  halo.userData.cabinetFlameMaterialPulse = { phase: 1.1, base: 0.05, amplitude: 0.015 }
  flameRoot.add(halo)

  // Flat ignition glow lapping the burner crown (not a torus — reads as the
  // hot ring at the base of the flames in reference photos).
  const ring = stampSlot(
    new Mesh(
      new RingGeometry(radius * 0.25, radius * 0.95, 32),
      createCooktopFlameMaterial('#ff8838', 0.6),
    ),
    'appliance',
  )
  ring.name = `${name}-burner-${burnerIndex}-flame-ring`
  ring.rotation.x = -Math.PI / 2
  ring.position.y = 0.001
  ring.userData.cabinetFlameMaterialPulse = { phase: 1.7, base: 0.55, amplitude: 0.1 }
  flameRoot.add(ring)

  const core = stampSlot(
    new Mesh(new SphereGeometry(radius * 0.34, 14, 10), createCooktopFlameMaterial('#7eb8ff', 0.6)),
    'appliance',
  )
  core.name = `${name}-burner-${burnerIndex}-flame-core`
  core.position.y = 0.022
  core.userData.cabinetFlamePulse = { phase: 0.8, amplitude: 0.08, base: 0.95 }
  core.userData.cabinetFlameMaterialPulse = { phase: 0.8, base: 0.55, amplitude: 0.08 }
  flameRoot.add(core)

  for (let flameIndex = 0; flameIndex < COOKTOP_FLAME_COUNT; flameIndex += 1) {
    const angle = (Math.PI * 2 * flameIndex) / COOKTOP_FLAME_COUNT
    const seed = cooktopFlameSeed(flameIndex)
    const flameGroup = new Group()
    flameGroup.name = `${name}-burner-${burnerIndex}-flame-${flameIndex}`
    flameGroup.position.set(Math.cos(angle) * radius * 0.55, 0, Math.sin(angle) * radius * 0.55)
    flameGroup.rotation.y = -angle

    const geometry = createCooktopFlameGeometry()
    const positions = geometry.getAttribute('position') as Float32BufferAttribute
    // Bake a resting pose so static builds (tests, screenshots) show flames
    // even before the animation system's first tick.
    updateCooktopFlameTube(positions.array as Float32Array, 0, seed, radius)
    const body = stampSlot(new Mesh(geometry, createCooktopFlameBodyMaterial()), 'appliance')
    body.name = `${name}-burner-${burnerIndex}-flame-${flameIndex}-body`
    body.userData.cabinetFlameJet = { seed, burnerR: radius }
    flameGroup.add(body)

    flameRoot.add(flameGroup)
  }
}

function addInductionZone(
  group: Group,
  name: string,
  zone: InductionZoneSpec,
  y: number,
  zoneIndex: number,
  active: boolean,
) {
  const material = active ? cooktopInductionActiveZoneMaterial : cooktopInductionZoneMaterial
  if (zone.w && zone.d) {
    addBox(
      group,
      [zone.w, 0.002, zone.d],
      [zone.x, y, zone.z],
      material,
      `${name}-zone-${zoneIndex}-flex-pad`,
      'appliance',
    )
  }

  const fill = stampSlot(
    new Mesh(new CylinderGeometry(zone.radius * 0.92, zone.radius * 0.92, 0.002, 64), material),
    'appliance',
  )
  fill.name = `${name}-zone-${zoneIndex}-fill`
  fill.position.set(zone.x, y + 0.001, zone.z)
  group.add(fill)

  for (let ringIndex = 0; ringIndex < 3; ringIndex += 1) {
    const ring = stampSlot(
      new Mesh(new TorusGeometry(zone.radius * (1 - ringIndex * 0.24), 0.0022, 8, 72), material),
      'appliance',
    )
    ring.name = `${name}-zone-${zoneIndex}-ring-${ringIndex}`
    ring.rotation.x = Math.PI / 2
    ring.position.set(zone.x, y + 0.003 + ringIndex * 0.0006, zone.z)
    group.add(ring)
  }
}

export function addCooktopCompartment(
  group: Group,
  node: CabinetGeometryNode,
  compartment: CabinetCompartment,
  type: CabinetCooktopCompartmentType,
  topY: number,
  index: number,
) {
  const layout = compartmentCooktopLayout(compartment, type)
  const activeBurners = new Set(compartmentCooktopActiveBurners(compartment, type))
  const knobProgress = compartmentCooktopKnobProgress(compartment, type)
  const burnersOn = activeBurners.size > 0 || compartmentCooktopBurnersOn(compartment)
  const name =
    type === 'cooktop-gas' ? `cabinet-cooktop-gas-${index}` : `cabinet-cooktop-induction-${index}`
  const frameWidth = Math.max(0.32, Math.min(node.width - 0.01, 0.76))
  const frameDepth = Math.max(0.28, Math.min(node.depth - 0.04, 0.53))
  const surfaceWidth = Math.max(0.28, frameWidth - 0.026)
  const surfaceDepth = Math.max(0.24, frameDepth - 0.026)
  const surfaceThickness = 0.012
  const surfaceY = topY + surfaceThickness / 2 - 0.002
  addCooktopFrameBorder(group, name, frameWidth, frameDepth, topY + 0.006)
  const surface = stampSlot(
    new Mesh(new BoxGeometry(surfaceWidth, surfaceThickness, surfaceDepth), cooktopGlassMaterial),
    'appliance',
  )
  surface.name = `${name}-surface`
  surface.position.set(0, surfaceY, 0)
  surface.castShadow = true
  surface.receiveShadow = true
  group.add(surface)

  if (type === 'cooktop-gas') {
    const burners = gasHobBurners(layout)
    burners.forEach((burner, burnerIndex) => {
      const progress = knobProgress[burnerIndex] ?? (activeBurners.has(burnerIndex) ? 1 : 0)
      addGasHobBurner(
        group,
        name,
        [burner.x, topY + surfaceThickness + 0.004, burner.z],
        burner.size,
        burnerIndex,
        activeBurners.has(burnerIndex),
        progress,
      )
    })
    if (compartmentCooktopShowGrate(compartment)) {
      addContinuousCooktopGrate(
        group,
        name,
        surfaceWidth + 0.02,
        surfaceDepth + 0.02,
        topY + surfaceThickness + 0.036,
        burners,
      )
    }

    const knobMargin = 0.06
    const knobSpan = surfaceWidth - knobMargin * 2
    const knobStep = knobSpan / Math.max(1, burners.length - 1)
    const knobZ = surfaceDepth * 0.42
    for (let knobIndex = 0; knobIndex < burners.length; knobIndex += 1) {
      const knobX = -knobSpan / 2 + knobIndex * knobStep
      const progress = knobProgress[knobIndex] ?? (activeBurners.has(knobIndex) ? 1 : 0)
      const knobAngle = -2.3 * progress
      const knobUserData = {
        type: 'gas',
        compartmentIndex: index,
        burnerIndex: knobIndex,
      }
      const hit = stampSlot(
        new Mesh(new CylinderGeometry(0.03, 0.03, 0.06, 12), cooktopKnobHitMaterial),
        'hardware',
      )
      hit.name = `${name}-knob-${knobIndex}-hit`
      hit.position.set(knobX, topY + surfaceThickness + 0.019, knobZ)
      hit.userData.cabinetCooktopKnob = knobUserData
      group.add(hit)

      const collar = stampSlot(
        new Mesh(new CylinderGeometry(0.016, 0.018, 0.006, 20), cooktopTrimMaterial),
        'hardware',
      )
      collar.name = `${name}-knob-${knobIndex}-collar`
      collar.position.set(knobX, topY + surfaceThickness + 0.006, knobZ)
      collar.userData.cabinetCooktopKnob = knobUserData
      group.add(collar)

      const knob = stampSlot(
        new Mesh(new CylinderGeometry(0.012, 0.015, 0.02, 20), cooktopGrateMaterial),
        'hardware',
      )
      knob.name = `${name}-knob-${knobIndex}`
      knob.position.set(knobX, topY + surfaceThickness + 0.019, knobZ)
      knob.rotation.y = knobAngle
      knob.userData.cabinetCooktopKnob = knobUserData
      knob.castShadow = true
      group.add(knob)

      // Child of the knob so it turns with it and keeps pointing radially.
      const notch = stampSlot(
        new Mesh(
          new BoxGeometry(0.003, 0.004, 0.011),
          progress > 0.5 ? cooktopKnobOnMaterial : cooktopTrimMaterial,
        ),
        'hardware',
      )
      notch.name = `${name}-knob-${knobIndex}-notch`
      notch.position.set(0, 0.012, 0.011)
      knob.add(notch)
    }
    return
  }

  const zones = inductionZones(layout)
  zones.forEach((zone, zoneIndex) => {
    addInductionZone(
      group,
      name,
      zone,
      topY + surfaceThickness + 0.002,
      zoneIndex,
      activeBurners.has(zoneIndex),
    )
  })

  const controlBar = stampSlot(
    new Mesh(
      new BoxGeometry(Math.min(0.24, surfaceWidth * 0.38), 0.003, 0.012),
      applianceDisplayMaterial,
    ),
    'appliance',
  )
  controlBar.name = `${name}-touch-control-bar`
  controlBar.position.set(0, topY + surfaceThickness + 0.003, surfaceDepth / 2 - 0.045)
  group.add(controlBar)
  for (let dotIndex = 0; dotIndex < zones.length + 2; dotIndex += 1) {
    const dot = stampSlot(
      new Mesh(
        new CylinderGeometry(0.005, 0.005, 0.002, 14),
        burnersOn ? cooktopInductionActiveZoneMaterial : cooktopInductionZoneMaterial,
      ),
      'appliance',
    )
    dot.name = `${name}-touch-dot-${dotIndex}`
    dot.position.set(
      -0.015 * (zones.length + 1) + dotIndex * 0.03,
      topY + surfaceThickness + 0.005,
      surfaceDepth / 2 - 0.066,
    )
    group.add(dot)
  }
}
