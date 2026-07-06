import type {
  AnyNodeId,
  CabinetModuleNode,
  CabinetNode,
  FloorplanGeometry,
  FloorplanPoint,
  GeometryContext,
} from '@pascal-app/core'
import { GAS_HOB_BURNER_RADIUS, gasHobBurners, inductionZones } from './geometry/cooktop'
import { sinkBowls } from './geometry/sink'
import { getRunSpans } from './run-layout'
import {
  type CabinetCompartment,
  compartmentCooktopLayout,
  compartmentSinkLayout,
  isCooktopCompartmentType,
  isFridgeCompartmentType,
  isHoodCompartmentType,
  stackForCabinet,
} from './stack'

const BODY_FILL = '#ffffff'
const BODY_STROKE = '#7c7468'
const SYMBOL_STROKE = '#6f675b'
const LABEL_FILL = '#6f675b'
// Architectural convention: elements above the ~1.2m cut plane (wall
// cabinets, hoods) draw with a dashed outline; floor-standing units solid.
const ABOVE_CUT_DASH = '0.08 0.06'
const SYMBOL_STROKE_WIDTH = 0.014

export function buildCabinetFloorplan(
  node: CabinetNode,
  ctx: GeometryContext,
): FloorplanGeometry | null {
  const modules = ctx.children.filter(
    (child): child is CabinetModuleNode => child.type === 'cabinet-module',
  )
  if (modules.length === 0) return null

  const showSelectedChrome = (ctx.viewState?.selected || ctx.viewState?.highlighted) ?? false
  const stroke =
    showSelectedChrome && ctx.viewState?.palette
      ? ctx.viewState.palette.selectedStroke
      : BODY_STROKE

  const spans = getRunSpans(modules)
  const overhang = node.withCountertop ? node.countertopOverhang : 0
  const barEdge = node.barLedge?.edge
  const backOverhang = node.withCountertop && barEdge !== 'back' ? node.countertopBackOverhang : 0
  const children: FloorplanGeometry[] = []

  for (const span of spans) {
    const spanIndex = spans.indexOf(span)
    // Countertop slab outline — the heavier line a kitchen plan reads first.
    // Tall spans (no countertop) fall back to their carcass footprint.
    const front = span.maxZ + (span.hasCountertop ? overhang : 0)
    const back = span.minZ - (span.hasCountertop ? backOverhang : 0)
    const left = span.minX - (span.hasCountertop && barEdge !== 'left' ? overhang : 0)
    const right = span.maxX + (span.hasCountertop && barEdge !== 'right' ? overhang : 0)
    children.push({
      kind: 'rect',
      x: left,
      y: back,
      width: Math.max(0.01, right - left),
      height: Math.max(0.01, front - back),
      fill: BODY_FILL,
      stroke,
      strokeWidth: showSelectedChrome ? 0.03 : 0.022,
      opacity: 0.95,
    })

    // Raised bar slab reads as its own counter band along the chosen edge
    // (bar height sits below the ~1.2m cut plane, so it draws solid). Side
    // bars apply only to the end span on that side.
    const spanHasBar =
      node.barLedge &&
      span.hasCountertop &&
      (barEdge === 'back' ||
        (barEdge === 'left' && spanIndex === 0) ||
        (barEdge === 'right' && spanIndex === spans.length - 1))
    if (node.barLedge && spanHasBar) {
      const bar =
        barEdge === 'back'
          ? {
              x: left,
              y:
                span.minZ - (node.withFinishedBack ? node.boardThickness : 0) - node.barLedge.depth,
              width: Math.max(0.01, right - left),
              height: node.barLedge.depth,
            }
          : {
              x: barEdge === 'left' ? span.minX - node.barLedge.depth : span.maxX,
              y: back,
              width: node.barLedge.depth,
              height: Math.max(0.01, front - back),
            }
      children.push({
        kind: 'rect',
        ...bar,
        fill: BODY_FILL,
        stroke,
        strokeWidth: showSelectedChrome ? 0.03 : 0.022,
        opacity: 0.95,
      })
    }
  }

  return withWorldChrome(node.position, node.rotation, children, ctx, showSelectedChrome)
}

