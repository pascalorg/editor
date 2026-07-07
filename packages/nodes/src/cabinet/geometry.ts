import type { CabinetNode, GeometryContext } from '@pascal-app/core'
import type { ColorPreset, RenderShading } from '@pascal-app/viewer'
import { Group } from 'three'
import { addCooktopCompartment } from './geometry/cooktop'
import { addDishwasherCompartment } from './geometry/dishwasher'
import { addFridgeCompartment } from './geometry/fridge'
import { addDoorFronts, addDrawerFronts, addShelfBoards } from './geometry/fronts'
import { addRangeHoodCompartment } from './geometry/hood'
import { addApplianceCompartment } from './geometry/oven-microwave'
import { addPullOutPantryCompartment } from './geometry/pantry'
import { buildCabinetRunGeometry } from './geometry/run'
import { addBox, type CabinetGeometryNode, getCabinetSlotMaterials } from './geometry/shared'
import { addSinkCompartment, cutSinkIntoCountertop, sinkBowls } from './geometry/sink'
import {
  type CabinetHoodCompartmentType,
  compartmentDoorType,
  compartmentDrawerCount,
  compartmentShelfCount,
  compartmentSinkLayout,
  isHoodCompartmentType,
  normalizeCabinetStack,
  stackForCabinet,
} from './stack'

const CORNER_FILLER_TOP_INSET = 0.001
const CORNER_FILLER_SIDE_INSET = 0.001
const WALL_CORNER_FILLER_FRONT_HEIGHT_INSET = 0.001

