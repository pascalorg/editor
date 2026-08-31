import { BoxGeometry, Group, Mesh, type Object3D } from 'three'
import type { CabinetFridgeCompartmentType } from '../stack'
import {
  addApplianceHandle,
  addBox,
  applianceDisplayMaterial,
  type CabinetGeometryNode,
  type CabinetSlotMaterials,
  microwaveScreenMaterial,
  refrigeratorBinMaterial,
  refrigeratorBrassAccentMaterial,
  refrigeratorDarkTrimMaterial,
  refrigeratorDrawerMaterial,
  refrigeratorLightMaterial,
  refrigeratorLinerAccentMaterial,
  refrigeratorLinerMaterial,
  refrigeratorSealMaterial,
  refrigeratorSilverMaterial,
  refrigeratorWaterMaterial,
  roundedButtonGeometry,
  stampSlot,
} from './shared'

type FridgeSection = 'fresh' | 'freezer'

function addFridgeWireBasket(
  group: Group,
  materials: CabinetSlotMaterials,
  x: number,
  width: number,
  depth: number,
  y: number,
  zCenter: number,
  name: string,
) {
  const bar = 0.006
  const railHeight = 0.07
  const frame: Array<{ size: [number, number, number]; position: [number, number, number] }> = [
    { size: [width, bar, bar], position: [x, y, zCenter + depth / 2 - bar / 2] },
    { size: [width, bar, bar], position: [x, y, zCenter - depth / 2 + bar / 2] },
    {
      size: [bar, railHeight, depth],
      position: [x - width / 2 + bar / 2, y - railHeight / 2, zCenter],
    },
    {
      size: [bar, railHeight, depth],
      position: [x + width / 2 - bar / 2, y - railHeight / 2, zCenter],
    },
  ]
  frame.forEach((piece, i) => {
    addBox(
      group,
      piece.size,
      piece.position,
      refrigeratorLinerAccentMaterial,
      `${name}-frame-${i}`,
      'applianceInterior',
    )
  })
  for (let i = 1; i <= 7; i += 1) {
    const barX = x - width / 2 + (width * i) / 8
    addBox(
      group,
      [0.004, railHeight * 0.82, Math.max(0.01, depth - bar * 2)],
      [barX, y - railHeight / 2, zCenter],
      refrigeratorLinerAccentMaterial,
      `${name}-bar-${i}`,
      'applianceInterior',
    )
  }
}

function addFridgeControlStrip(
  group: Group,
  materials: CabinetSlotMaterials,
  x: number,
  y: number,
  z: number,
  width: number,
  name: string,
) {
  const stripWidth = Math.min(0.32, width * 0.72)
  addBox(
    group,
    [stripWidth, 0.028, 0.012],
    [x, y, z],
    refrigeratorLinerAccentMaterial,
    `${name}-control-strip`,
    'applianceInterior',
  )
  const displayWidth = stripWidth * 0.2
  addBox(
    group,
    [displayWidth, 0.014, 0.006],
    [x - stripWidth * 0.26, y, z + 0.008],
    applianceDisplayMaterial,
    `${name}-control-display`,
    'appliance',
  )
  for (let i = 0; i < 5; i += 1) {
    addBox(
      group,
      [0.018, 0.012, 0.006],
      [x - stripWidth * 0.04 + i * 0.026, y, z + 0.008],
      materials.appliance,
      `${name}-control-button-${i}`,
      'appliance',
    )
  }
}

function addFridgeIceMaker(
  group: Group,
  materials: CabinetSlotMaterials,
  x: number,
  y: number,
  zCenter: number,
  width: number,
  depth: number,
  name: string,
) {
  const boxWidth = Math.min(width * 0.72, 0.2)
  const boxHeight = 0.09
  const boxDepth = Math.min(depth * 0.42, 0.16)
  addBox(
    group,
    [boxWidth, boxHeight, boxDepth],
    [x, y, zCenter - depth * 0.22],
    refrigeratorDrawerMaterial,
    `${name}-ice-maker-box`,
    'applianceInterior',
  )
  addBox(
    group,
    [boxWidth * 0.74, 0.014, 0.012],
    [x, y - boxHeight * 0.18, zCenter - depth * 0.22 + boxDepth / 2 + 0.008],
    materials.appliance,
    `${name}-ice-maker-pull`,
    'appliance',
  )
}

