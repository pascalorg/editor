import type {
  AnyNodeId,
  CabinetModuleNode,
  CabinetNode,
  FloorplanGeometry,
  FloorplanPoint,
  GeometryContext,
} from '@pascal-app/core'
import { floorplanGeometryMetadata, readFloorplanContext } from '@pascal-app/editor'
import { GAS_HOB_BURNER_RADIUS, gasHobBurners, inductionZones } from './geometry/cooktop'
import { FAUCET_SETBACK, sinkBowls } from './geometry/sink'
import { getRunSpanEnds, getRunSpans } from './run-layout'
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
// Sheet drafting (permit set): casework in near-black ink — the countertop
// line the heavier one, module divisions light, appliance labels bold.
const DRAFT_STROKE = '#1f2937'
const DRAFT_DIVISION_STROKE = '#6b7280'
const DRAFT_LABEL_FILL = '#111827'
const DRAFT_LABEL_SIZE = 0.11
const DRAFT_LABEL_PT = 6.5

export function buildCabinetFloorplan(
  node: CabinetNode,
  ctx: GeometryContext,
): FloorplanGeometry | null {
  const modules = ctx.children.filter(
    (child): child is CabinetModuleNode => child.type === 'cabinet-module',
  )

  const showSelectedChrome = (ctx.viewState?.selected || ctx.viewState?.highlighted) ?? false
  const stroke =
    showSelectedChrome && ctx.viewState?.palette
      ? ctx.viewState.palette.selectedStroke
      : BODY_STROKE

  const spans =
    modules.length > 0
      ? getRunSpans(modules, { runTier: node.runTier })
      : [
          {
            minX: -node.width / 2,
            maxX: node.width / 2,
            centerX: 0,
            centerZ: 0,
            width: node.width,
            depth: node.depth,
            minZ: -node.depth / 2,
            maxZ: node.depth / 2,
            topY: node.carcassHeight,
            hasCountertop: node.runTier === 'base' && node.withCountertop,
          },
        ]
  const overhang = node.withCountertop ? node.countertopOverhang : 0
  const barEdge = node.barLedge?.edge
  const backOverhang = node.withCountertop && barEdge !== 'back' ? node.countertopBackOverhang : 0
  const spanEnds = getRunSpanEnds(node, ctx, spans)
  const children: FloorplanGeometry[] = []
  const drafting = readFloorplanContext(ctx).drafting
  const runStroke = drafting ? DRAFT_STROKE : stroke
  const runStrokeWidth = drafting ? 0.014 : showSelectedChrome ? 0.03 : 0.022

  for (const span of spans) {
    const spanIndex = spans.indexOf(span)
    const ends = spanEnds[spanIndex]!
    const hasSlab = node.withCountertop && span.hasCountertop
    // Countertop slab outline — the heavier line a kitchen plan reads first.
    // Tall spans (no countertop) fall back to their carcass footprint. Side
    // overhangs come from the shared span-end math so neighbor runs, L-corner
    // legs, and side bars trim the plan outline exactly like the 3D slab.
    const front = span.maxZ + (hasSlab ? overhang : 0)
    const slabBack = span.minZ - (hasSlab ? backOverhang : 0)
    // A finished decorative back panel adds real depth behind the carcass.
    const back = Math.min(
      slabBack,
      node.withFinishedBack ? span.minZ - node.boardThickness : span.minZ,
    )
    const left = span.minX - (hasSlab ? ends.leftOverhang : 0)
    const right = span.maxX + (hasSlab ? ends.rightOverhang : 0)
    children.push({
      kind: 'rect',
      x: left,
      y: back,
      width: Math.max(0.01, right - left),
      height: Math.max(0.01, front - back),
      fill: node.runTier === 'wall' ? 'none' : BODY_FILL,
      stroke: runStroke,
      strokeWidth: runStrokeWidth,
      strokeDasharray: node.runTier === 'wall' ? ABOVE_CUT_DASH : undefined,
      opacity: drafting ? 1 : 0.95,
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
              y: slabBack,
              width: node.barLedge.depth,
              height: Math.max(0.01, front - slabBack),
            }
      children.push({
        kind: 'rect',
        ...bar,
        fill: BODY_FILL,
        stroke: runStroke,
        strokeWidth: runStrokeWidth,
        opacity: drafting ? 1 : 0.95,
      })
    }
  }

  const world = resolveCabinetWorldPose(node, ctx)
  return withWorldChrome(world.position, world.rotation, children, ctx, showSelectedChrome)
}

