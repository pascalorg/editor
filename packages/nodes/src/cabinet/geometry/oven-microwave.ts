import {
  BoxGeometry,
  CylinderGeometry,
  Group,
  type Material,
  Mesh,
  type Object3D,
  TorusGeometry,
} from 'three'
import {
  APPLIANCE_CAVITY_WALL,
  addApplianceHandle,
  addBox,
  addMicrowaveDisplaySegments,
  addWireRack,
  applianceLampMaterial,
  type CabinetGeometryNode,
  type CabinetSlotMaterials,
  microwaveButtonMaterial,
  microwaveCancelButtonMaterial,
  microwavePanelMaterial,
  microwaveScreenMaterial,
  microwaveStartButtonMaterial,
  OVEN_OPEN_ANGLE,
  ovenDialMaterial,
  ovenHeatElementMaterial,
  ovenIndicatorMaterial,
  ovenStatusLightMaterials,
  roundedButtonGeometry,
  stampSlot,
} from './shared'

function addMicrowaveVentSlats(
  group: Object3D,
  x: number,
  y: number,
  z: number,
  width: number,
  name: string,
) {
  const slatWidth = Math.max(0.018, width * 0.52)
  for (let i = 0; i < 5; i += 1) {
    const slat = stampSlot(
      new Mesh(new BoxGeometry(slatWidth, 0.0035, 0.004), microwaveScreenMaterial),
      'appliance',
    )
    slat.name = `${name}-vent-${i}`
    slat.position.set(x, y - i * 0.009, z + 0.002)
    group.add(slat)
  }
}

export function addMicrowaveButton(
  group: Object3D,
  x: number,
  y: number,
  z: number,
  width: number,
  height: number,
  material: Material,
  name: string,
) {
  const button = stampSlot(
    new Mesh(roundedButtonGeometry(width, height, 0.007, Math.min(width, height) * 0.28), material),
    'appliance',
  )
  button.name = name
  button.position.set(x, y, z + 0.004)
  button.castShadow = true
  group.add(button)

  const highlight = stampSlot(
    new Mesh(
      roundedButtonGeometry(width * 0.58, height * 0.16, 0.002, height * 0.06),
      microwaveScreenMaterial,
    ),
    'appliance',
  )
  highlight.name = `${name}-highlight`
  highlight.position.set(x, y + height * 0.22, z + 0.008)
  group.add(highlight)
}

function addMicrowaveControls(
  group: Object3D,
  x: number,
  y: number,
  z: number,
  panelWidth: number,
  panelHeight: number,
  name: string,
) {
  const shellWidth = panelWidth * 0.82
  const shellHeight = Math.min(panelHeight * 0.7, 0.27)
  const shellY = y
  const panelBack = stampSlot(
    new Mesh(
      roundedButtonGeometry(shellWidth, shellHeight, 0.004, panelWidth * 0.08),
      microwavePanelMaterial,
    ),
    'appliance',
  )
  panelBack.name = `${name}-control-panel`
  panelBack.position.set(x, shellY, z + 0.001)
  group.add(panelBack)

  const displayWidth = Math.min(0.085, panelWidth * 0.56)
  const displayHeight = Math.min(0.024, shellHeight * 0.12)
  const displayY = shellY + shellHeight * 0.32
  const display = stampSlot(
    new Mesh(
      roundedButtonGeometry(displayWidth, displayHeight, 0.004, displayHeight * 0.2),
      microwaveScreenMaterial,
    ),
    'appliance',
  )
  display.name = `${name}-display`
  display.position.set(x, displayY, z + 0.002)
  group.add(display)
  addMicrowaveDisplaySegments(group, x, displayY, z, displayWidth, name)

  const buttonSize = Math.max(0.009, Math.min(0.014, panelWidth * 0.105))
  const gap = buttonSize * 1.55
  const quickY = shellY + shellHeight * 0.18
  const startY = shellY + shellHeight * 0.04

  addMicrowaveButton(
    group,
    x - gap * 0.58,
    quickY,
    z,
    buttonSize * 1.1,
    buttonSize * 0.72,
    microwaveButtonMaterial,
    `${name}-quick-button-30s`,
  )
  addMicrowaveButton(
    group,
    x + gap * 0.58,
    quickY,
    z,
    buttonSize * 1.1,
    buttonSize * 0.72,
    microwaveButtonMaterial,
    `${name}-quick-button-power`,
  )

  for (let row = 0; row < 4; row += 1) {
    for (let col = 0; col < 3; col += 1) {
      addMicrowaveButton(
        group,
        x + (col - 1) * gap,
        startY - row * gap,
        z,
        buttonSize,
        buttonSize,
        microwaveButtonMaterial,
        `${name}-button-${row}-${col}`,
      )
    }
  }

  const actionY = startY - gap * 4.05
  addMicrowaveButton(
    group,
    x - gap * 0.62,
    actionY,
    z,
    buttonSize * 1.18,
    buttonSize * 0.82,
    microwaveCancelButtonMaterial,
    `${name}-cancel-button`,
  )
  addMicrowaveButton(
    group,
    x + gap * 0.62,
    actionY,
    z,
    buttonSize * 1.18,
    buttonSize * 0.82,
    microwaveStartButtonMaterial,
    `${name}-start-button`,
  )
}

