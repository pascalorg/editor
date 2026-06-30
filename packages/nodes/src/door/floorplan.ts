import type {
  DoorNode,
  FloorplanGeometry,
  FloorplanPoint,
  GeometryContext,
  WallNode,
} from '@pascal-app/core'
import { buildOpeningPlacementDimensions } from '../shared/opening-placement-dimensions'

/**
 * Stage C floor-plan builder for door. 1:1 visual port of the legacy
 * floorplan-panel door rendering:
 *
 *   1. The door footprint rectangle in the wall cutout (themed
 *      accent stroke when selected).
 *   2. The door swing arc — a fixed quarter-circle from the hinge to
 *      the door's fully-open (90°) position, oriented by `hingesSide`
 *      and `swingDirection`. The angle is intentionally constant so the
 *      plan symbol stays static regardless of the door's live open-close
 *      state. Renders as a wedge of low-opacity fill so the swept area
 *      reads at a glance.
 *   3. The door leaf — a thick line from the hinge to the open
 *      position, terminating at the arc end.
 *
 * Double / french doors render two mirrored half-width leaves hinged at
 * the opposite outer ends, each with its own dashed arc, meeting
 * perpendicular at the centre — the standard double-door plan sign.
 *
 * Folding / bifold doors render a static zigzag accordion of panels
 * across the opening (porting the 3D folding geometry's panel layout),
 * with no swing arc.
 *   4. Center line through the cutout (matches the legacy's
 *      `getOpeningCenterLine` segment for visual continuity).
 *
 * Requires `ctx.parent` to be a wall (door.parentId is the wall it's
 * mounted on). Returns null when the parent isn't a wall (orphaned
 * doors during placement etc.).
 *
 * Skipped vs the full legacy for now: hinge / strike cubes (small
 * indicator squares at the rotation pivots), rounded-opening shape
 * variants, panic bar markers. Those are rare visual variations the
 * follow-up port can revisit.
 */
