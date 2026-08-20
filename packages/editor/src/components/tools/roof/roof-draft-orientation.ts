export type RoofDraftPlacement = {
  depth: number
  rotation: number
  width: number
}

export function resolveRoofDraftPlacement(
  footprintWidth: number,
  footprintDepth: number,
  quarterTurn: boolean,
  parentRotation = 0,
): RoofDraftPlacement {
  return {
    width: quarterTurn ? footprintDepth : footprintWidth,
    depth: quarterTurn ? footprintWidth : footprintDepth,
    rotation: -parentRotation + (quarterTurn ? Math.PI / 2 : 0),
  }
}