function addOvenVentSlots(
  group: Object3D,
  x: number,
  y: number,
  z: number,
  width: number,
  name: string,
) {
  const slatWidth = Math.max(0.045, width * 0.12)
  const gap = slatWidth * 1.35
  for (let i = 0; i < 6; i += 1) {
    const slat = stampSlot(
      new Mesh(new BoxGeometry(slatWidth, 0.004, 0.004), microwaveScreenMaterial),
      'appliance',
    )
    slat.name = `${name}-vent-${i}`
    slat.position.set(x - gap * 2.5 + i * gap, y, z + 0.002)
    group.add(slat)
  }
}

function addOvenRotaryDial(
  group: Object3D,
  x: number,
  y: number,
  z: number,
  radius: number,
  name: string,
) {
  const dial = stampSlot(
    new Mesh(new CylinderGeometry(radius, radius, 0.018, 36), ovenDialMaterial),
    'appliance',
  )
  dial.name = name
  dial.rotation.x = Math.PI / 2
  dial.position.set(x, y, z + 0.009)
  dial.castShadow = true
  group.add(dial)

  const face = stampSlot(
    new Mesh(
      roundedButtonGeometry(radius * 1.36, radius * 0.28, 0.002, radius * 0.08),
      microwavePanelMaterial,
    ),
    'appliance',
  )
  face.name = `${name}-grip`
  face.position.set(x, y, z + 0.02)
  group.add(face)

  const indicator = stampSlot(
    new Mesh(new BoxGeometry(radius * 0.16, radius * 0.68, 0.0025), ovenIndicatorMaterial),
    'appliance',
  )
  indicator.name = `${name}-indicator`
  indicator.position.set(x, y + radius * 0.34, z + 0.022)
  group.add(indicator)

  const ring = stampSlot(
    new Mesh(new TorusGeometry(radius * 1.25, 0.002, 8, 36), microwaveScreenMaterial),
    'appliance',
  )
  ring.name = `${name}-ring`
  ring.position.set(x, y, z + 0.003)
  group.add(ring)
}

function addOvenStatusLights(
  group: Object3D,
  x: number,
  y: number,
  z: number,
  radius: number,
  gap: number,
  name: string,
) {
  ovenStatusLightMaterials.forEach((material, index) => {
    const light = stampSlot(
      new Mesh(new CylinderGeometry(radius, radius, 0.003, 16), material),
      'appliance',
    )
    light.name = `${name}-status-light-${index}`
    light.rotation.x = Math.PI / 2
    light.position.set(x + index * gap, y, z + 0.004)
    group.add(light)
  })
}

