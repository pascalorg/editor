import { type CadSnapResult, useWallSnapIndicator } from '@pascal-app/editor'

/**
 * Show or hide the snap beacon for a floor-placement tool.
 *
 * The drafting tools publish this themselves inside the snap pipeline, but
 * placement tools resolve their point through `resolveAlignedFloorPlacement`
 * and never had a beacon at all. Without one, an underlay snap would move the
 * ghost with nothing on screen to explain why.
 *
 * Callers must clear on commit and on unmount, next to their existing
 * `useAlignmentGuides` teardown — a beacon left standing outlives its tool.
 */
export function publishCadBeacon(snap: CadSnapResult | null | undefined): void {
  if (!snap) {
    useWallSnapIndicator.getState().clear()
    return
  }
  useWallSnapIndicator.getState().set({
    x: snap.point[0],
    z: snap.point[1],
    // The indicator's vocabulary predates CAD and has no 'segment'; a point on
    // a line body is the same idea its 'wall' glyph already means.
    kind: snap.kind === 'segment' ? 'wall' : snap.kind,
    source: 'cad',
  })
}