function addFridgeVentSlats(
  group: Object3D,
  x: number,
  y: number,
  z: number,
  width: number,
  name: string,
) {
  const slatWidth = Math.max(0.04, width * 0.12)
  const gap = slatWidth * 1.35
  for (let i = 0; i < 5; i += 1) {
    const slat = stampSlot(
      new Mesh(new BoxGeometry(slatWidth, 0.005, 0.005), refrigeratorDarkTrimMaterial),
      'appliance',
    )
    slat.name = `${name}-vent-${i}`
    slat.position.set(x - gap * 2 + i * gap, y, z + 0.004)
    group.add(slat)
  }
}

function addFridgeShelfAssembly(
  group: Group,
  materials: CabinetSlotMaterials,
  x: number,
  y: number,
  zCenter: number,
  width: number,
  depth: number,
  name: string,
) {
  const shelfThickness = 0.008
  const rail = 0.008
  addBox(group, [width, shelfThickness, depth], [x, y, zCenter], materials.glass, name, 'glass')
  addBox(
    group,
    [width + rail, rail, rail],
    [x, y + shelfThickness / 2 + rail / 2, zCenter + depth / 2 - rail / 2],
    refrigeratorLinerAccentMaterial,
    `${name}-front-lip`,
    'applianceInterior',
  )
  addBox(
    group,
    [rail, rail, depth],
    [x - width / 2 + rail / 2, y + shelfThickness / 2 + rail / 2, zCenter],
    refrigeratorLinerAccentMaterial,
    `${name}-left-rim`,
    'applianceInterior',
  )
  addBox(
    group,
    [rail, rail, depth],
    [x + width / 2 - rail / 2, y + shelfThickness / 2 + rail / 2, zCenter],
    refrigeratorLinerAccentMaterial,
    `${name}-right-rim`,
    'applianceInterior',
  )
}

function addFridgeShelfRails(
  group: Group,
  x: number,
  y: number,
  zCenter: number,
  width: number,
  depth: number,
  name: string,
) {
  const railWidth = 0.012
  const railHeight = 0.012
  for (const side of [-1, 1]) {
    addBox(
      group,
      [railWidth, railHeight, depth * 0.82],
      [x + side * (width / 2 - railWidth / 2), y - 0.006, zCenter - depth * 0.02],
      refrigeratorLinerAccentMaterial,
      `${name}-${side < 0 ? 'left' : 'right'}-support`,
      'applianceInterior',
    )
  }
}

function addFridgeLinerRibs(
  group: Group,
  x: number,
  y: number,
  zCenter: number,
  width: number,
  height: number,
  depth: number,
  name: string,
) {
  const ribWidth = 0.007
  const ribHeight = Math.max(0.04, height * 0.74)
  const ribDepth = 0.01
  for (const side of [-1, 1]) {
    for (let i = 0; i < 3; i += 1) {
      addBox(
        group,
        [ribWidth, ribHeight, ribDepth],
        [
          x + side * (width / 2 - ribWidth / 2),
          y - height * 0.02,
          zCenter - depth * 0.27 + i * depth * 0.2,
        ],
        refrigeratorLinerAccentMaterial,
        `${name}-${side < 0 ? 'left' : 'right'}-liner-rib-${i}`,
        'applianceInterior',
      )
    }
  }
}

function addFridgeRearDiffuser(
  group: Group,
  x: number,
  y: number,
  z: number,
  width: number,
  height: number,
  name: string,
) {
  const diffuserWidth = Math.min(0.18, width * 0.42)
  const diffuserHeight = Math.min(0.52, height * 0.46)
  addBox(
    group,
    [diffuserWidth, diffuserHeight, 0.008],
    [x, y + height * 0.08, z],
    refrigeratorLinerAccentMaterial,
    `${name}-rear-diffuser-panel`,
    'applianceInterior',
  )

  const channelWidth = diffuserWidth * 0.72
  for (let i = 0; i < 4; i += 1) {
    addBox(
      group,
      [channelWidth, 0.006, 0.006],
      [x, y + height * 0.22 - i * diffuserHeight * 0.16, z + 0.006],
      refrigeratorLightMaterial,
      `${name}-rear-diffuser-channel-${i}`,
      'applianceInterior',
    )
  }

  addBox(
    group,
    [0.012, diffuserHeight * 0.88, 0.006],
    [x - diffuserWidth / 2 + 0.018, y + height * 0.08, z + 0.006],
    refrigeratorLinerAccentMaterial,
    `${name}-rear-diffuser-left-spine`,
    'applianceInterior',
  )
  addBox(
    group,
    [0.012, diffuserHeight * 0.88, 0.006],
    [x + diffuserWidth / 2 - 0.018, y + height * 0.08, z + 0.006],
    refrigeratorLinerAccentMaterial,
    `${name}-rear-diffuser-right-spine`,
    'applianceInterior',
  )
}

