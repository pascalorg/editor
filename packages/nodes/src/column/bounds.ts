import type { ColumnNode } from '@pascal-app/core'
import {
  columnCapitalBlocks,
  columnShaftLayout,
  getShaftScaleAt,
  getShaftSegmentCount,
  getShaftTwistRadians,
} from './shape'

/** Conservative, origin-centred XZ envelope shared by plan, collision and handles. */
export function columnFootprintHalf(n: ColumnNode): { halfX: number; halfZ: number } {
  if (n.source) {
    const { min, max } = n.source.manifest.bounds
    return {
      halfX: Math.max(Math.abs(min[0]), Math.abs(max[0])),
      halfZ: Math.max(Math.abs(min[2]), Math.abs(max[2])),
    }
  }
  let halfX = 0,
    halfZ = 0
  const include = (x: number, z = x) => {
    halfX = Math.max(halfX, x)
    halfZ = Math.max(halfZ, z)
  }
  const rectangular = n.crossSection === 'square' || n.crossSection === 'rectangular'
  const block = (scale: number) =>
    include(
      rectangular ? (n.width * scale) / 2 : n.radius * scale,
      rectangular ? (n.depth * scale) / 2 : n.radius * scale,
    )
  if (n.supportStyle !== 'vertical') {
    const w = Math.max(0.04, n.braceWidth),
      d = Math.max(0.04, n.braceDepth)
    const bottom = Math.max(0.2, n.braceBottomSpread),
      top = Math.max(0.2, n.braceTopSpread)
    const plateX = n.bracePlateEnabled ? w * 0.95 : w / 2
    const plateZ = n.bracePlateEnabled ? d * 0.875 : d / 2
    const fork = n.supportStyle === 'y-frame' || n.supportStyle === 'v-frame'
    const spatial = ['tripod', 'trestle', 'box-frame'].includes(n.supportStyle)
    const span = fork
      ? top
      : n.supportStyle === 'a-frame' || n.supportStyle === 'portal-frame' || spatial
        ? bottom
        : Math.max(bottom, top)
    include(span / 2 + plateX, (spatial ? top / 2 : 0) + plateZ)
    if (n.supportStyle === 'a-frame' && n.bracePlateEnabled) include(w * 1.1, plateZ)
    return { halfX, halfZ }
  }
  const layout = columnShaftLayout(n)
  if (n.style === 'cluster') {
    include(Math.max(n.radius * 0.78, n.width * 0.22) + Math.max(0.04, n.radius * 0.36))
  } else {
    const count = getShaftSegmentCount(n)
    for (let i = 0; i <= count; i++) {
      const scale = getShaftScaleAt(n, i / count)
      const yaw = getShaftTwistRadians(n, (i / count) * Math.max(0, count - 1))
      const c = Math.abs(Math.cos(yaw)),
        s = Math.abs(Math.sin(yaw))
      if (rectangular)
        include(
          ((n.width * c + n.depth * s) * scale) / 2,
          ((n.width * s + n.depth * c) * scale) / 2,
        )
      else include(n.radius * scale)
    }
  }
  if (n.style !== 'cluster' && n.edgeSoftness > 0) {
    // Bevel rings also sample between the main profile sections.
    const scale = Math.max(n.shaftStartScale, n.shaftEndScale) + Math.abs(n.shaftBulge)
    if (rectangular && Math.abs(n.shaftTwistStep) > 0.001)
      include((Math.hypot(n.width, n.depth) * scale) / 2)
    else block(scale)
  }
  if (layout.baseHeight > 0) {
    const w = (n.width * n.baseWidthScale) / 2,
      d = (n.depth * n.baseDepthScale) / 2
    if (n.baseStyle === 'lotus' || n.baseStyle === 'ribbed-lotus') {
      include(n.width * 0.64, n.depth * 0.64)
      include(
        Math.max(n.radius * n.baseWidthScale, w) * 0.86 +
          (n.baseRibCount > 0 ? Math.max(0.01, n.width * 0.025) : 0),
      )
    } else if (n.baseStyle === 'panelled-pedestal') {
      const x = n.width * n.baseWidthScale,
        z = n.depth * n.baseWidthScale
      include(x * 0.51 + n.basePanelInset / 2, z * 0.51 + n.basePanelInset / 2)
      include(n.width * 0.18)
    } else if (n.baseStyle === 'square-plinth')
      include(Math.max(w, n.width * 0.45), Math.max(d, n.depth * 0.45))
    else if (n.baseStyle === 'stepped-square')
      include(Math.max(w, n.width * 0.25), Math.max(d, n.depth * 0.25))
    else if (n.baseStyle === 'round-rings')
      include(
        w * Math.max(1, n.baseRoundBandScale, n.baseNeckScale),
        d * Math.max(1, n.baseRoundBandScale, n.baseNeckScale),
      )
    else include(w, d)
    if (n.baseCarvingLevel > 0 && ['base', 'all'].includes(n.carvingPlacement))
      include(
        Math.max(n.radius * 1.04, Math.max(n.width, n.depth) / 2) +
          layout.baseHeight * 0.14 +
          0.014,
      )
  }
  for (const cap of columnCapitalBlocks(
    n,
    layout.baseHeight + layout.shaftHeight,
    layout.capitalHeight,
  )) {
    if (cap.kind === 'round') include(cap.radius!)
    else if (cap.kind === 'column') block(cap.scale!)
    else include(cap.width! / 2, cap.depth! / 2)
  }
  if (layout.capitalHeight > 0) {
    if (['volute', 'ionic-volute'].includes(n.capitalStyle) && n.voluteCount > 0)
      include(Math.max(n.width * 0.46, n.depth * 0.7) + n.voluteSize * 1.18)
    if (
      ['leaf-carved', 'corinthian-leaf'].includes(n.capitalStyle) &&
      n.leafCount > 0 &&
      n.leafRows > 0
    )
      include(
        Math.max(n.radius * 1.05, Math.max(n.width, n.depth) * 0.48) +
          layout.capitalHeight * 0.14 +
          0.018,
      )
    if (['south-indian-bracket', 'wood-bracket'].includes(n.capitalStyle) && n.pendantCount > 0)
      include(Math.max(n.width, n.depth) * 0.56 + 0.035)
    if (
      ['capital', 'all'].includes(n.carvingPlacement) &&
      (n.capitalBandCount > 0 || n.carvingLevel > 0 || n.capitalCarvingLevel > 0)
    ) {
      block(rectangular ? 1.28 : 1.24)
      if (rectangular)
        include(
          n.width * 0.56 + Math.max(0.025, n.width / 7) / 2,
          n.depth * 0.56 + Math.max(0.025, n.depth / 7) / 2,
        )
      else include(n.radius * 1.24 + Math.max(0.012, Math.min(0.03, n.radius * 0.12)))
    }
  }
  const shaftRadius = rectangular ? Math.hypot(n.width, n.depth) / 2 : n.radius
  const maxScale =
    Math.max(n.shaftStartScale, n.shaftEndScale) +
    Math.max(0, n.shaftBulge) +
    Math.max(0, -n.shaftBulge)
  if (n.ringCount > 0) include(shaftRadius * (maxScale + 0.12))
  if (n.latheRingCount > 0 || n.shaftDetail === 'lathe-turned')
    include(shaftRadius * (maxScale + 0.18))
  if (n.panelCount > 0 || n.style === 'dravidian-carved' || n.shaftDetail === 'panelled')
    include(shaftRadius * maxScale + n.panelInsetDepth / 2 + Math.max(0.006, n.width * 0.014))
  if ((n.spiralRibCount > 0 || n.shaftDetail === 'spiral') && n.spiralTwist !== 0)
    include(shaftRadius * maxScale + Math.max(0.012, n.radius * 0.06))
  if (n.lowerBandEnabled && ['shaft', 'all'].includes(n.carvingPlacement))
    include(shaftRadius * (maxScale + 0.12) + 0.012)
  return { halfX, halfZ }
}
