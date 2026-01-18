import { useCallback } from "react";
import { spatialGridManager } from "./spatial-grid-manager";
import { LevelNode } from "../../schema";

export function useSpatialQuery() {
  const canPlace = useCallback(
    (
      levelId: LevelNode["id"],
      position: [number, number, number],
      dimensions: [number, number, number],
      rotation: [number, number, number],
      ignoreIds?: string[],
    ) => {
      return spatialGridManager.canPlaceOnFloor(
        levelId,
        position,
        dimensions,
        rotation,
        ignoreIds,
      );
    },
    [],
  );

  return { canPlace };
}