function addFridgeCrisperDrawer(
  group: Group,
  materials: CabinetSlotMaterials,
  x: number,
  y: number,
  zCenter: number,
  width: number,
  height: number,
  depth: number,
  name: string,
) {
  const wall = 0.008
  addBox(
    group,
    [width, height, depth],
    [x, y, zCenter],
    refrigeratorDrawerMaterial,
    name,
    'applianceInterior',
  )
  addBox(
    group,
    [width + wall * 2, wall, depth + wall],
    [x, y + height / 2 + wall / 2, zCenter],
    refrigeratorLinerAccentMaterial,
    `${name}-top-rim`,
    'applianceInterior',
  )
  addBox(
    group,
    [width * 0.72, 0.012, 0.01],
    [x, y + height * 0.12, zCenter + depth / 2 + 0.009],
    materials.appliance,
    `${name}-handle`,
    'appliance',
  )
  addBox(
    group,
    [width * 0.32, 0.004, 0.004],
    [x, y - height * 0.08, zCenter + depth / 2 + 0.014],
    refrigeratorLinerAccentMaterial,
    `${name}-label-plate`,
    'applianceInterior',
  )
  addBox(
    group,
    [width * 0.38, 0.006, 0.005],
    [x, y + height * 0.36, zCenter + depth / 2 + 0.015],
    refrigeratorLinerAccentMaterial,
    `${name}-humidity-track`,
    'applianceInterior',
  )
  addBox(
    group,
    [width * 0.12, 0.012, 0.008],
    [x + width * 0.13, y + height * 0.36, zCenter + depth / 2 + 0.019],
    materials.appliance,
    `${name}-humidity-slider`,
    'appliance',
  )
}

function addFridgeDoorShelf(
  leaf: Group,
  width: number,
  height: number,
  y: number,
  z: number,
  name: string,
  scale = 1,
) {
  const binWidth = Math.max(0.04, width * 0.72 * scale)
  const binDepth = Math.max(0.026, width * 0.09 * scale)
  const lipHeight = Math.max(0.026, height * 0.035 * scale)
  addBox(
    leaf,
    [binWidth, 0.012, binDepth],
    [0, y - lipHeight / 2, z],
    refrigeratorBinMaterial,
    `${name}-base`,
    'applianceInterior',
  )
  addBox(
    leaf,
    [binWidth, lipHeight, 0.012],
    [0, y, z - binDepth / 2],
    refrigeratorBinMaterial,
    name,
    'applianceInterior',
  )
  addBox(
    leaf,
    [0.012, lipHeight * 0.9, binDepth],
    [-binWidth / 2 + 0.006, y - lipHeight * 0.05, z],
    refrigeratorBinMaterial,
    `${name}-left-end`,
    'applianceInterior',
  )
  addBox(
    leaf,
    [0.012, lipHeight * 0.9, binDepth],
    [binWidth / 2 - 0.006, y - lipHeight * 0.05, z],
    refrigeratorBinMaterial,
    `${name}-right-end`,
    'applianceInterior',
  )
  addBox(
    leaf,
    [binWidth * 0.84, 0.008, 0.008],
    [0, y + lipHeight / 2 + 0.014, z - binDepth / 2 - 0.004],
    refrigeratorLinerAccentMaterial,
    `${name}-retainer`,
    'applianceInterior',
  )
}

function addFridgeDoorWireBasket(
  leaf: Group,
  materials: CabinetSlotMaterials,
  width: number,
  height: number,
  y: number,
  z: number,
  name: string,
) {
  const basketWidth = Math.max(0.04, width * 0.66)
  const basketHeight = Math.max(0.045, height * 0.055)
  const basketDepth = Math.max(0.026, width * 0.08)
  addBox(
    leaf,
    [basketWidth, 0.006, basketDepth],
    [0, y - basketHeight / 2, z],
    refrigeratorLinerAccentMaterial,
    `${name}-base-rail`,
    'applianceInterior',
  )
  addBox(
    leaf,
    [basketWidth, 0.006, 0.006],
    [0, y + basketHeight / 2, z - basketDepth / 2],
    refrigeratorLinerAccentMaterial,
    `${name}-top-rail`,
    'applianceInterior',
  )
  for (let i = 0; i < 6; i += 1) {
    addBox(
      leaf,
      [0.004, basketHeight, 0.004],
      [-basketWidth / 2 + (basketWidth * i) / 5, y, z - basketDepth / 2],
      refrigeratorLinerAccentMaterial,
      `${name}-wire-${i}`,
      'applianceInterior',
    )
  }
}

