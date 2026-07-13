import { BoxGeometry, CylinderGeometry, Group, Mesh } from 'three'
import {
  APPLIANCE_CAVITY_WALL,
  addBox,
  addMicrowaveDisplaySegments,
  addWireRack,
  type CabinetGeometryNode,
  type CabinetSlotMaterials,
  microwaveButtonMaterial,
  microwavePanelMaterial,
  microwaveScreenMaterial,
  OVEN_OPEN_ANGLE,
  refrigeratorBrassAccentMaterial,
  refrigeratorDarkTrimMaterial,
  refrigeratorLinerAccentMaterial,
  refrigeratorLinerMaterial,
  refrigeratorSealMaterial,
  refrigeratorSilverMaterial,
  roundedButtonGeometry,
  stampSlot,
} from './shared'

export function addDishwasherCompartment(
  group: Group,
  node: CabinetGeometryNode,
  materials: CabinetSlotMaterials,
  faceWidth: number,
  faceHeight: number,
  faceCenterY: number,
  openingWidth: number,
  openingDepth: number,
  frontZ: number,
  index: number,
) {
  const name = `cabinet-dishwasher-${index}`
  const gap = node.frontGap
  const frontThickness = node.frontThickness
  const doorWidth = Math.max(0.01, faceWidth - gap * 2)
  const doorHeight = Math.max(0.01, faceHeight - gap * 2)
  const doorCenterY = faceCenterY
  const wall = APPLIANCE_CAVITY_WALL
  const tubWidth = Math.max(0.05, Math.min(openingWidth, doorWidth) - wall * 2)
  const tubHeight = Math.max(0.05, doorHeight - wall * 2)
  const tubDepth = Math.max(0.08, Math.min(0.5, openingDepth - 0.04))
  const tubFrontZ = frontZ - frontThickness / 2 - 0.006
  const tubBackZ = tubFrontZ - tubDepth
  const tubCenterZ = tubBackZ + tubDepth / 2
  const topBandHeight = Math.min(0.07, doorHeight * 0.1)
  const faceZ = frontThickness / 2

  addBox(
    group,
    [tubWidth + wall * 2, tubHeight + wall * 2, wall],
    [0, doorCenterY, tubBackZ + wall / 2],
    refrigeratorLinerMaterial,
    `${name}-tub-back`,
    'applianceInterior',
  )
  addBox(
    group,
    [tubWidth + wall * 2, wall, tubDepth],
    [0, doorCenterY + tubHeight / 2 + wall / 2, tubCenterZ],
    refrigeratorLinerMaterial,
    `${name}-tub-top`,
    'applianceInterior',
  )
  addBox(
    group,
    [tubWidth + wall * 2, wall, tubDepth],
    [0, doorCenterY - tubHeight / 2 - wall / 2, tubCenterZ],
    refrigeratorLinerMaterial,
    `${name}-tub-bottom`,
    'applianceInterior',
  )
  addBox(
    group,
    [wall, tubHeight, tubDepth],
    [-tubWidth / 2 - wall / 2, doorCenterY, tubCenterZ],
    refrigeratorLinerMaterial,
    `${name}-tub-left`,
    'applianceInterior',
  )
  addBox(
    group,
    [wall, tubHeight, tubDepth],
    [tubWidth / 2 + wall / 2, doorCenterY, tubCenterZ],
    refrigeratorLinerMaterial,
    `${name}-tub-right`,
    'applianceInterior',
  )

  addWireRack(
    group,
    materials,
    Math.max(0.02, tubWidth - 0.04),
    Math.max(0.02, tubDepth - 0.08),
    doorCenterY + tubHeight * 0.18,
    tubCenterZ,
    `${name}-upper-rack`,
  )
  addWireRack(
    group,
    materials,
    Math.max(0.02, tubWidth - 0.04),
    Math.max(0.02, tubDepth - 0.08),
    doorCenterY - tubHeight * 0.18,
    tubCenterZ,
    `${name}-lower-rack`,
  )

  const sprayArmY = doorCenterY - tubHeight * 0.36
  const sprayArm = stampSlot(
    new Mesh(new BoxGeometry(tubWidth * 0.64, 0.008, 0.012), refrigeratorLinerAccentMaterial),
    'applianceInterior',
  )
  sprayArm.name = `${name}-spray-arm`
  sprayArm.position.set(0, sprayArmY, tubFrontZ - tubDepth * 0.2)
  group.add(sprayArm)
  const sprayHub = stampSlot(
    new Mesh(new CylinderGeometry(0.018, 0.018, 0.012, 24), refrigeratorLinerAccentMaterial),
    'applianceInterior',
  )
  sprayHub.name = `${name}-spray-hub`
  sprayHub.rotation.x = Math.PI / 2
  sprayHub.position.set(0, sprayArmY, tubFrontZ - tubDepth * 0.2)
  group.add(sprayHub)

  const hingeGroup = new Group()
  hingeGroup.name = `${name}-door-hinge`
  hingeGroup.position.set(0, doorCenterY - doorHeight / 2, frontZ)
  hingeGroup.rotation.x = OVEN_OPEN_ANGLE * (node.operationState ?? 0)
  hingeGroup.userData.cabinetPose = { type: 'rotate', axis: 'x', angle: OVEN_OPEN_ANGLE }
  group.add(hingeGroup)

  const leaf = new Group()
  leaf.name = `${name}-door`
  leaf.position.set(0, doorHeight / 2, 0)
  hingeGroup.add(leaf)

  const panel = stampSlot(
    new Mesh(
      roundedButtonGeometry(
        doorWidth,
        doorHeight,
        frontThickness,
        Math.min(doorWidth, doorHeight) * 0.035,
      ),
      materials.appliance,
    ),
    'appliance',
  )
  panel.name = `${name}-door-panel`
  panel.castShadow = true
  panel.receiveShadow = true
  leaf.add(panel)

  const trimThickness = Math.max(0.006, Math.min(0.01, Math.min(doorWidth, doorHeight) * 0.018))
  const trimZ = faceZ + 0.004
  addBox(
    leaf,
    [doorWidth - trimThickness * 2.4, trimThickness, frontThickness * 0.18],
    [0, doorHeight / 2 - trimThickness * 1.2, trimZ],
    refrigeratorDarkTrimMaterial,
    `${name}-outer-trim-top`,
    'appliance',
  )
  addBox(
    leaf,
    [doorWidth - trimThickness * 2.4, trimThickness, frontThickness * 0.16],
    [0, -doorHeight / 2 + trimThickness * 1.2, trimZ],
    refrigeratorDarkTrimMaterial,
    `${name}-outer-trim-bottom`,
    'appliance',
  )
  for (const side of [-1, 1]) {
    addBox(
      leaf,
      [trimThickness, doorHeight - trimThickness * 2.4, frontThickness * 0.14],
      [side * (doorWidth / 2 - trimThickness * 1.2), 0, trimZ],
      refrigeratorDarkTrimMaterial,
      `${name}-outer-trim-${side < 0 ? 'left' : 'right'}`,
      'appliance',
    )
  }

  const bandWidth = doorWidth - trimThickness * 5
  const bandHeight = Math.max(0.045, topBandHeight * 0.82)
  const bandY = doorHeight / 2 - trimThickness * 3.3 - bandHeight / 2
  const controlPanel = stampSlot(
    new Mesh(
      roundedButtonGeometry(bandWidth, bandHeight, frontThickness * 0.18, bandHeight * 0.18),
      microwavePanelMaterial,
    ),
    'appliance',
  )
  controlPanel.name = `${name}-control-panel`
  controlPanel.position.set(0, bandY, faceZ + 0.006)
  controlPanel.castShadow = true
  leaf.add(controlPanel)

  const displayWidth = Math.min(0.105, doorWidth * 0.2)
  const display = stampSlot(
    new Mesh(roundedButtonGeometry(displayWidth, 0.018, 0.004, 0.003), microwaveScreenMaterial),
    'appliance',
  )
  display.name = `${name}-display`
  display.position.set(-bandWidth * 0.28, bandY, faceZ + 0.018)
  leaf.add(display)
  addMicrowaveDisplaySegments(leaf, -bandWidth * 0.28, bandY, faceZ + 0.014, displayWidth, name)
  for (let i = 0; i < 4; i += 1)
    addBox(
      leaf,
      [0.018, 0.006, 0.003],
      [bandWidth * 0.03 + i * 0.034, bandY, faceZ + 0.019],
      microwaveButtonMaterial,
      `${name}-cycle-button-${i}`,
      'appliance',
    )

  const handleY = bandY - bandHeight / 2 - 0.018
  addBox(
    leaf,
    [doorWidth * 0.66, 0.018, 0.008],
    [0, handleY, faceZ + 0.008],
    microwavePanelMaterial,
    `${name}-pocket-handle-shadow`,
    'appliance',
  )
  addBox(
    leaf,
    [doorWidth * 0.58, 0.007, 0.006],
    [0, handleY + 0.005, faceZ + 0.017],
    refrigeratorSilverMaterial,
    `${name}-pocket-handle-lip`,
    'appliance',
  )

  const lowerVisualTop = handleY - 0.025
  const toeVentY = -doorHeight / 2 + 0.042
  const centerPanelHeight = Math.max(0.08, lowerVisualTop - toeVentY - 0.052)
  const centerPanelY = toeVentY + 0.042 + centerPanelHeight / 2
  const centerPanel = stampSlot(
    new Mesh(
      roundedButtonGeometry(
        doorWidth - trimThickness * 7,
        centerPanelHeight,
        frontThickness * 0.1,
        Math.min(0.012, centerPanelHeight * 0.05),
      ),
      refrigeratorSilverMaterial,
    ),
    'appliance',
  )
  centerPanel.name = `${name}-brushed-front-panel`
  centerPanel.position.set(0, centerPanelY, faceZ + 0.009)
  centerPanel.castShadow = true
  centerPanel.receiveShadow = true
  leaf.add(centerPanel)
  addBox(
    leaf,
    [doorWidth - trimThickness * 10, 0.01, 0.002],
    [0, centerPanelY + centerPanelHeight * 0.42, faceZ + 0.016],
    refrigeratorSealMaterial,
    `${name}-front-highlight`,
    'appliance',
  )
  for (const offsetX of [-0.5, 0.5]) {
    addBox(
      leaf,
      [0.004, centerPanelHeight * 0.86, 0.002],
      [offsetX * (doorWidth - trimThickness * 8), centerPanelY, faceZ + 0.015],
      refrigeratorSealMaterial,
      `${name}-front-groove-${offsetX < 0 ? 'left' : 'right'}`,
      'appliance',
    )
  }
  for (let i = 0; i < 3; i += 1) {
    addBox(
      leaf,
      [0.003, centerPanelHeight * 0.82, 0.002],
      [(-0.12 + i * 0.12) * doorWidth, centerPanelY, faceZ + 0.014],
      refrigeratorSealMaterial,
      `${name}-brushed-line-${i}`,
      'appliance',
    )
  }
  addBox(
    leaf,
    [Math.min(0.052, doorWidth * 0.1), 0.012, 0.004],
    [doorWidth * 0.31, centerPanelY + centerPanelHeight * 0.34, faceZ + 0.019],
    refrigeratorBrassAccentMaterial,
    `${name}-badge`,
    'appliance',
  )
  addBox(
    leaf,
    [Math.min(0.18, doorWidth * 0.34), 0.046, 0.012],
    [doorWidth * 0.22, -doorHeight * 0.1, -frontThickness / 2 - 0.018],
    microwaveScreenMaterial,
    `${name}-detergent-cup`,
    'applianceInterior',
  )

  addBox(
    leaf,
    [doorWidth * 0.54, 0.024, frontThickness * 0.2],
    [0, toeVentY, faceZ + 0.008],
    refrigeratorDarkTrimMaterial,
    `${name}-toe-vent`,
    'appliance',
  )
  for (let i = 0; i < 5; i += 1) {
    addBox(
      leaf,
      [0.03, 0.0035, 0.004],
      [-doorWidth * 0.16 + i * doorWidth * 0.08, toeVentY, faceZ + 0.015],
      microwaveScreenMaterial,
      `${name}-toe-vent-slat-${i}`,
      'appliance',
    )
  }
}