export function buildDoorFloorplan(node: DoorNode, ctx: GeometryContext): FloorplanGeometry | null {
  const wall = ctx.parent as WallNode | null
  if (wall?.type !== 'wall') return null

  const [x1, z1] = wall.start
  const [x2, z2] = wall.end
  const dx = x2 - x1
  const dz = z2 - z1
  const length = Math.sqrt(dx * dx + dz * dz)
  if (length < 1e-9) return null

  const dirX = dx / length
  const dirZ = dz / length
  // Perpendicular unit normal (rotate 90° CCW).
  const perpX = -dirZ
  const perpZ = dirX

  const distance = node.position[0]
  const width = node.width
  const depth = wall.thickness ?? 0.1
  const cx = x1 + dirX * distance
  const cz = z1 + dirZ * distance
  const halfWidth = width / 2
  const halfDepth = depth / 2

  const isPlanFlipped = isOpeningPlanFlipped(node.rotation)
  const baseHingesSide = node.hingesSide ?? 'left'
  const baseSwingDirection = node.swingDirection ?? 'inward'
  const hingesSide = isPlanFlipped ? (baseHingesSide === 'left' ? 'right' : 'left') : baseHingesSide
  const swingDirection = isPlanFlipped
    ? baseSwingDirection === 'inward'
      ? 'outward'
      : 'inward'
    : baseSwingDirection
  // The floor-plan door symbol is the standard architectural sign: the
  // leaf drawn at a fixed 90° open with its quarter-circle swing arc.
  // It deliberately ignores `node.swingAngle` / the live open-close
  // animation — the plan view documents how the door is hung, not how
  // far it currently happens to be open, so it must stay static.
  const swingAngle = Math.PI / 2

  // Footprint rectangle in the cutout.
  const points: readonly FloorplanPoint[] = [
    [cx - dirX * halfWidth + perpX * halfDepth, cz - dirZ * halfWidth + perpZ * halfDepth],
    [cx + dirX * halfWidth + perpX * halfDepth, cz + dirZ * halfWidth + perpZ * halfDepth],
    [cx + dirX * halfWidth - perpX * halfDepth, cz + dirZ * halfWidth - perpZ * halfDepth],
    [cx - dirX * halfWidth - perpX * halfDepth, cz - dirZ * halfWidth - perpZ * halfDepth],
  ]

  const view = ctx.viewState
  const palette = view?.palette
  const isSelected = view?.selected ?? false
  const isHighlighted = view?.highlighted ?? false
  const showSelectedChrome = isSelected || isHighlighted

  // Match the legacy floor-plan door render: unselected is a quiet
  // grey accent so the door reads as a hole in the wall, selected is
  // a full orange treatment (body + outline) so the user can see at
  // a glance which door is targeted by the inspector / move handle.
  const accentColor = showSelectedChrome ? '#f97316' : 'rgba(100, 116, 139, 0.82)'
  const accentMuted = accentColor
  const fillColor = showSelectedChrome ? '#fed7aa' : '#ffffff'

  const children: FloorplanGeometry[] = [
    // Background — the cutout is filled white so the swing arc sits on
    // a clean canvas (the wall hatch shows through otherwise).
    {
      kind: 'polygon',
      points,
      fill: fillColor,
      stroke: accentMuted,
      strokeWidth: showSelectedChrome ? 2 : 1.25,
      vectorEffect: 'non-scaling-stroke',
      strokeLinejoin: 'round',
    },
  ]

  // Swing geometry. A leaf is drawn as a wedge fill + dashed swing arc +
  // solid leaf line. `drawSwingLeaf` emits one leaf given its hinge, the
  // closed-leaf vector (hinge → strike, whose length is the swing
  // radius) and a signed swing angle. Single doors draw one leaf; double
  // / french doors draw two mirrored half-width leaves meeting in the
  // middle.
  const swingSign = swingDirection === 'inward' ? 1 : -1

  const drawSwingLeaf = (
    hX: number,
    hZ: number,
    closedX: number,
    closedZ: number,
    signedAngle: number,
  ) => {
    const radius = Math.sqrt(closedX * closedX + closedZ * closedZ)
    if (radius < 1e-3) return

    // Rotate the closed leaf vector around the hinge to the open tip.
    const cos = Math.cos(signedAngle)
    const sin = Math.sin(signedAngle)
    const tipX = hX + (closedX * cos - closedZ * sin)
    const tipZ = hZ + (closedX * sin + closedZ * cos)
    const closedTipX = hX + closedX
    const closedTipZ = hZ + closedZ

    // Swing arc — from closed tip to open tip via an arc centered at the
    // hinge. SVG `A`: rx ry rotation large-arc-flag sweep-flag x y. The
    // sweep flag flips with the signed angle direction.
    const sweepFlag = signedAngle >= 0 ? 1 : 0
    const arcPath = `M ${closedTipX} ${closedTipZ} A ${radius} ${radius} 0 0 ${sweepFlag} ${tipX} ${tipZ}`

    // Swept wedge fill (light, low opacity) — reads as the open zone.
    children.push({
      kind: 'path',
      d: `M ${hX} ${hZ} L ${closedTipX} ${closedTipZ} ${arcPath.replace(/^M [^A]+/, '').trim()} Z`,
      fill: accentColor,
      fillOpacity: showSelectedChrome ? 0.08 : 0.05,
      stroke: 'none',
    })

    // The arc itself, dashed to match the standard architectural plan
    // symbol, where the door's swing path is drawn as a broken arc.
    children.push({
      kind: 'path',
      d: arcPath,
      fill: 'none',
      stroke: accentColor,
      strokeWidth: showSelectedChrome ? 1.6 : 1.1,
      strokeOpacity: 0.85,
      // Dash is in screen pixels because of `non-scaling-stroke` (same
      // reason strokeWidth is a small pixel value, not metres).
      strokeDasharray: '5 4',
      vectorEffect: 'non-scaling-stroke',
      strokeLinecap: 'round',
    })

    // The door leaf — line from hinge to the open tip.
    children.push({
      kind: 'line',
      x1: hX,
      y1: hZ,
      x2: tipX,
      y2: tipZ,
      stroke: accentColor,
      strokeWidth: showSelectedChrome ? 2.4 : 1.7,
      strokeLinecap: 'round',
      vectorEffect: 'non-scaling-stroke',
    })
  }

  const isDoubleLeaf = node.doorType === 'double' || node.doorType === 'french'
  const isFolding = node.doorType === 'folding'
  const isSliding = node.doorType === 'sliding'
  const isPocket = node.doorType === 'pocket'
  const isBarn = node.doorType === 'barn'
  const isGarageSectional = node.doorType === 'garage-sectional'
  const isGarageRollup = node.doorType === 'garage-rollup'
  const isGarageTiltup = node.doorType === 'garage-tiltup'
  // Swing doors get the dashed swing arc; garage and any other types
  // fall through to just the opening footprint (the earlier behaviour).
  const isSwingDoor = node.doorType === 'hinged' || isDoubleLeaf
  // A frameless wall opening — drawn as a bare gap, no leaf / arc / panel
  // (mirrors the 3D system, which renders only the cutout for openings).
  const isOpening = node.openingKind === 'opening'

  if (isOpening) {
    // Open doorway — a frameless gap in the wall. No leaf, arc, or panel;
    // the cleared footprint above is the whole symbol.
  } else if (isFolding && width > 1e-3) {
    // Folding / bifold door: a static accordion of panels drawn as a
    // zigzag that folds toward the hinge side, occupying ~70% of the
    // opening (a real folding door stacks to one side, so it never
    // spans the full width). Mirrors the 3D folding geometry's
    // alternating-fold panels (`panelCount = leafCount === 2 ? 2 : 4`).
    // The fold span / depth are fixed so the plan symbol stays static
    // regardless of the live open state.
    const FOLD_SPAN_RATIO = 0.8
    const panelCount = node.leafCount === 2 ? 2 : 4
    const panelLen = (width * FOLD_SPAN_RATIO) / panelCount
    const peakDepth = panelLen * 0.7
    // Anchor the accordion's base line on the room-facing wall face (the
    // edge / corner of the opening box) rather than the wall centreline,
    // so the panels start from the box corner instead of its middle.
    const baseOffX = perpX * halfDepth * swingSign
    const baseOffZ = perpZ * halfDepth * swingSign
    // Start at the hinge edge and step toward the opposite jamb.
    const hingeTangentSign = hingesSide === 'left' ? 1 : -1
    const startX = cx - dirX * halfWidth * hingeTangentSign + baseOffX
    const startZ = cz - dirZ * halfWidth * hingeTangentSign + baseOffZ
    const stepX = dirX * panelLen * hingeTangentSign
    const stepZ = dirZ * panelLen * hingeTangentSign
    const peakX = perpX * peakDepth * swingSign
    const peakZ = perpZ * peakDepth * swingSign
    let d = ''
    for (let i = 0; i <= panelCount; i++) {
      const alongX = startX + stepX * i
      const alongZ = startZ + stepZ * i
      const isPeak = i % 2 === 1
      const px = alongX + (isPeak ? peakX : 0)
      const pz = alongZ + (isPeak ? peakZ : 0)
      d += `${i === 0 ? 'M' : 'L'} ${px} ${pz} `
    }
    children.push({
      kind: 'path',
      d: d.trim(),
      fill: 'none',
      stroke: accentColor,
      strokeWidth: showSelectedChrome ? 2.4 : 1.7,
      strokeLinecap: 'round',
      strokeLinejoin: 'round',
      vectorEffect: 'non-scaling-stroke',
    })
  } else if (isSliding && width > 1e-3) {
    // Sliding (bypass) door: two panels on parallel tracks that slide
    // past each other. Each spans a bit over half the opening and they
    // overlap in the centre, drawn at slightly different depths (one
    // toward each wall face). A slide arrow shows the direction. Static
    // regardless of the live open state.
    const slideSign = node.slideDirection === 'right' ? 1 : -1
    const panelHalfThick = Math.min(depth * 0.22, 0.03)
    const panelHalfLen = width * 0.275
    const panelRect = (centerAlong: number, perpSign: number): [number, number][] => {
      const rcx = cx + dirX * centerAlong + perpX * panelHalfThick * perpSign
      const rcz = cz + dirZ * centerAlong + perpZ * panelHalfThick * perpSign
      const aX = dirX * panelHalfLen
      const aZ = dirZ * panelHalfLen
      const tX = perpX * panelHalfThick
      const tZ = perpZ * panelHalfThick
      return [
        [rcx - aX + tX, rcz - aZ + tZ],
        [rcx + aX + tX, rcz + aZ + tZ],
        [rcx + aX - tX, rcz + aZ - tZ],
        [rcx - aX - tX, rcz - aZ - tZ],
      ]
    }
    const pushPanel = (points: [number, number][]) =>
      children.push({
        kind: 'polygon',
        points,
        fill: fillColor,
        stroke: accentColor,
        strokeWidth: showSelectedChrome ? 2 : 1.4,
        vectorEffect: 'non-scaling-stroke',
        strokeLinejoin: 'round',
      })
    // Left panel toward one face, right panel toward the other; they
    // overlap across the centre.
    pushPanel(panelRect(-halfWidth + panelHalfLen, 1))
    pushPanel(panelRect(halfWidth - panelHalfLen, -1))
    // Slide-direction arrow, centred and pushed clear of the wall face
    // so it doesn't overlap the wall or panels.
    const arrowPerp = -(halfDepth + Math.max(panelHalfThick * 4, halfWidth * 0.22))
    const arX = cx + perpX * arrowPerp
    const arZ = cz + perpZ * arrowPerp
    const tipX = arX + dirX * halfWidth * 0.5 * slideSign
    const tipZ = arZ + dirZ * halfWidth * 0.5 * slideSign
    const tailX = arX - dirX * halfWidth * 0.5 * slideSign
    const tailZ = arZ - dirZ * halfWidth * 0.5 * slideSign
    const headLen = halfWidth * 0.18
    const headSpread = headLen * 0.6
    const backX = tipX - dirX * headLen * slideSign
    const backZ = tipZ - dirZ * headLen * slideSign
    children.push({
      kind: 'path',
      d:
        `M ${tailX} ${tailZ} L ${tipX} ${tipZ} ` +
        `M ${backX + perpX * headSpread} ${backZ + perpZ * headSpread} L ${tipX} ${tipZ} ` +
        `L ${backX - perpX * headSpread} ${backZ - perpZ * headSpread}`,
      fill: 'none',
      stroke: accentColor,
      strokeWidth: showSelectedChrome ? 1.4 : 1,
      strokeOpacity: 0.85,
      strokeLinecap: 'round',
      strokeLinejoin: 'round',
      vectorEffect: 'non-scaling-stroke',
    })
  } else if (isPocket && width > 1e-3) {
    // Pocket door: the leaf slides into a cavity inside the wall. Shown
    // open — the leaf is tucked into the wall on the `slideDirection`
    // side, and the carved pocket slot is sized to match the leaf (no
    // empty cavity sticking out past it). The opening itself reads as a
    // clear doorway. Static regardless of the live open state.
    const slideSign = node.slideDirection === 'right' ? 1 : -1
    const leafHalfThick = Math.min(depth * 0.2, 0.025)
    const rectPoints = (
      centerAlong: number,
      halfLen: number,
      halfThick: number,
    ): [number, number][] => {
      const rcx = cx + dirX * centerAlong
      const rcz = cz + dirZ * centerAlong
      const aX = dirX * halfLen
      const aZ = dirZ * halfLen
      const tX = perpX * halfThick
      const tZ = perpZ * halfThick
      return [
        [rcx - aX + tX, rcz - aZ + tZ],
        [rcx + aX + tX, rcz + aZ + tZ],
        [rcx + aX - tX, rcz + aZ - tZ],
        [rcx - aX - tX, rcz - aZ - tZ],
      ]
    }
    // Show the door ~60% closed: the leaf covers 60% of the opening and
    // has slid 40% of its width into the pocket. The pocket side of the
    // wall stays solid (no carve) so the in-wall part of the leaf reads
    // as an outline over it, matching the standard plan symbol.
    const CLOSE_FRACTION = 0.6
    const openOffset = (1 - CLOSE_FRACTION) * width
    const leafCenter = slideSign * openOffset
    // The leaf is a thin white rectangle with an outline — white-filled
    // along its whole length, so the part sliding into the wall carves
    // its shape out in white rather than showing the solid wall behind.
    children.push({
      kind: 'polygon',
      points: rectPoints(leafCenter, halfWidth, leafHalfThick),
      fill: '#ffffff',
      stroke: accentColor,
      strokeWidth: showSelectedChrome ? 2 : 1.4,
      vectorEffect: 'non-scaling-stroke',
      strokeLinejoin: 'round',
    })
  } else if (isBarn && width > 1e-3) {
    // Barn / surface-sliding door: the leaf rides a surface-mounted
    // track in front of the wall. Shown as a solid panel parked over the
    // wall on the slide side, a dashed ghost of its closed position over
    // the opening, and a slide-direction arrow. `slideDirection` picks
    // the side. Static regardless of the live open state.
    const slideSign = node.slideDirection === 'right' ? 1 : -1
    const panelHalfThick = Math.min(depth * 0.3, 0.04)
    // Sit the panels clearly in front of the wall face with a gap, so
    // they read as surface-mounted rather than embedded in the wall.
    const gap = Math.max(panelHalfThick * 1.6, halfDepth * 0.6)
    const faceOffset = halfDepth + gap + panelHalfThick
    const frontRect = (centerAlong: number, halfLen: number): [number, number][] => {
      const fcx = cx + perpX * faceOffset + dirX * centerAlong
      const fcz = cz + perpZ * faceOffset + dirZ * centerAlong
      const aX = dirX * halfLen
      const aZ = dirZ * halfLen
      const tX = perpX * panelHalfThick
      const tZ = perpZ * panelHalfThick
      return [
        [fcx - aX + tX, fcz - aZ + tZ],
        [fcx + aX + tX, fcz + aZ + tZ],
        [fcx + aX - tX, fcz + aZ - tZ],
        [fcx - aX - tX, fcz - aZ - tZ],
      ]
    }
    // Dashed ghost of the closed position across the opening.
    children.push({
      kind: 'polygon',
      points: frontRect(0, halfWidth),
      fill: 'none',
      stroke: accentColor,
      strokeWidth: showSelectedChrome ? 1.4 : 1,
      strokeDasharray: '5 4',
      vectorEffect: 'non-scaling-stroke',
      strokeLinejoin: 'round',
    })
    // Solid panel parked over the wall on the slide side.
    children.push({
      kind: 'polygon',
      points: frontRect(slideSign * width, halfWidth),
      fill: accentColor,
      fillOpacity: showSelectedChrome ? 0.25 : 0.18,
      stroke: accentColor,
      strokeWidth: showSelectedChrome ? 2 : 1.4,
      vectorEffect: 'non-scaling-stroke',
      strokeLinejoin: 'round',
    })
    // Slide-direction arrow, pushed out beyond the panels so it clears
    // them instead of sitting on top.
    const arrowOffset = faceOffset + panelHalfThick + gap
    const arX = cx + perpX * arrowOffset
    const arZ = cz + perpZ * arrowOffset
    const tipX = arX + dirX * halfWidth * 0.8 * slideSign
    const tipZ = arZ + dirZ * halfWidth * 0.8 * slideSign
    const tailX = arX - dirX * halfWidth * 0.8 * slideSign
    const tailZ = arZ - dirZ * halfWidth * 0.8 * slideSign
    const headLen = halfWidth * 0.18
    const headSpread = headLen * 0.6
    const backX = tipX - dirX * headLen * slideSign
    const backZ = tipZ - dirZ * headLen * slideSign
    children.push({
      kind: 'path',
      d:
        `M ${tailX} ${tailZ} L ${tipX} ${tipZ} ` +
        `M ${backX + perpX * headSpread} ${backZ + perpZ * headSpread} L ${tipX} ${tipZ} ` +
        `L ${backX - perpX * headSpread} ${backZ - perpZ * headSpread}`,
      fill: 'none',
      stroke: accentColor,
      strokeWidth: showSelectedChrome ? 1.4 : 1,
      strokeOpacity: 0.85,
      strokeLinecap: 'round',
      strokeLinejoin: 'round',
      vectorEffect: 'non-scaling-stroke',
    })
  } else if (isGarageSectional && width > 1e-3) {
    // Garage sectional door: an overhead door that rolls up on side
    // tracks. Drawn as the closed leaf across the opening (just inside
    // the interior face), two tracks running into the garage, and a
    // dashed ghost of the door parked at the inner end of the tracks.
    // `swingDirection` picks the interior side. Static.
    // Mechanism (tracks / coil) sits on the interior side — matching the
    // 3D garage builders, which place it on the door-local -z side.
    const interiorSign = -swingSign
    const panelHalfThick = Math.min(depth * 0.22, 0.03)
    const trackLen = Math.max(width * 0.55, 0.6)
    const aX = dirX * halfWidth
    const aZ = dirZ * halfWidth
    const tX = perpX * panelHalfThick
    const tZ = perpZ * panelHalfThick
    const leafRect = (perpDist: number): [number, number][] => {
      const rcx = cx + perpX * perpDist
      const rcz = cz + perpZ * perpDist
      return [
        [rcx - aX + tX, rcz - aZ + tZ],
        [rcx + aX + tX, rcz + aZ + tZ],
        [rcx + aX - tX, rcz + aZ - tZ],
        [rcx - aX - tX, rcz - aZ - tZ],
      ]
    }
    const faceDist = interiorSign * halfDepth
    const innerDist = interiorSign * (halfDepth + trackLen)
    // Two side tracks running into the garage interior.
    for (const edgeSign of [-1, 1]) {
      const ex = cx + dirX * halfWidth * edgeSign
      const ez = cz + dirZ * halfWidth * edgeSign
      children.push({
        kind: 'line',
        x1: ex + perpX * faceDist,
        y1: ez + perpZ * faceDist,
        x2: ex + perpX * innerDist,
        y2: ez + perpZ * innerDist,
        stroke: accentColor,
        strokeWidth: showSelectedChrome ? 1.4 : 1,
        strokeOpacity: 0.85,
        strokeDasharray: '5 4',
        vectorEffect: 'non-scaling-stroke',
        strokeLinecap: 'round',
      })
    }
    // Dashed ghost of the door parked at the inner end of the tracks.
    children.push({
      kind: 'polygon',
      points: leafRect(innerDist - interiorSign * panelHalfThick),
      fill: 'none',
      stroke: accentColor,
      strokeWidth: showSelectedChrome ? 1.4 : 1,
      strokeDasharray: '5 4',
      vectorEffect: 'non-scaling-stroke',
      strokeLinejoin: 'round',
    })
    // Closed leaf, just inside the interior wall face.
    children.push({
      kind: 'polygon',
      points: leafRect(interiorSign * (halfDepth + panelHalfThick)),
      fill: fillColor,
      stroke: accentColor,
      strokeWidth: showSelectedChrome ? 2 : 1.4,
      vectorEffect: 'non-scaling-stroke',
      strokeLinejoin: 'round',
    })
  } else if (isGarageRollup && width > 1e-3) {
    // Roll-up garage door: the curtain coils into a barrel just inside
    // the opening (rather than running back on tracks like a sectional).
    // Drawn as the closed leaf across the opening, the coil barrel — a
    // capsule parallel to the wall — and a small coil hint at its centre.
    // `swingDirection` picks the interior side. Static.
    // Mechanism (tracks / coil) sits on the interior side — matching the
    // 3D garage builders, which place it on the door-local -z side.
    const interiorSign = -swingSign
    const panelHalfThick = Math.min(depth * 0.22, 0.03)
    const aX = dirX * halfWidth
    const aZ = dirZ * halfWidth
    const tX = perpX * panelHalfThick
    const tZ = perpZ * panelHalfThick
    // Closed leaf, just inside the interior wall face.
    const leafPerp = interiorSign * (halfDepth + panelHalfThick)
    const lcx = cx + perpX * leafPerp
    const lcz = cz + perpZ * leafPerp
    children.push({
      kind: 'polygon',
      points: [
        [lcx - aX + tX, lcz - aZ + tZ],
        [lcx + aX + tX, lcz + aZ + tZ],
        [lcx + aX - tX, lcz + aZ - tZ],
        [lcx - aX - tX, lcz - aZ - tZ],
      ],
      fill: fillColor,
      stroke: accentColor,
      strokeWidth: showSelectedChrome ? 2 : 1.4,
      vectorEffect: 'non-scaling-stroke',
      strokeLinejoin: 'round',
    })
    // Coil barrel — a capsule (stadium) parallel to the wall, just inside
    // the leaf. Built as a polygon so it's robust to wall orientation.
    const drumRadius = Math.min(Math.max(width * 0.12, 0.08), halfWidth * 0.5, 0.16)
    const drumPerp = interiorSign * (halfDepth + 2 * panelHalfThick + drumRadius)
    const dcx = cx + perpX * drumPerp
    const dcz = cz + perpZ * drumPerp
    const capL = Math.max(halfWidth - drumRadius, 0)
    const SAMPLES = 8
    const capsule: [number, number][] = []
    const c2x = dcx + dirX * capL
    const c2z = dcz + dirZ * capL
    for (let i = 0; i <= SAMPLES; i++) {
      const th = Math.PI / 2 - (Math.PI * i) / SAMPLES
      capsule.push([
        c2x + drumRadius * (Math.cos(th) * dirX + Math.sin(th) * perpX),
        c2z + drumRadius * (Math.cos(th) * dirZ + Math.sin(th) * perpZ),
      ])
    }
    const c1x = dcx - dirX * capL
    const c1z = dcz - dirZ * capL
    for (let i = 0; i <= SAMPLES; i++) {
      const ph = -Math.PI / 2 - (Math.PI * i) / SAMPLES
      capsule.push([
        c1x + drumRadius * (Math.cos(ph) * dirX + Math.sin(ph) * perpX),
        c1z + drumRadius * (Math.cos(ph) * dirZ + Math.sin(ph) * perpZ),
      ])
    }
    children.push({
      kind: 'polygon',
      points: capsule,
      fill: fillColor,
      stroke: accentColor,
      strokeWidth: showSelectedChrome ? 1.6 : 1.1,
      vectorEffect: 'non-scaling-stroke',
      strokeLinejoin: 'round',
    })
    // Coil hint — a small circle at the barrel centre.
    const innerR = drumRadius * 0.45
    const coil: [number, number][] = []
    for (let i = 0; i <= 12; i++) {
      const a = (Math.PI * 2 * i) / 12
      coil.push([
        dcx + innerR * (Math.cos(a) * dirX + Math.sin(a) * perpX),
        dcz + innerR * (Math.cos(a) * dirZ + Math.sin(a) * perpZ),
      ])
    }
    children.push({
      kind: 'polygon',
      points: coil,
      fill: 'none',
      stroke: accentColor,
      strokeWidth: showSelectedChrome ? 1.4 : 1,
      strokeOpacity: 0.85,
      vectorEffect: 'non-scaling-stroke',
      strokeLinejoin: 'round',
    })
  } else if (isGarageTiltup && width > 1e-3) {
    // Tilt-up (up-and-over) garage door: one rigid panel that pivots at
    // the top and swings up to park overhead inside the garage. Drawn as
    // the closed leaf across the opening, a dashed panel parked into the
    // interior, and a dashed curved swing path between them.
    // `swingDirection` is ignored; like the other garage builders the
    // mechanism is on the door-local -z (interior) side. Static.
    const interiorSign = -swingSign
    const panelHalfThick = Math.min(depth * 0.22, 0.03)
    const projDepth = Math.max(width * 0.5, 0.7)
    const aX = dirX * halfWidth
    const aZ = dirZ * halfWidth
    const tX = perpX * panelHalfThick
    const tZ = perpZ * panelHalfThick
    const leafRect = (perpDist: number): [number, number][] => {
      const rcx = cx + perpX * perpDist
      const rcz = cz + perpZ * perpDist
      return [
        [rcx - aX + tX, rcz - aZ + tZ],
        [rcx + aX + tX, rcz + aZ + tZ],
        [rcx + aX - tX, rcz + aZ - tZ],
        [rcx - aX - tX, rcz - aZ - tZ],
      ]
    }
    const closedPerp = interiorSign * (halfDepth + panelHalfThick)
    const parkedPerp = interiorSign * (halfDepth + projDepth)
    // Dashed parked panel, projected overhead into the interior.
    children.push({
      kind: 'polygon',
      points: leafRect(parkedPerp),
      fill: 'none',
      stroke: accentColor,
      strokeWidth: showSelectedChrome ? 1.4 : 1,
      strokeDasharray: '5 4',
      vectorEffect: 'non-scaling-stroke',
      strokeLinejoin: 'round',
    })
    // Dashed curved swing path from the closed leaf to the parked panel.
    const startX = cx + perpX * closedPerp
    const startZ = cz + perpZ * closedPerp
    const endX = cx + perpX * parkedPerp
    const endZ = cz + perpZ * parkedPerp
    const midPerp = interiorSign * (halfDepth + projDepth * 0.5)
    const ctrlX = cx + perpX * midPerp + dirX * projDepth * 0.5
    const ctrlZ = cz + perpZ * midPerp + dirZ * projDepth * 0.5
    children.push({
      kind: 'path',
      d: `M ${startX} ${startZ} Q ${ctrlX} ${ctrlZ} ${endX} ${endZ}`,
      fill: 'none',
      stroke: accentColor,
      strokeWidth: showSelectedChrome ? 1.4 : 1,
      strokeOpacity: 0.85,
      strokeDasharray: '5 4',
      strokeLinecap: 'round',
      vectorEffect: 'non-scaling-stroke',
    })
    // Closed leaf, just inside the interior wall face.
    children.push({
      kind: 'polygon',
      points: leafRect(closedPerp),
      fill: fillColor,
      stroke: accentColor,
      strokeWidth: showSelectedChrome ? 2 : 1.4,
      vectorEffect: 'non-scaling-stroke',
      strokeLinejoin: 'round',
    })
  } else if (isSwingDoor && swingAngle > 1e-3 && width > 1e-3) {
    if (isDoubleLeaf) {
      // Two half-width leaves hinged at the opposite outer ends, each
      // swinging toward the centre. `hingesSide` is irrelevant for a
      // symmetric double door; only `swingDirection` chooses the side.
      const halfLeafX = dirX * halfWidth
      const halfLeafZ = dirZ * halfWidth
      // Leaf at the start edge: closed leaf points toward the centre.
      drawSwingLeaf(cx - halfLeafX, cz - halfLeafZ, halfLeafX, halfLeafZ, swingAngle * swingSign)
      // Leaf at the end edge: closed leaf points the other way, swung
      // with the opposite sign so both meet perpendicular at the centre.
      drawSwingLeaf(cx + halfLeafX, cz + halfLeafZ, -halfLeafX, -halfLeafZ, -swingAngle * swingSign)
    } else {
      // Single leaf hinged at one end, strike at the opposite end.
      const hingeTangentSign = hingesSide === 'left' ? 1 : -1
      drawSwingLeaf(
        cx - dirX * halfWidth * hingeTangentSign,
        cz - dirZ * halfWidth * hingeTangentSign,
        dirX * width * hingeTangentSign,
        dirZ * width * hingeTangentSign,
        swingAngle * swingSign * hingeTangentSign,
      )
    }
  }

  // Move handle — orange dot at the door center. Only visible when
  // selected. Pointer-down on this triggers `setMovingNode(door)`
  // → `FloorplanRegistryMoveOverlay` → `def.floorplanMoveTarget`.
  if (isSelected) {
    children.push({
      kind: 'move-handle',
      point: [cx, cz],
    })

    // Width-resize arrows at each side of the door (along the wall
    // direction). Pointer-down on either routes through the door's
    // `resize-width` affordance — anchored at the opposite edge, clamped
    // to wall bounds. Mirrors the 3D `DoorSideArrow` width drag.
    const startEdgeX = cx - dirX * halfWidth
    const startEdgeZ = cz - dirZ * halfWidth
    const endEdgeX = cx + dirX * halfWidth
    const endEdgeZ = cz + dirZ * halfWidth
    children.push({
      kind: 'move-arrow',
      point: [startEdgeX, startEdgeZ],
      angle: Math.atan2(-dirZ, -dirX),
      affordance: 'resize-width',
      payload: { side: 'start' },
    })
    children.push({
      kind: 'move-arrow',
      point: [endEdgeX, endEdgeZ],
      angle: Math.atan2(dirZ, dirX),
      affordance: 'resize-width',
      payload: { side: 'end' },
    })
  }

  // Placement-measurement dimensions — distances to adjacent openings
  // (or wall ends) on each side. Only visible while actively moving
  // (the user clicked Move or grabbed the orange dot).
  if (view?.moving) {
    for (const dim of buildOpeningPlacementDimensions(node, ctx)) {
      children.push(dim)
    }
  }

  return { kind: 'group', children }
}

/**
 * The opening's wall-normal orientation is encoded in the door's Y
 * rotation. When the door faces "inward" along an angle in [π/2, 3π/2],
 * the rendering needs the hinge side + swing direction flipped to
 * keep the visual swing on the correct side of the wall.
 *
 * Mirrors `isOpeningPlanFlipped` in `floorplan-panel.tsx`.
 */
function isOpeningPlanFlipped(rotation: readonly [number, number, number]): boolean {
  const normalized =
    ((((rotation[1] % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2)) + 1e-6) % (Math.PI * 2)
  return normalized > Math.PI / 2 && normalized < (Math.PI * 3) / 2
}