export function buildCabinetModuleFloorplan(
  node: CabinetModuleNode,
  ctx: GeometryContext,
): FloorplanGeometry | null {
  if (ctx.parent?.type === 'cabinet') {
    const parent = ctx.parent as CabinetNode
    const world = composeChild(parent.position, parent.rotation, node.position)
    return buildModuleSymbol(node, world.position, parent.rotation + node.rotation, ctx, {
      aboveCutPlane: false,
    })
  }
  // A nested wall cabinet: parent is a base cabinet-module, whose own parent is the run.
  if (ctx.parent?.type === 'cabinet-module') {
    const baseModule = ctx.parent as CabinetModuleNode
    const run = ctx.resolve<CabinetNode>(baseModule.parentId as AnyNodeId)
    if (run?.type === 'cabinet') {
      const base = composeChild(run.position, run.rotation, baseModule.position)
      const world = composeChild(base.position, run.rotation, node.position)
      return buildModuleSymbol(node, world.position, run.rotation + node.rotation, ctx, {
        aboveCutPlane: true,
      })
    }
  }
  return buildModuleSymbol(node, node.position, node.rotation, ctx, { aboveCutPlane: false })
}

function composeChild(
  parentPosition: readonly [number, number, number],
  parentRotation: number,
  childPosition: readonly [number, number, number],
): { position: [number, number, number] } {
  const cos = Math.cos(parentRotation)
  const sin = Math.sin(parentRotation)
  const [lx, ly, lz] = childPosition
  return {
    position: [
      parentPosition[0] + lx * cos + lz * sin,
      parentPosition[1] + ly,
      parentPosition[2] - lx * sin + lz * cos,
    ],
  }
}

/**
 * Wrap module-local symbol children in the plan transform and append
 * world-space chrome (labels, selection handle). Plan rotate is `-rotation`
 * so a Three.js Y-rotation (CCW top-down) turns the same way in the SVG plan.
 */
function withWorldChrome(
  position: readonly [number, number, number],
  rotation: number,
  localChildren: FloorplanGeometry[],
  ctx: GeometryContext,
  showSelectedChrome: boolean,
  worldChildren: FloorplanGeometry[] = [],
): FloorplanGeometry {
  const [cx, , cz] = position
  const children: FloorplanGeometry[] = [
    {
      kind: 'group',
      transform: { translate: [cx, cz], rotate: -rotation },
      children: localChildren,
    },
    ...worldChildren,
  ]
  if (showSelectedChrome) {
    children.push({ kind: 'move-handle', point: [cx, cz] as FloorplanPoint })
  }
  return { kind: 'group', children }
}

function buildModuleSymbol(
  node: CabinetModuleNode,
  position: readonly [number, number, number],
  rotation: number,
  ctx: GeometryContext,
  opts: { aboveCutPlane: boolean },
): FloorplanGeometry {
  const showSelectedChrome = (ctx.viewState?.selected || ctx.viewState?.highlighted) ?? false
  const stroke =
    showSelectedChrome && ctx.viewState?.palette
      ? ctx.viewState.palette.selectedStroke
      : BODY_STROKE

  const stack = stackForCabinet(node)
  const hoodOnly = stack.length > 0 && stack.every((c) => isHoodCompartmentType(c.type))
  const dashed = opts.aboveCutPlane || hoodOnly

  const hw = node.width / 2
  const hd = node.depth / 2
  const children: FloorplanGeometry[] = [
    {
      kind: 'rect',
      x: -hw,
      y: -hd,
      width: node.width,
      height: node.depth,
      // Above-cut-plane units draw as a dashed open outline so the base
      // cabinet underneath stays readable.
      fill: dashed ? 'none' : BODY_FILL,
      stroke,
      strokeWidth: showSelectedChrome ? 0.03 : 0.018,
      strokeDasharray: dashed ? ABOVE_CUT_DASH : undefined,
      opacity: dashed ? 0.85 : 0.95,
    },
  ]

  if (!dashed) {
    // Cabinet front edge, inset from the countertop line the run draws.
    children.push({
      kind: 'line',
      x1: -hw,
      y1: hd,
      x2: hw,
      y2: hd,
      stroke,
      strokeWidth: 0.03,
      opacity: 0.5,
    })
    for (const compartment of stack) {
      children.push(...compartmentSymbol(compartment, node))
    }
  }

  // Appliance labels live in world space with `upright` so they read
  // horizontally regardless of run rotation and plan-view rotation.
  const worldChildren: FloorplanGeometry[] = []
  const label = dashed ? null : moduleLabel(stack)
  if (label) {
    worldChildren.push({
      kind: 'text',
      x: position[0],
      y: position[2],
      text: label,
      fontSize: Math.min(0.16, node.width * 0.3),
      fill: LABEL_FILL,
      fontWeight: 600,
      textAnchor: 'middle',
      dominantBaseline: 'middle',
      opacity: 0.9,
      upright: true,
    })
  }

  return withWorldChrome(position, rotation, children, ctx, showSelectedChrome, worldChildren)
}