function addFridgeDoorStorage(
  leaf: Group,
  materials: CabinetSlotMaterials,
  width: number,
  height: number,
  z: number,
  name: string,
  section: FridgeSection,
) {
  if (section === 'freezer') {
    addBox(
      leaf,
      [width * 0.56, height * 0.055, width * 0.08],
      [0, height * 0.34, z],
      refrigeratorDrawerMaterial,
      `${name}-door-ice-box`,
      'applianceInterior',
    )
    for (let i = 0; i < 4; i += 1) {
      addFridgeDoorWireBasket(
        leaf,
        materials,
        width,
        height,
        height * 0.18 - i * height * 0.18,
        z,
        `${name}-door-wire-bin-${i}`,
      )
    }
    return
  }

  addBox(
    leaf,
    [width * 0.64, height * 0.065, width * 0.09],
    [0, height * 0.32, z],
    refrigeratorDrawerMaterial,
    `${name}-door-dairy-box`,
    'applianceInterior',
  )
  addBox(
    leaf,
    [width * 0.56, 0.01, 0.01],
    [0, height * 0.35, z - width * 0.045],
    refrigeratorLinerAccentMaterial,
    `${name}-door-dairy-cover`,
    'applianceInterior',
  )
  for (let i = 0; i < 3; i += 1) {
    addFridgeDoorShelf(
      leaf,
      width,
      height,
      height * 0.13 - i * height * 0.18,
      z,
      `${name}-door-bin-${i}`,
    )
  }
  addFridgeDoorShelf(leaf, width, height, -height * 0.41, z, `${name}-door-bottle-bin`, 1.12)
}

function addFridgeInterior(
  group: Group,
  materials: CabinetSlotMaterials,
  x: number,
  y: number,
  zCenter: number,
  width: number,
  height: number,
  depth: number,
  name: string,
  section: FridgeSection = 'fresh',
) {
  const shelfWidth = Math.max(0.04, width - 0.06)
  const shelfDepth = Math.max(0.04, depth - 0.08)
  addFridgeLinerRibs(group, x, y, zCenter, width, height, depth, name)
  addFridgeRearDiffuser(group, x, y, zCenter - depth / 2 + 0.018, width, height, name)

  if (section === 'fresh') {
    addFridgeControlStrip(
      group,
      materials,
      x,
      y + height / 2 - 0.055,
      zCenter - depth / 2 + 0.032,
      width,
      name,
    )
  }

  const shelfCount = section === 'freezer' ? 2 : 3
  for (let i = 1; i <= shelfCount; i += 1) {
    const shelfY = y - height / 2 + (height * i) / (shelfCount + 1.6)
    addFridgeShelfRails(group, x, shelfY, zCenter, width, depth, `${name}-${section}-rail-${i}`)
    addFridgeShelfAssembly(
      group,
      materials,
      x,
      shelfY,
      zCenter,
      shelfWidth,
      shelfDepth,
      `${name}-${section}-shelf-${i}`,
    )
  }

  if (section === 'freezer') {
    const basketHeight = Math.min(0.15, height * 0.22)
    addFridgeIceMaker(
      group,
      materials,
      x,
      y + height / 2 - Math.min(0.11, height * 0.16),
      zCenter,
      shelfWidth,
      shelfDepth,
      name,
    )
    addFridgeWireBasket(
      group,
      materials,
      x,
      shelfWidth * 0.86,
      shelfDepth * 0.82,
      y - height / 2 + basketHeight + 0.025,
      zCenter + shelfDepth * 0.05,
      `${name}-freezer-wire-basket`,
    )
    addBox(
      group,
      [shelfWidth * 0.86, basketHeight * 0.54, shelfDepth * 0.82],
      [x, y - height / 2 + basketHeight / 2 + 0.025, zCenter + shelfDepth * 0.05],
      refrigeratorDrawerMaterial,
      `${name}-freezer-basket`,
      'applianceInterior',
    )
    for (let i = 1; i <= 5; i += 1) {
      addBox(
        group,
        [0.004, basketHeight * 0.78, shelfDepth * 0.76],
        [
          x - shelfWidth * 0.34 + (shelfWidth * 0.68 * i) / 6,
          y - height / 2 + basketHeight / 2 + 0.025,
          zCenter + shelfDepth * 0.05,
        ],
        refrigeratorLinerAccentMaterial,
        `${name}-freezer-basket-divider-${i}`,
        'applianceInterior',
      )
    }
    return
  }

  const drawerHeight = Math.min(0.13, height * 0.12)
  const drawerWidth = Math.max(0.04, shelfWidth * 0.42)
  const drawerY = y - height / 2 + drawerHeight / 2 + 0.02
  for (let i = 0; i < 2; i += 1) {
    const drawerX = x + (i === 0 ? -1 : 1) * drawerWidth * 0.58
    addFridgeCrisperDrawer(
      group,
      materials,
      drawerX,
      drawerY,
      zCenter + shelfDepth * 0.08,
      drawerWidth,
      drawerHeight,
      shelfDepth * 0.72,
      `${name}-crisper-drawer-${i}`,
    )
  }

  const deliHeight = Math.min(0.08, height * 0.07)
  addBox(
    group,
    [shelfWidth * 0.86, deliHeight, shelfDepth * 0.66],
    [x, drawerY + drawerHeight / 2 + deliHeight / 2 + 0.025, zCenter + shelfDepth * 0.04],
    refrigeratorDrawerMaterial,
    `${name}-deli-drawer`,
    'applianceInterior',
  )
  addBox(
    group,
    [shelfWidth * 0.68, 0.01, 0.01],
    [x, drawerY + drawerHeight / 2 + deliHeight * 0.62 + 0.025, zCenter + shelfDepth * 0.38],
    materials.appliance,
    `${name}-deli-drawer-handle`,
    'appliance',
  )

  const lamp = stampSlot(
    new Mesh(
      roundedButtonGeometry(Math.min(0.12, width * 0.25), 0.02, 0.012, 0.006),
      refrigeratorLightMaterial,
    ),
    'applianceInterior',
  )
  lamp.name = `${name}-fresh-light`
  lamp.position.set(x, y + height / 2 - 0.04, zCenter - depth / 2 + 0.04)
  group.add(lamp)
}