function addOvenControls(
  group: Object3D,
  x: number,
  y: number,
  z: number,
  width: number,
  height: number,
  name: string,
) {
  const panelWidth = width * 0.96
  const panelHeight = height * 0.88
  const panel = stampSlot(
    new Mesh(
      roundedButtonGeometry(panelWidth, panelHeight, 0.004, height * 0.14),
      microwavePanelMaterial,
    ),
    'appliance',
  )
  panel.name = `${name}-control-panel`
  panel.position.set(x, y, z + 0.001)
  group.add(panel)

  const dialRadius = Math.min(0.021, height * 0.26, width * 0.04)
  addOvenRotaryDial(group, x - width * 0.36, y + height * 0.02, z, dialRadius, `${name}-knob-0`)
  addOvenRotaryDial(group, x + width * 0.36, y + height * 0.02, z, dialRadius, `${name}-knob-1`)

  const displayWidth = Math.min(0.14, width * 0.24)
  const displayHeight = Math.min(0.024, height * 0.28)
  const displayY = y + height * 0.12
  const display = stampSlot(
    new Mesh(
      roundedButtonGeometry(displayWidth, displayHeight, 0.004, displayHeight * 0.2),
      microwaveScreenMaterial,
    ),
    'appliance',
  )
  display.name = `${name}-display`
  display.position.set(x, displayY, z + 0.004)
  group.add(display)
  addMicrowaveDisplaySegments(group, x, displayY, z, displayWidth, name)

  const buttonWidth = Math.min(0.032, width * 0.055)
  const buttonHeight = Math.min(0.011, height * 0.14)
  const buttonY = y - height * 0.16
  for (let i = 0; i < 3; i += 1) {
    addMicrowaveButton(
      group,
      x - buttonWidth * 1.3 + i * buttonWidth * 1.3,
      buttonY,
      z,
      buttonWidth,
      buttonHeight,
      microwaveButtonMaterial,
      `${name}-mode-button-${i}`,
    )
  }

  const lightRadius = Math.min(0.0045, height * 0.055)
  const lightGap = lightRadius * 3.1
  addOvenStatusLights(
    group,
    x + displayWidth / 2 + lightGap * 0.9,
    displayY,
    z,
    lightRadius,
    lightGap,
    name,
  )
  addOvenVentSlots(group, x, y - height * 0.35, z, width * 0.82, name)
}

function addOvenDoorDetails(
  leaf: Object3D,
  materials: CabinetSlotMaterials,
  width: number,
  height: number,
  glassWidth: number,
  glassHeight: number,
  frontThickness: number,
  name: string,
) {
  const gasketBar = Math.max(0.006, Math.min(0.011, Math.min(width, height) * 0.018))
  const gasketWidth = Math.max(0.01, glassWidth + gasketBar)
  const gasketHeight = Math.max(0.01, glassHeight + gasketBar)
  addBox(
    leaf as Group,
    [gasketWidth, gasketBar, frontThickness * 0.45],
    [0, gasketHeight / 2, frontThickness / 2 + 0.002],
    microwaveScreenMaterial,
    `${name}-window-gasket-top`,
    'appliance',
  )
  addBox(
    leaf as Group,
    [gasketWidth, gasketBar, frontThickness * 0.45],
    [0, -gasketHeight / 2, frontThickness / 2 + 0.002],
    microwaveScreenMaterial,
    `${name}-window-gasket-bottom`,
    'appliance',
  )
  addBox(
    leaf as Group,
    [gasketBar, gasketHeight, frontThickness * 0.45],
    [-gasketWidth / 2, 0, frontThickness / 2 + 0.002],
    microwaveScreenMaterial,
    `${name}-window-gasket-left`,
    'appliance',
  )
  addBox(
    leaf as Group,
    [gasketBar, gasketHeight, frontThickness * 0.45],
    [gasketWidth / 2, 0, frontThickness / 2 + 0.002],
    microwaveScreenMaterial,
    `${name}-window-gasket-right`,
    'appliance',
  )

  const lowerRail = stampSlot(
    new Mesh(
      roundedButtonGeometry(width * 0.72, Math.max(0.009, height * 0.026), 0.006, height * 0.01),
      materials.appliance,
    ),
    'appliance',
  )
  lowerRail.name = `${name}-door-lower-rail`
  lowerRail.position.set(0, -height * 0.43, frontThickness / 2 + 0.006)
  leaf.add(lowerRail)
}

function addOvenInteriorDetails(
  group: Group,
  materials: CabinetSlotMaterials,
  x: number,
  y: number,
  z: number,
  width: number,
  height: number,
  depth: number,
  name: string,
) {
  const fanRadius = Math.min(width, height) * 0.18
  const fanRing = stampSlot(
    new Mesh(new TorusGeometry(fanRadius, 0.004, 8, 48), materials.applianceInterior),
    'applianceInterior',
  )
  fanRing.name = `${name}-convection-fan-ring`
  fanRing.position.set(x, y, z + 0.012)
  group.add(fanRing)

  const hub = stampSlot(
    new Mesh(
      new CylinderGeometry(fanRadius * 0.22, fanRadius * 0.22, 0.008, 24),
      materials.applianceInterior,
    ),
    'applianceInterior',
  )
  hub.name = `${name}-convection-fan-hub`
  hub.rotation.x = Math.PI / 2
  hub.position.set(x, y, z + 0.018)
  group.add(hub)

  for (let i = 0; i < 4; i += 1) {
    const blade = stampSlot(
      new Mesh(new BoxGeometry(fanRadius * 0.72, 0.006, 0.003), materials.applianceInterior),
      'applianceInterior',
    )
    blade.name = `${name}-convection-fan-blade-${i}`
    blade.rotation.z = (i * Math.PI) / 2
    blade.position.set(x, y, z + 0.02)
    group.add(blade)
  }

  const element = stampSlot(
    new Mesh(
      new TorusGeometry(Math.min(width, depth) * 0.32, 0.004, 8, 64),
      ovenHeatElementMaterial,
    ),
    'applianceInterior',
  )
  element.name = `${name}-top-heating-element`
  element.rotation.x = Math.PI / 2
  element.scale.y = 0.58
  element.position.set(x, y + height * 0.34, z + depth * 0.2)
  group.add(element)
}