export function buildCabinetModuleFloorplan(
  node: CabinetModuleNode,
  ctx: GeometryContext,
): FloorplanGeometry | null {
  const world = resolveCabinetWorldPose(node, ctx)
  const parent = resolveCabinetParent(node.parentId as AnyNodeId | undefined, ctx)
  return buildModuleSymbol(node, world.position, world.rotation, ctx, {
    aboveCutPlane:
      parent?.type === 'cabinet-module'
        ? true
        : parent?.type === 'cabinet' && parent.runTier === 'wall',
    vanity: isVanityModule(node, parent),
  })
}

function composeChild(
  parentPosition: readonly [number, number, number],
  parentRotation: number,
  childPosition: readonly [number, number, number],
  childRotation = 0,
): { position: [number, number, number]; rotation: number } {
  const cos = Math.cos(parentRotation)
  const sin = Math.sin(parentRotation)
  const [lx, ly, lz] = childPosition
  return {
    position: [
      parentPosition[0] + lx * cos + lz * sin,
      parentPosition[1] + ly,
      parentPosition[2] - lx * sin + lz * cos,
    ],
    rotation: parentRotation + childRotation,
  }
}

function resolveCabinetParent(
  id: AnyNodeId | undefined,
  ctx: GeometryContext,
): CabinetNode | CabinetModuleNode | null {
  if (!id) return null
  if (
    ctx.parent?.id === id &&
    (ctx.parent.type === 'cabinet' || ctx.parent.type === 'cabinet-module')
  ) {
    return ctx.parent
  }
  const resolved = ctx.resolve(id)
  return resolved?.type === 'cabinet' || resolved?.type === 'cabinet-module' ? resolved : null
}

function resolveCabinetWorldPose(
  node: Pick<CabinetNode | CabinetModuleNode, 'position' | 'rotation' | 'parentId'>,
  ctx: GeometryContext,
): { position: [number, number, number]; rotation: number } {
  const parent = resolveCabinetParent(node.parentId as AnyNodeId | undefined, ctx)
  if (parent) {
    const worldParent = resolveCabinetWorldPose(parent, ctx)
    return composeChild(worldParent.position, worldParent.rotation, node.position, node.rotation)
  }
  return {
    position: [...node.position] as [number, number, number],
    rotation: node.rotation,
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
  opts: { aboveCutPlane: boolean; vanity?: boolean },
): FloorplanGeometry {
  const showSelectedChrome = (ctx.viewState?.selected || ctx.viewState?.highlighted) ?? false
  const drafting = readFloorplanContext(ctx).drafting
  const stroke =
    showSelectedChrome && ctx.viewState?.palette
      ? ctx.viewState.palette.selectedStroke
      : BODY_STROKE

  const stack = stackForCabinet(node)
  const showCompartments = node.moduleKind !== 'corner-filler'
  const hoodOnly = stack.length > 0 && stack.every((c) => isHoodCompartmentType(c.type))
  const dashed = opts.aboveCutPlane || hoodOnly

  const hw = node.width / 2
  const hd = node.depth / 2
  const appliance = moduleLabel(stack) !== null && !stack.some((c) => c.type === 'pull-out-pantry')
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
      // On a sheet the countertop line (the run) carries the weight; module
      // divisions are light, an appliance's box and anything above the cut
      // (wall cabinets, dashed) print in full ink.
      stroke: drafting ? (dashed || appliance ? DRAFT_STROKE : DRAFT_DIVISION_STROKE) : stroke,
      strokeWidth: drafting
        ? dashed || appliance
          ? 0.01
          : 0.006
        : showSelectedChrome
          ? 0.03
          : 0.018,
      strokeDasharray: dashed ? ABOVE_CUT_DASH : undefined,
      opacity: drafting ? 1 : dashed ? 0.85 : 0.95,
    },
  ]

  if (!dashed && showCompartments) {
    // Cabinet front edge, inset from the countertop line the run draws. A
    // sheet shows the countertop line alone.
    if (!drafting) {
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
    }
    for (const compartment of stack) {
      children.push(
        ...compartmentSymbol(compartment, node, drafting ? DRAFT_STROKE : SYMBOL_STROKE),
      )
    }
  }

  // Appliance labels live in world space with `upright` so they read
  // horizontally regardless of run rotation and plan-view rotation.
  const worldChildren: FloorplanGeometry[] = []
  const label =
    dashed || !showCompartments
      ? null
      : drafting
        ? draftingModuleLabel(stack, opts.vanity === true)
        : moduleLabel(stack)
  if (label && drafting) {
    // a sheet prints the label at a fixed paper size, like every fixture label,
    // in the FRONT half of the module — clear of the wall-cabinet line above
    // the back half — on the (first) bowl of a sink, before the burners of a range
    const [lx, ly] = draftingLabelOffset(label, stack, node)
    const cos = Math.cos(rotation)
    const sin = Math.sin(rotation)
    worldChildren.push({
      kind: 'text',
      x: position[0] + lx * cos + ly * sin,
      y: position[2] - lx * sin + ly * cos,
      text: label,
      fontSize: DRAFT_LABEL_SIZE,
      fill: DRAFT_LABEL_FILL,
      fontWeight: 700,
      fontFamily: 'Helvetica, Arial, sans-serif',
      textAnchor: 'middle',
      dominantBaseline: 'central',
      upright: true,
      metadata: floorplanGeometryMetadata({ textSizePt: DRAFT_LABEL_PT }),
    })
  } else if (label) {
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
  symbolStroke: string = SYMBOL_STROKE,
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
      stroke: symbolStroke,
      strokeWidth: SYMBOL_STROKE_WIDTH,
      opacity: 0.9,
    }))
    // Faucet dot behind the bowls (back = -y), aligned with the 3D faucet
    // setback so the plan symbol stays centered in the rear strip.
    children.push({
      kind: 'circle',
      cx: 0,
      cy: -(bowls[0]?.depth ?? node.depth * 0.6) / 2 - FAUCET_SETBACK,
      r: 0.02,
      fill: 'none',
      stroke: symbolStroke,
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
        stroke: symbolStroke,
        strokeWidth: SYMBOL_STROKE_WIDTH,
        opacity: 0.9,
      },
      {
        kind: 'circle',
        cx: ring.x,
        cy: ring.y,
        r: ring.r * 0.45,
        fill: 'none',
        stroke: symbolStroke,
        strokeWidth: SYMBOL_STROKE_WIDTH * 0.8,
        opacity: 0.7,
      },
    ])
  }

  return []
}