function addFridgeDoorCues(leaf: Group, width: number, height: number, name: string) {
  const badge = stampSlot(
    new Mesh(
      roundedButtonGeometry(Math.min(0.09, width * 0.24), 0.018, 0.004, 0.004),
      refrigeratorBrassAccentMaterial,
    ),
    'appliance',
  )
  badge.name = `${name}-badge`
  badge.position.set(0, height / 2 - 0.09, 0.025)
  leaf.add(badge)

  if (width < 0.28 || height < 0.72) return

  const dispenserWidth = Math.min(0.16, width * 0.42)
  const dispenserHeight = Math.min(0.24, height * 0.16)
  const dispenser = stampSlot(
    new Mesh(
      roundedButtonGeometry(dispenserWidth, dispenserHeight, 0.01, dispenserWidth * 0.08),
      microwaveScreenMaterial,
    ),
    'appliance',
  )
  dispenser.name = `${name}-water-dispenser`
  dispenser.position.set(0, height * 0.12, 0.03)
  leaf.add(dispenser)

  const spout = stampSlot(
    new Mesh(new BoxGeometry(dispenserWidth * 0.34, 0.012, 0.01), refrigeratorDarkTrimMaterial),
    'appliance',
  )
  spout.name = `${name}-ice-spout`
  spout.position.set(0, height * 0.12 + dispenserHeight * 0.24, 0.039)
  leaf.add(spout)

  const dripTray = stampSlot(
    new Mesh(new BoxGeometry(dispenserWidth * 0.68, 0.012, 0.012), refrigeratorWaterMaterial),
    'appliance',
  )
  dripTray.name = `${name}-blue-drip-tray`
  dripTray.position.set(0, height * 0.12 - dispenserHeight * 0.32, 0.041)
  leaf.add(dripTray)
}