function addMicrowaveDoorMesh(
  leaf: Object3D,
  width: number,
  height: number,
  z: number,
  name: string,
) {
  const columns = 7
  const rows = 5
  const dotSize = Math.max(0.0035, Math.min(width, height) * 0.018)
  const meshWidth = width * 0.7
  const meshHeight = height * 0.55
  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < columns; col += 1) {
      const dot = stampSlot(
        new Mesh(new BoxGeometry(dotSize, dotSize, 0.002), microwaveScreenMaterial),
        'glass',
      )
      dot.name = `${name}-window-dot-${row}-${col}`
      dot.position.set(
        -meshWidth / 2 + (meshWidth * col) / (columns - 1),
        -meshHeight / 2 + (meshHeight * row) / (rows - 1),
        z + 0.003,
      )
      leaf.add(dot)
    }
  }
}

function addMicrowaveTurntable(
  group: Group,
  materials: CabinetSlotMaterials,
  x: number,
  y: number,
  z: number,
  radius: number,
  name: string,
) {
  const plate = stampSlot(
    new Mesh(new CylinderGeometry(radius, radius, 0.006, 48), materials.glass),
    'glass',
  )
  plate.name = `${name}-turntable`
  plate.position.set(x, y, z)
  plate.renderOrder = 2
  group.add(plate)

  const ring = stampSlot(
    new Mesh(new TorusGeometry(radius * 0.72, 0.004, 8, 48), materials.applianceInterior),
    'applianceInterior',
  )
  ring.name = `${name}-roller-ring`
  ring.rotation.x = Math.PI / 2
  ring.position.set(x, y - 0.006, z)
  group.add(ring)
}