/** Where a drafting label sits in module-local plan metres (front = +y). */
function draftingLabelOffset(
  label: string,
  stack: CabinetCompartment[],
  node: Pick<CabinetModuleNode, 'width' | 'depth' | 'boardThickness'>,
): [number, number] {
  const hd = node.depth / 2
  if (label === 'R' || label === 'CT') return [0, Math.max(0, hd - 0.065)]
  const sink = stack.find((c) => c.type === 'sink')
  if (sink) {
    const innerWidth = Math.max(0.01, node.width - 2 * node.boardThickness)
    const bowl = sinkBowls(compartmentSinkLayout(sink), innerWidth, node.depth)[0]
    const front = bowl ? bowl.depth / 2 - DRAFT_LABEL_SIZE * 0.6 : 0
    return [bowl?.centerX ?? 0, Math.max(0, Math.min(node.depth * 0.12, front))]
  }
  return [0, node.depth >= 0.45 ? node.depth * 0.12 : 0]
}

/**
 * The permit-set label for a module: what `moduleLabel` names, plus the
 * plumbing a plans examiner looks for — a sink is LAV in a vanity, SINK in a
 * kitchen — and an oven under a cooktop is the range, R.
 */
function draftingModuleLabel(stack: CabinetCompartment[], vanity: boolean): string | null {
  if (stack.some((c) => c.type === 'sink')) return vanity ? 'LAV' : 'SINK'
  const hasCooktop = stack.some((c) => isCooktopCompartmentType(c.type))
  const hasOven = stack.some((c) => c.type === 'oven')
  if (hasCooktop && hasOven) return 'R'
  if (hasCooktop) return 'CT'
  return moduleLabel(stack)
}

/** A bathroom vanity's module, not a kitchen's: its run is a vanity, or it is vanity-shallow. */
function isVanityModule(
  node: CabinetModuleNode,
  parent: CabinetNode | CabinetModuleNode | null,
): boolean {
  const roles = [node.metadata, parent?.metadata].map((metadata) => {
    const m = (metadata ?? {}) as Record<string, unknown>
    const kitchen = m.kitchen as { role?: unknown } | undefined
    const furnish = m.furnish as { role?: unknown } | undefined
    return `${kitchen?.role ?? ''} ${furnish?.role ?? ''}`
  })
  if (roles.some((role) => /vanity/i.test(role))) return true
  if (/vanity|\bbath/i.test(`${parent?.name ?? ''} ${node.name ?? ''}`)) return true
  // a kitchen base is 24 in deep; a vanity 21 in
  return node.depth < 0.575
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