function addFridgeLeaf(
  group: Group,
  materials: CabinetSlotMaterials,
  width: number,
  height: number,
  hinge: 'left' | 'right',
  centerX: number,
  centerY: number,
  frontZ: number,
  name: string,
  section: FridgeSection,
  openScale: number,
) {
  const hingeGroup = new Group()
  hingeGroup.name = `${name}-hinge`
  hingeGroup.position.set(
    hinge === 'left' ? centerX - width / 2 : centerX + width / 2,
    centerY,
    frontZ,
  )
  hingeGroup.rotation.y = (hinge === 'left' ? -1 : 1) * (Math.PI * 0.62) * openScale
  hingeGroup.userData.cabinetPose = {
    type: 'rotate',
    axis: 'y',
    angle: (hinge === 'left' ? -1 : 1) * (Math.PI * 0.62),
  }
  group.add(hingeGroup)

  const leaf = new Group()
  leaf.name = name
  leaf.position.set(hinge === 'left' ? width / 2 : -width / 2, 0, 0)
  hingeGroup.add(leaf)

  const panel = stampSlot(
    new Mesh(
      roundedButtonGeometry(width, height, 0.026, Math.min(width, height) * 0.035),
      refrigeratorSilverMaterial,
    ),
    'appliance',
  )
  panel.name = `${name}-panel`
  panel.castShadow = true
  panel.receiveShadow = true
  leaf.add(panel)

  const inset = Math.max(0.012, Math.min(width, height) * 0.025)
  addBox(
    leaf,
    [width - inset * 2, Math.max(0.01, height - inset * 2), 0.006],
    [0, 0, 0.017],
    materials.appliance,
    `${name}-brushed-center`,
    'appliance',
  )
  addFridgeDoorCues(leaf, width, height, name)

  const gasketWidth = Math.max(0.008, Math.min(width, height) * 0.018)
  addBox(
    leaf,
    [width, gasketWidth, 0.011],
    [0, height / 2 - gasketWidth / 2, -0.017],
    refrigeratorSealMaterial,
    `${name}-gasket-top`,
    'applianceInterior',
  )
  addBox(
    leaf,
    [width, gasketWidth, 0.011],
    [0, -height / 2 + gasketWidth / 2, -0.017],
    refrigeratorSealMaterial,
    `${name}-gasket-bottom`,
    'applianceInterior',
  )
  addBox(
    leaf,
    [gasketWidth, height, 0.011],
    [hinge === 'left' ? -width / 2 + gasketWidth / 2 : width / 2 - gasketWidth / 2, 0, -0.017],
    refrigeratorSealMaterial,
    `${name}-gasket-hinge`,
    'applianceInterior',
  )

  addApplianceHandle(
    leaf,
    refrigeratorBrassAccentMaterial,
    [(hinge === 'left' ? 1 : -1) * (width / 2 - 0.04), 0, 0.018],
    Math.min(0.72, height * 0.58),
    true,
    `${name}-handle`,
  )

  const hingeCapX = (hinge === 'left' ? -1 : 1) * (width / 2 - 0.03)
  for (const [capKey, capY] of [
    ['top', height / 2 - 0.012],
    ['bottom', -height / 2 + 0.012],
  ] as const) {
    addBox(
      leaf,
      [0.05, 0.018, 0.02],
      [hingeCapX, capY, 0.02],
      refrigeratorBrassAccentMaterial,
      `${name}-hinge-cap-${capKey}`,
      'appliance',
    )
  }
  addFridgeDoorStorage(leaf, materials, width, height, -0.035, name, section)
}

function fridgeDoorLayout(
  kind: CabinetFridgeCompartmentType,
  faceHeight: number,
): Array<{
  key: string
  y: number
  height: number
  widthFraction: number
  hinge: 'left' | 'right'
  xFraction: number
  section: FridgeSection
}> {
  if (kind === 'fridge-double') {
    return [
      {
        key: 'left',
        y: 0,
        height: faceHeight,
        widthFraction: 0.5,
        hinge: 'left',
        xFraction: -0.25,
        section: 'freezer',
      },
      {
        key: 'right',
        y: 0,
        height: faceHeight,
        widthFraction: 0.5,
        hinge: 'right',
        xFraction: 0.25,
        section: 'fresh',
      },
    ]
  }
  if (kind === 'fridge-top-freezer') {
    const freezerHeight = faceHeight * 0.34
    const fridgeHeight = faceHeight - freezerHeight
    return [
      {
        key: 'freezer',
        y: faceHeight / 2 - freezerHeight / 2,
        height: freezerHeight,
        widthFraction: 1,
        hinge: 'right',
        xFraction: 0,
        section: 'freezer',
      },
      {
        key: 'fresh',
        y: -faceHeight / 2 + fridgeHeight / 2,
        height: fridgeHeight,
        widthFraction: 1,
        hinge: 'right',
        xFraction: 0,
        section: 'fresh',
      },
    ]
  }
  if (kind === 'fridge-bottom-freezer') {
    const freezerHeight = faceHeight * 0.32
    const fridgeHeight = faceHeight - freezerHeight
    return [
      {
        key: 'fresh',
        y: faceHeight / 2 - fridgeHeight / 2,
        height: fridgeHeight,
        widthFraction: 1,
        hinge: 'right',
        xFraction: 0,
        section: 'fresh',
      },
      {
        key: 'freezer',
        y: -faceHeight / 2 + freezerHeight / 2,
        height: freezerHeight,
        widthFraction: 1,
        hinge: 'right',
        xFraction: 0,
        section: 'freezer',
      },
    ]
  }
  return [
    {
      key: 'single',
      y: 0,
      height: faceHeight,
      widthFraction: 1,
      hinge: 'right',
      xFraction: 0,
      section: 'fresh',
    },
  ]
}