/** Plan symbol for one compartment, in module-local metres (front = +y). */
function compartmentSymbol(
  compartment: CabinetCompartment,
  node: Pick<CabinetModuleNode, 'width' | 'depth' | 'boardThickness'>,
): FloorplanGeometry[] {
  if (compartment.type === 'sink') {
    const innerWidth = Math.max(0.01, node.width - 2 * node.boardThickness)
    const bowls = sinkBowls(compartmentSinkLayout(compartment), innerWidth, node.depth)
    const children: FloorplanGeometry[] = bowls.map((bowl) => ({
      kind: 'rect',
      x: bowl.centerX - bowl.width / 2,
      y: -bowl.depth / 2,
      width: bowl.width,
      height: bowl.depth,
      rx: 0.04,
      ry: 0.04,
      fill: 'none',
      stroke: SYMBOL_STROKE,
      strokeWidth: SYMBOL_STROKE_WIDTH,
      opacity: 0.9,
    }))
    // Faucet dot behind the bowls (back = -y).
    children.push({
      kind: 'circle',
      cx: 0,
      cy: -(bowls[0]?.depth ?? node.depth * 0.6) / 2 - 0.045,
      r: 0.026,
      fill: 'none',
      stroke: SYMBOL_STROKE,
      strokeWidth: SYMBOL_STROKE_WIDTH,
      opacity: 0.9,
    })
    return children
  }

  if (isCooktopCompartmentType(compartment.type)) {
    const layout = compartmentCooktopLayout(compartment, compartment.type)
    const rings =
      compartment.type === 'cooktop-gas'
        ? gasHobBurners(layout).map((burner) => ({
            x: burner.x,
            y: burner.z,
            r: GAS_HOB_BURNER_RADIUS * burner.size,
          }))
        : inductionZones(layout).map((zone) => ({ x: zone.x, y: zone.z, r: zone.radius }))
    return rings.flatMap((ring): FloorplanGeometry[] => [
      {
        kind: 'circle',
        cx: ring.x,
        cy: ring.y,
        r: ring.r,
        fill: 'none',
        stroke: SYMBOL_STROKE,
        strokeWidth: SYMBOL_STROKE_WIDTH,
        opacity: 0.9,
      },
      {
        kind: 'circle',
        cx: ring.x,
        cy: ring.y,
        r: ring.r * 0.45,
        fill: 'none',
        stroke: SYMBOL_STROKE,
        strokeWidth: SYMBOL_STROKE_WIDTH * 0.8,
        opacity: 0.7,
      },
    ])
  }

  return []
}

/** Standard plan abbreviation for the module's appliance content. */
function moduleLabel(stack: CabinetCompartment[]): string | null {
  if (stack.some((c) => isFridgeCompartmentType(c.type))) return 'REF'
  if (stack.some((c) => c.type === 'dishwasher')) return 'DW'
  const hasOven = stack.some((c) => c.type === 'oven')
  const hasMicrowave = stack.some((c) => c.type === 'microwave')
  if (hasOven && hasMicrowave) return 'OV/MW'
  if (hasOven) return 'OV'
  if (hasMicrowave) return 'MW'
  if (stack.some((c) => c.type === 'pull-out-pantry')) return 'PAN'
  return null
}