export function addApplianceCompartment(
  group: Group,
  node: CabinetGeometryNode,
  materials: CabinetSlotMaterials,
  kind: 'oven' | 'microwave',
  faceWidth: number,
  faceHeight: number,
  faceCenterY: number,
  openingWidth: number,
  openingDepth: number,
  frontZ: number,
  index: number,
) {
  const name = `cabinet-${kind}-${index}`
  const gap = node.frontGap
  const frontThickness = node.frontThickness
  const fasciaFrontZ = frontZ + frontThickness / 2

  let doorWidth: number
  let doorHeight: number
  let doorCenterX: number
  let doorCenterY: number

  if (kind === 'oven') {
    const fasciaHeight = Math.min(0.08, faceHeight * 0.18)
    const fasciaY = faceCenterY + faceHeight / 2 - fasciaHeight / 2
    addBox(
      group,
      [faceWidth, fasciaHeight, frontThickness],
      [0, fasciaY, frontZ],
      materials.appliance,
      `${name}-fascia`,
      'appliance',
    )
    addOvenControls(group, 0, fasciaY, fasciaFrontZ, faceWidth, fasciaHeight, name)

    doorWidth = faceWidth
    doorHeight = Math.max(0.01, faceHeight - fasciaHeight - gap)
    doorCenterX = 0
    doorCenterY = faceCenterY - faceHeight / 2 + doorHeight / 2
  } else {
    const fasciaWidth = Math.min(0.15, faceWidth * 0.28)
    const fasciaCenterX = faceWidth / 2 - fasciaWidth / 2
    addBox(
      group,
      [fasciaWidth, faceHeight, frontThickness],
      [fasciaCenterX, faceCenterY, frontZ],
      materials.appliance,
      `${name}-fascia`,
      'appliance',
    )
    addMicrowaveVentSlats(
      group,
      fasciaCenterX,
      faceCenterY + faceHeight / 2 - 0.017,
      fasciaFrontZ,
      fasciaWidth,
      `${name}-top`,
    )
    addMicrowaveControls(
      group,
      fasciaCenterX,
      faceCenterY,
      fasciaFrontZ,
      fasciaWidth,
      faceHeight,
      name,
    )
    addMicrowaveVentSlats(
      group,
      fasciaCenterX,
      faceCenterY - faceHeight / 2 + 0.046,
      fasciaFrontZ,
      fasciaWidth,
      `${name}-bottom`,
    )

    doorWidth = Math.max(0.01, faceWidth - fasciaWidth - gap)
    doorHeight = faceHeight
    doorCenterX = -faceWidth / 2 + doorWidth / 2
    doorCenterY = faceCenterY
  }

  const wall = APPLIANCE_CAVITY_WALL
  const cavityWidth = Math.max(0.05, Math.min(doorWidth, openingWidth) - wall * 2)
  const cavityHeight = Math.max(0.05, doorHeight - wall * 2)
  const cavityFrontZ = frontZ - frontThickness / 2 - 0.001
  const cavityDepth = Math.max(0.05, Math.min(0.55, openingDepth - 0.04))
  const cavityBackZ = cavityFrontZ - cavityDepth
  const cavityCenterZ = cavityBackZ + cavityDepth / 2

  addBox(
    group,
    [cavityWidth + wall * 2, cavityHeight + wall * 2, wall],
    [doorCenterX, doorCenterY, cavityBackZ + wall / 2],
    materials.applianceInterior,
    `${name}-cavity-back`,
    'applianceInterior',
  )
  addBox(
    group,
    [cavityWidth + wall * 2, wall, cavityDepth],
    [doorCenterX, doorCenterY + cavityHeight / 2 + wall / 2, cavityCenterZ],
    materials.applianceInterior,
    `${name}-cavity-top`,
    'applianceInterior',
  )
  addBox(
    group,
    [cavityWidth + wall * 2, wall, cavityDepth],
    [doorCenterX, doorCenterY - cavityHeight / 2 - wall / 2, cavityCenterZ],
    materials.applianceInterior,
    `${name}-cavity-bottom`,
    'applianceInterior',
  )
  addBox(
    group,
    [wall, cavityHeight, cavityDepth],
    [doorCenterX - cavityWidth / 2 - wall / 2, doorCenterY, cavityCenterZ],
    materials.applianceInterior,
    `${name}-cavity-left`,
    'applianceInterior',
  )
  addBox(
    group,
    [wall, cavityHeight, cavityDepth],
    [doorCenterX + cavityWidth / 2 + wall / 2, doorCenterY, cavityCenterZ],
    materials.applianceInterior,
    `${name}-cavity-right`,
    'applianceInterior',
  )
  addBox(
    group,
    [cavityWidth + wall * 2, wall, frontThickness],
    [doorCenterX, doorCenterY + cavityHeight / 2 + wall / 2, cavityFrontZ],
    materials.appliance,
    `${name}-cavity-lip-top`,
    'appliance',
  )
  addBox(
    group,
    [cavityWidth + wall * 2, wall, frontThickness],
    [doorCenterX, doorCenterY - cavityHeight / 2 - wall / 2, cavityFrontZ],
    materials.appliance,
    `${name}-cavity-lip-bottom`,
    'appliance',
  )
  addBox(
    group,
    [wall, cavityHeight, frontThickness],
    [doorCenterX - cavityWidth / 2 - wall / 2, doorCenterY, cavityFrontZ],
    materials.appliance,
    `${name}-cavity-lip-left`,
    'appliance',
  )
  addBox(
    group,
    [wall, cavityHeight, frontThickness],
    [doorCenterX + cavityWidth / 2 + wall / 2, doorCenterY, cavityFrontZ],
    materials.appliance,
    `${name}-cavity-lip-right`,
    'appliance',
  )

  const lamp = stampSlot(
    new Mesh(new BoxGeometry(0.05, 0.008, 0.02), applianceLampMaterial),
    'applianceInterior',
  )
  lamp.name = `${name}-lamp`
  lamp.position.set(doorCenterX, doorCenterY + cavityHeight / 2 - 0.012, cavityBackZ + 0.06)
  group.add(lamp)

  const rackWidth = Math.max(0.02, cavityWidth - 0.01)
  const rackDepth = Math.max(0.02, cavityDepth - 0.04)
  if (kind === 'oven') {
    for (const fraction of [1 / 3, 2 / 3]) {
      addWireRack(
        group,
        materials,
        rackWidth,
        rackDepth,
        doorCenterY - cavityHeight / 2 + cavityHeight * fraction,
        cavityCenterZ,
        `${name}-rack-${fraction < 0.5 ? 0 : 1}`,
      )
    }
    addOvenInteriorDetails(
      group,
      materials,
      doorCenterX,
      doorCenterY,
      cavityBackZ,
      cavityWidth,
      cavityHeight,
      cavityDepth,
      name,
    )
  } else {
    addMicrowaveTurntable(
      group,
      materials,
      doorCenterX,
      doorCenterY - cavityHeight / 2 + 0.028,
      cavityCenterZ,
      Math.min(rackWidth, rackDepth) * 0.28,
      name,
    )
  }

  const hingeGroup = new Group()
  hingeGroup.name = `${name}-door-hinge`
  if (kind === 'oven') {
    hingeGroup.position.set(doorCenterX, doorCenterY - doorHeight / 2, frontZ)
    hingeGroup.rotation.x = OVEN_OPEN_ANGLE * (node.operationState ?? 0)
    hingeGroup.userData.cabinetPose = { type: 'rotate', axis: 'x', angle: OVEN_OPEN_ANGLE }
  } else {
    hingeGroup.position.set(doorCenterX - doorWidth / 2, doorCenterY, frontZ)
    hingeGroup.rotation.y = -(Math.PI / 2) * (node.operationState ?? 0)
    hingeGroup.userData.cabinetPose = { type: 'rotate', axis: 'y', angle: -(Math.PI / 2) }
  }
  group.add(hingeGroup)

  const leaf = new Group()
  leaf.name = `${name}-door`
  leaf.position.set(kind === 'oven' ? 0 : doorWidth / 2, kind === 'oven' ? doorHeight / 2 : 0, 0)
  hingeGroup.add(leaf)

  const frame =
    kind === 'oven'
      ? Math.max(0.022, Math.min(0.042, Math.min(doorWidth, doorHeight) * 0.075))
      : Math.max(0.03, Math.min(doorWidth, doorHeight) * 0.14)
  const glassWidth = Math.max(0.01, doorWidth - frame * 2)
  const glassHeight = Math.max(0.01, doorHeight - frame * 2)
  addBox(
    leaf,
    [doorWidth, frame, frontThickness],
    [0, doorHeight / 2 - frame / 2, 0],
    materials.appliance,
    `${name}-door-frame-top`,
    'appliance',
  )
  addBox(
    leaf,
    [doorWidth, frame, frontThickness],
    [0, -doorHeight / 2 + frame / 2, 0],
    materials.appliance,
    `${name}-door-frame-bottom`,
    'appliance',
  )
  addBox(
    leaf,
    [frame, glassHeight, frontThickness],
    [-doorWidth / 2 + frame / 2, 0, 0],
    materials.appliance,
    `${name}-door-frame-left`,
    'appliance',
  )
  addBox(
    leaf,
    [frame, glassHeight, frontThickness],
    [doorWidth / 2 - frame / 2, 0, 0],
    materials.appliance,
    `${name}-door-frame-right`,
    'appliance',
  )
  const glassMesh = stampSlot(
    new Mesh(
      new BoxGeometry(glassWidth, glassHeight, Math.max(0.003, frontThickness * 0.5)),
      materials.glass,
    ),
    'glass',
  )
  glassMesh.name = `${name}-door-glass`
  glassMesh.position.set(0, 0, 0)
  glassMesh.renderOrder = 2
  leaf.add(glassMesh)
  if (kind === 'microwave') {
    addMicrowaveDoorMesh(leaf, glassWidth, glassHeight, frontThickness / 2, name)
  } else {
    addOvenDoorDetails(
      leaf,
      materials,
      doorWidth,
      doorHeight,
      glassWidth,
      glassHeight,
      frontThickness,
      name,
    )
  }

  if (kind === 'oven') {
    addApplianceHandle(
      leaf,
      materials.appliance,
      [0, doorHeight / 2 - 0.035, frontThickness / 2],
      doorWidth * 0.85,
      false,
      `${name}-handle`,
    )
  } else {
    addApplianceHandle(
      leaf,
      materials.appliance,
      [doorWidth / 2 - 0.035, 0, frontThickness / 2],
      Math.min(0.35, doorHeight * 0.55),
      true,
      `${name}-handle`,
    )
  }
}