export function buildCabinetGeometry(
  node: CabinetGeometryNode,
  ctx?: GeometryContext,
  shading: RenderShading = 'rendered',
  textures = true,
  colorPreset: ColorPreset = 'clay',
  sceneTheme?: string,
): Group {
  if (node.type === 'cabinet') {
    const run = buildCabinetRunGeometry(node, ctx, shading, textures, colorPreset, sceneTheme)
    if (run) return run
    return new Group()
  }

  const group = new Group()
  const materials = getCabinetSlotMaterials(node, ctx, shading, textures, colorPreset, sceneTheme)

  const hoodRows = normalizeCabinetStack(node)
  if (hoodRows.length > 0 && hoodRows.every((row) => isHoodCompartmentType(row.compartment.type))) {
    const hoodPlinth = node.showPlinth ? node.plinthHeight : 0
    hoodRows.forEach((row) => {
      addRangeHoodCompartment(
        group,
        node,
        materials,
        row.compartment.type as CabinetHoodCompartmentType,
        hoodPlinth + row.y0,
        row.height,
        ctx,
        row.index,
      )
    })
    return group
  }

  const width = node.width
  const depth = node.depth
  const board = node.boardThickness
  const plinth = node.showPlinth ? node.plinthHeight : 0
  const toeKickDepth = node.showPlinth ? Math.min(node.toeKickDepth, depth - board * 2) : 0
  const carcassHeight = node.carcassHeight
  const frontThickness = node.frontThickness
  const frontGap = node.frontGap
  const countertopThickness = node.withCountertop ? node.countertopThickness : 0
  const countertopOverhang = node.withCountertop ? node.countertopOverhang : 0
  const bodyCenterY = plinth + carcassHeight / 2
  const topY = plinth + carcassHeight
  const bottomLift = node.withBottomPanel ? board : 0
  const backThickness = Math.min(0.006, board / 2)
  const backInset = Math.min(0.012, depth * 0.08)
  const frontRecess = 0.0015
  const inset = node.frontOverlay === 'inset'
  const insetInteriorClearance = inset ? Math.max(0.012, frontThickness + frontRecess + 0.006) : 0
  // Overlay fronts sit proud on the carcass face; inset fronts sit flush within the opening.
  const frontZ = inset
    ? depth / 2 - frontThickness / 2 - frontRecess
    : depth / 2 + frontThickness / 2 - frontRecess
  const openLeft = node.openSide === 'left'
  const openRight = node.openSide === 'right'
  const innerLeft = -width / 2 + (openLeft ? 0 : board)
  const innerRight = width / 2 - (openRight ? 0 : board)
  const innerWidth = Math.max(0.01, innerRight - innerLeft)
  const innerCenterX = (innerLeft + innerRight) / 2
  const openingWidth = innerWidth
  const openingDepth = Math.max(0.01, depth - backInset - 0.02 - insetInteriorClearance)
  const drawerBoxBackZ = -depth / 2 + backInset + 0.02
  const drawerBoxFrontZ = frontZ - frontThickness / 2 - 0.001 - insetInteriorClearance
  const drawerBoxDepth = Math.max(0.05, drawerBoxFrontZ - drawerBoxBackZ)
  const parentRun = ctx?.parent?.type === 'cabinet' ? (ctx.parent as CabinetNode) : null
  const isWallCornerFiller = node.moduleKind === 'corner-filler' && parentRun?.runTier === 'wall'

  if (node.moduleKind === 'corner-filler') {
    const filler = new Group()
    const shelfDepth = Math.max(0.01, depth - backInset - 0.02)
    const shelfCount = Math.max(
      1,
      stackForCabinet(node)
        .filter((compartment) => compartment.type === 'door')
        .reduce((best, compartment) => Math.max(best, compartmentShelfCount(compartment)), 0),
    )
    if (!openLeft) {
      const leftSideInset = isWallCornerFiller && openRight ? CORNER_FILLER_SIDE_INSET / 2 : 0
      addBox(
        filler,
        [board, carcassHeight, depth],
        [-width / 2 + board / 2 + leftSideInset, bodyCenterY, 0],
        materials.carcass,
        'cabinet-corner-filler-side-left',
        'carcass',
      )
    }
    if (!openRight) {
      const rightSideInset = isWallCornerFiller && openLeft ? CORNER_FILLER_SIDE_INSET / 2 : 0
      addBox(
        filler,
        [board, carcassHeight, depth],
        [width / 2 - board / 2 - rightSideInset, bodyCenterY, 0],
        materials.carcass,
        'cabinet-corner-filler-side-right',
        'carcass',
      )
    }
    if (node.withBottomPanel) {
      addBox(
        filler,
        [innerWidth, board, depth - backInset],
        [innerCenterX, plinth + board / 2, backInset / 2],
        materials.carcass,
        'cabinet-corner-filler-bottom',
        'carcass',
      )
    }
    // Keep open-side corner-filler tops just inside the shared boundary so
    // neighboring wall-top fillers/cabinets don't land coplanar and shimmer.
    const topLeft = innerLeft + (openLeft ? CORNER_FILLER_TOP_INSET : 0)
    const topRight = innerRight - (openRight ? CORNER_FILLER_TOP_INSET : 0)
    addBox(
      filler,
      [Math.max(0.01, topRight - topLeft), board, depth],
      [(topLeft + topRight) / 2, topY - board / 2, 0],
      materials.carcass,
      'cabinet-corner-filler-top',
      'carcass',
    )
    addBox(
      filler,
      [innerWidth, Math.max(0.001, carcassHeight - board), backThickness],
      [innerCenterX, plinth + carcassHeight / 2, -depth / 2 + backInset + backThickness / 2],
      materials.carcass,
      'cabinet-corner-filler-back',
      'carcass',
    )
    const frontExtension = board / 2 + frontGap
    const wallFrontSharedInset = isWallCornerFiller ? frontThickness + frontGap : 0
    const frontLeft =
      -width / 2 -
      (openLeft ? frontExtension : 0) +
      (isWallCornerFiller && openRight ? wallFrontSharedInset : 0)
    const frontRight =
      width / 2 +
      (openRight ? frontExtension : 0) -
      (isWallCornerFiller && openLeft ? wallFrontSharedInset : 0)
    const frontWidth = Math.max(0.01, frontRight - frontLeft)
    const frontHeight = isWallCornerFiller
      ? Math.max(0.01, carcassHeight - WALL_CORNER_FILLER_FRONT_HEIGHT_INSET * 2)
      : carcassHeight
    addBox(
      filler,
      [frontWidth, frontHeight, frontThickness],
      [(frontLeft + frontRight) / 2, bodyCenterY, frontZ],
      materials.front,
      'cabinet-corner-filler-front',
      'front',
    )
    if (node.cornerShelf) {
      addShelfBoards(
        filler,
        materials,
        innerWidth,
        shelfDepth,
        board,
        plinth + board,
        Math.max(0.01, carcassHeight - board * 2),
        shelfCount,
        innerCenterX,
      )
    }
    return filler
  }

  const rows = normalizeCabinetStack(node)
  const sinkRow = rows.find((row) => row.compartment.type === 'sink')
  const sinkBowlSpecs = sinkRow
    ? sinkBowls(compartmentSinkLayout(sinkRow.compartment), innerWidth, depth)
    : null

  if (!openLeft) {
    addBox(
      group,
      [board, carcassHeight, depth],
      [-width / 2 + board / 2, bodyCenterY, 0],
      materials.carcass,
      'cabinet-side-left',
      'carcass',
    )
  }
  if (!openRight) {
    addBox(
      group,
      [board, carcassHeight, depth],
      [width / 2 - board / 2, bodyCenterY, 0],
      materials.carcass,
      'cabinet-side-right',
      'carcass',
    )
  }
  if (node.withBottomPanel) {
    addBox(
      group,
      [innerWidth, board, depth - backInset],
      [innerCenterX, plinth + board / 2, backInset / 2],
      materials.carcass,
      'cabinet-bottom',
      'carcass',
    )
  }
  // Sink bases skip the top panel — the basin hangs through that plane.
  if (!sinkRow) {
    addBox(
      group,
      [innerWidth, board, depth],
      [innerCenterX, topY - board / 2, 0],
      materials.carcass,
      'cabinet-top',
      'carcass',
    )
  }
  if (node.showPlinth && plinth > 0) {
    addBox(
      group,
      [width - board * 2, plinth, Math.max(board, depth - toeKickDepth)],
      [0, plinth / 2, -(toeKickDepth / 2)],
      materials.plinth,
      'cabinet-plinth',
      'plinth',
    )
  }

  if (node.withCountertop && countertopThickness > 0) {
    const countertop = addBox(
      group,
      [width + countertopOverhang * 2, countertopThickness, depth + countertopOverhang],
      [0, topY + countertopThickness / 2, 0.01],
      materials.countertop,
      'cabinet-countertop',
      'countertop',
    )
    if (sinkBowlSpecs) {
      group.remove(countertop)
      const cut = cutSinkIntoCountertop(countertop, sinkBowlSpecs, 0, 0, countertopThickness)
      countertop.geometry.dispose()
      group.add(cut)
    }
  }
  if (sinkBowlSpecs && sinkRow) {
    // Modules inside a run don't own a countertop (the run draws and cuts
    // it), so the faucet rises above the run's slab thickness instead.
    const slabThickness =
      countertopThickness > 0
        ? countertopThickness
        : parentRun?.withCountertop
          ? parentRun.countertopThickness
          : 0.02
    addSinkCompartment(group, sinkBowlSpecs, 0, 0, topY, slabThickness, sinkRow.index)
  }
  rows.forEach((row, index) => {
    // Sink rows are zero-height; the basin/faucet render against the
    // countertop plane above, so the row contributes no carcass geometry.
    if (row.compartment.type === 'sink') return
    if (row.compartment.type === 'cooktop-gas' || row.compartment.type === 'cooktop-induction') {
      const countertopClearance = 0.001
      const effectiveCountertopThickness = Math.max(countertopThickness, 0.02)
      addCooktopCompartment(
        group,
        node,
        row.compartment,
        row.compartment.type,
        topY + effectiveCountertopThickness + countertopClearance,
        index,
      )
      return
    }

    const isFirst = index === 0
    const isLast = index === rows.length - 1
    const bottomOccupancy = isFirst ? bottomLift : board / 2
    const topOccupancy = isLast ? board : board / 2
    const subCellBottomY = plinth + row.y0
    const openingBottomY = subCellBottomY + bottomOccupancy
    const openingHeight = Math.max(0.01, row.height - bottomOccupancy - topOccupancy)
    const openingCenterY = openingBottomY + openingHeight / 2

    addBox(
      group,
      [openingWidth, Math.max(0.001, row.height - board), backThickness],
      [innerCenterX, subCellBottomY + row.height / 2, -depth / 2 + backInset + backThickness / 2],
      materials.carcass,
      `cabinet-back-${index}`,
      'carcass',
    )

    // No deck below a sink row — the basin hangs through that plane.
    if (index < rows.length - 1 && rows[index + 1]!.compartment.type !== 'sink') {
      const deckY = plinth + row.y1
      addBox(
        group,
        [openingWidth, board, openingDepth],
        [innerCenterX, deckY, board / 2],
        materials.carcass,
        `cabinet-deck-${index}`,
        'carcass',
      )
    }

    const faceWidth = inset ? openingWidth : Math.max(0.01, width - frontGap)
    const faceHeight = inset ? openingHeight : Math.max(0.01, row.height)
    const faceCenterY = inset ? openingCenterY : subCellBottomY + row.height / 2

    if (row.compartment.type === 'door') {
      addDoorFronts(
        group,
        node,
        materials,
        faceWidth,
        faceHeight,
        0,
        faceCenterY,
        frontZ,
        compartmentDoorType(row.compartment, node.width),
      )
      if ((row.compartment.shelfCount ?? 0) > 0) {
        addShelfBoards(
          group,
          materials,
          openingWidth,
          openingDepth,
          board,
          openingBottomY,
          openingHeight,
          row.compartment.shelfCount ?? 0,
          innerCenterX,
        )
      }
      return
    }

    if (row.compartment.type === 'shelf') {
      addShelfBoards(
        group,
        materials,
        openingWidth,
        openingDepth,
        board,
        openingBottomY,
        openingHeight,
        compartmentShelfCount(row.compartment),
        innerCenterX,
      )
      return
    }

    if (row.compartment.type === 'drawer') {
      addDrawerFronts(
        group,
        node,
        materials,
        faceWidth,
        faceHeight,
        faceCenterY,
        inset ? openingBottomY : subCellBottomY,
        openingWidth,
        frontZ,
        compartmentDrawerCount(row.compartment),
        drawerBoxBackZ,
        drawerBoxDepth,
      )
      return
    }

    if (row.compartment.type === 'dishwasher') {
      addDishwasherCompartment(
        group,
        node,
        materials,
        faceWidth,
        faceHeight,
        faceCenterY,
        openingWidth,
        openingDepth,
        frontZ,
        index,
      )
      return
    }

    if (row.compartment.type === 'pull-out-pantry') {
      addPullOutPantryCompartment(
        group,
        node,
        materials,
        faceWidth,
        faceHeight,
        faceCenterY,
        openingWidth,
        openingDepth,
        frontZ,
        row.compartment,
        index,
      )
      return
    }

    if (row.compartment.type === 'oven' || row.compartment.type === 'microwave') {
      addApplianceCompartment(
        group,
        node,
        materials,
        row.compartment.type,
        faceWidth,
        faceHeight,
        faceCenterY,
        openingWidth,
        openingDepth,
        frontZ,
        index,
      )
      return
    }

    if (
      row.compartment.type === 'fridge-single' ||
      row.compartment.type === 'fridge-double' ||
      row.compartment.type === 'fridge-top-freezer' ||
      row.compartment.type === 'fridge-bottom-freezer'
    ) {
      addFridgeCompartment(
        group,
        node,
        materials,
        row.compartment.type,
        faceWidth,
        faceHeight,
        faceCenterY,
        openingWidth,
        openingDepth,
        frontZ,
        index,
      )
      return
    }

    if (isHoodCompartmentType(row.compartment.type)) {
      addRangeHoodCompartment(
        group,
        node,
        materials,
        row.compartment.type,
        plinth + row.y0,
        row.height,
        ctx,
        index,
      )
    }
  })

  return group
}
