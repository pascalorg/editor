import type { GutterNode, RoofSegmentNode } from '@pascal-app/core'

export function segmentForGutterTrimClip(
  gutter: Pick<GutterNode, 'arc'>,
  segment: RoofSegmentNode | undefined,
): RoofSegmentNode | undefined {
  // Segment trim cutters are axis-aligned boxes. On a long arc, the back cutter
  // crosses the gutter twice and removes two unrelated sections of the run.
  return gutter.arc && segment?.arc ? undefined : segment
}