export function addFridgeCompartment(
  group: Group,
  node: CabinetGeometryNode,
  materials: CabinetSlotMaterials,
  kind: CabinetFridgeCompartmentType,
  faceWidth: number,
  faceHeight: number,
  faceCenterY: number,
  openingWidth: number,
  openingDepth: number,
  frontZ: number,
  index: number,
) {
  const name = `cabinet-${kind}-${index}`
  const wall = Math.max(0.018, node.boardThickness)
  const shellInsetX = Math.max(0.04, Math.min(0.06, faceWidth * 0.065))
  const shellWidth = Math.max(0.05, faceWidth - shellInsetX * 2)
  const topClearance = node.boardThickness + 0.055
  const bottomClearance = Math.max(0.026, node.boardThickness * 0.85)
  const shellFaceHeight = Math.max(0.05, faceHeight - topClearance - bottomClearance)
  const shellCenterY = faceCenterY + (bottomClearance - topClearance) / 2
  const applianceFrontInset = Math.max(0.036, node.frontThickness + 0.018)
  const shellFrontZ = frontZ - applianceFrontInset
  const interiorDepth = Math.max(0.08, Math.min(0.56, openingDepth - 0.11))
  const cavityFrontZ = shellFrontZ - 0.012
  const cavityBackZ = cavityFrontZ - interiorDepth
  const cavityCenterZ = cavityBackZ + interiorDepth / 2
  const shellDepth = Math.max(0.12, Math.min(node.depth * 0.78, openingDepth - 0.085))
  const shellCenterZ = shellFrontZ - shellDepth / 2
  const shellSide = Math.max(0.018, Math.min(0.032, shellWidth * 0.04))
  const capHeight = Math.max(0.018, Math.min(0.04, faceHeight * 0.025))
  const kickHeight = Math.max(0.045, Math.min(0.075, faceHeight * 0.045))
  const seamGap = Math.max(0.0025, node.frontGap)
  const shellTopY = shellCenterY + shellFaceHeight / 2
  const shellBottomY = shellCenterY - shellFaceHeight / 2
  const sideTopY = shellTopY - capHeight - seamGap
  const sideBottomY = shellBottomY + kickHeight + seamGap
  const shellSideHeight = Math.max(0.05, sideTopY - sideBottomY)
  const shellSideCenterY = (sideTopY + sideBottomY) / 2
  const cavityOuterTopY = sideTopY - seamGap
  const cavityOuterBottomY = sideBottomY + seamGap
  const cavityOuterHeight = Math.max(0.05, cavityOuterTopY - cavityOuterBottomY)
  const cavityShellCenterY = (cavityOuterTopY + cavityOuterBottomY) / 2
  const interiorWidth = Math.max(
    0.05,
    Math.min(openingWidth, shellWidth) - shellSide * 2 - wall * 2,
  )
  const interiorHeight = Math.max(0.05, cavityOuterHeight - wall * 2)

  addBox(
    group,
    [shellSide, shellSideHeight, shellDepth],
    [-shellWidth / 2 + shellSide / 2, shellSideCenterY, shellCenterZ],
    materials.appliance,
    `${name}-appliance-side-left`,
    'appliance',
  )
  addBox(
    group,
    [shellSide, shellSideHeight, shellDepth],
    [shellWidth / 2 - shellSide / 2, shellSideCenterY, shellCenterZ],
    materials.appliance,
    `${name}-appliance-side-right`,
    'appliance',
  )
  addBox(
    group,
    [shellWidth, capHeight, shellDepth],
    [0, shellCenterY + shellFaceHeight / 2 - capHeight / 2, shellCenterZ],
    materials.appliance,
    `${name}-appliance-top-cap`,
    'appliance',
  )
  addBox(
    group,
    [shellWidth, kickHeight, shellDepth],
    [0, shellCenterY - shellFaceHeight / 2 + kickHeight / 2, shellCenterZ],
    refrigeratorDarkTrimMaterial,
    `${name}-appliance-toe-grille`,
    'appliance',
  )

  addBox(
    group,
    [interiorWidth + wall * 2, interiorHeight + wall * 2, wall],
    [0, cavityShellCenterY, cavityBackZ + wall / 2],
    refrigeratorLinerMaterial,
    `${name}-cavity-back`,
    'applianceInterior',
  )
  addBox(
    group,
    [interiorWidth + wall * 2, wall, interiorDepth],
    [0, cavityShellCenterY + interiorHeight / 2 + wall / 2, cavityCenterZ],
    refrigeratorLinerMaterial,
    `${name}-cavity-top`,
    'applianceInterior',
  )
  addBox(
    group,
    [interiorWidth + wall * 2, wall, interiorDepth],
    [0, cavityShellCenterY - interiorHeight / 2 - wall / 2, cavityCenterZ],
    refrigeratorLinerMaterial,
    `${name}-cavity-bottom`,
    'applianceInterior',
  )
  addBox(
    group,
    [wall, interiorHeight, interiorDepth],
    [-interiorWidth / 2 - wall / 2, cavityShellCenterY, cavityCenterZ],
    refrigeratorLinerMaterial,
    `${name}-cavity-left`,
    'applianceInterior',
  )
  addBox(
    group,
    [wall, interiorHeight, interiorDepth],
    [interiorWidth / 2 + wall / 2, cavityShellCenterY, cavityCenterZ],
    refrigeratorLinerMaterial,
    `${name}-cavity-right`,
    'applianceInterior',
  )
  const interiorRows = fridgeDoorLayout(kind, cavityOuterHeight - node.frontGap * 2)
  const layoutRows = fridgeDoorLayout(kind, shellFaceHeight - node.frontGap * 2)
  if (kind === 'fridge-double') {
    addBox(
      group,
      [wall, interiorHeight, interiorDepth],
      [0, cavityShellCenterY, cavityCenterZ],
      refrigeratorLinerMaterial,
      `${name}-center-divider`,
      'applianceInterior',
    )
  } else if (kind === 'fridge-top-freezer' || kind === 'fridge-bottom-freezer') {
    const divider = interiorRows.find((row) => row.key === 'freezer')
    if (divider) {
      const dividerY =
        kind === 'fridge-top-freezer'
          ? cavityShellCenterY + cavityOuterHeight / 2 - divider.height - node.frontGap
          : cavityShellCenterY - cavityOuterHeight / 2 + divider.height + node.frontGap
      addBox(
        group,
        [interiorWidth, wall, interiorDepth],
        [0, dividerY, cavityCenterZ],
        refrigeratorLinerMaterial,
        `${name}-horizontal-divider`,
        'applianceInterior',
      )
    }
  }

  for (const layout of interiorRows) {
    const sectionWidth = Math.max(0.05, interiorWidth * layout.widthFraction - wall)
    const sectionHeight = Math.max(0.05, layout.height - wall * 1.4)
    const sectionX = interiorWidth * layout.xFraction
    const sectionY = cavityShellCenterY + layout.y
    addFridgeInterior(
      group,
      materials,
      sectionX,
      sectionY,
      cavityCenterZ,
      sectionWidth,
      sectionHeight,
      interiorDepth,
      `${name}-${layout.key}`,
      layout.section,
    )
  }
  addFridgeVentSlats(
    group,
    0,
    shellCenterY - shellFaceHeight / 2 + 0.04,
    shellFrontZ + 0.01,
    shellWidth,
    name,
  )

  const doorGap = node.frontGap
  for (const layout of layoutRows) {
    const doorWidth = Math.max(0.01, shellWidth * layout.widthFraction - doorGap * 2)
    const doorHeight = Math.max(0.01, layout.height - doorGap * 2)
    const doorCenterX = shellWidth * layout.xFraction
    const doorCenterY = shellCenterY + layout.y
    addFridgeLeaf(
      group,
      materials,
      doorWidth,
      doorHeight,
      layout.hinge,
      doorCenterX,
      doorCenterY,
      frontZ,
      `${name}-door-${layout.key}`,
      layout.section,
      node.operationState ?? 0,
    )
  }
}
