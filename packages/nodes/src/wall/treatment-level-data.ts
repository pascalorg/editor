import {
  calculateLevelMiters,
  getWallThickness,
  type WallMiterData,
  type WallNode,
} from '@pascal-app/core'
import { create } from 'zustand'

const PROUD_KEY_PRECISION = 1e6

function proudKey(proud: number) {
  return Math.round(proud * PROUD_KEY_PRECISION) / PROUD_KEY_PRECISION
}

export type WallTreatmentLevelData = {
  walls: readonly WallNode[]
  miterDataByProud: ReadonlyMap<number, WallMiterData>
}

export function buildWallTreatmentLevelData(
  walls: readonly WallNode[],
  proudOffsets: readonly number[],
): WallTreatmentLevelData {
  const uniqueProudOffsets = new Set([0, ...proudOffsets.map(proudKey)])
  const miterDataByProud = new Map<number, WallMiterData>()

  for (const proud of uniqueProudOffsets) {
    const adjustedWalls =
      proud === 0
        ? [...walls]
        : walls.map((wall) => ({
            ...wall,
            thickness: getWallThickness(wall) + proud * 2,
          }))
    miterDataByProud.set(proud, calculateLevelMiters(adjustedWalls))
  }

  return { walls, miterDataByProud }
}

export function treatmentMiterDataForProud(
  levelData: WallTreatmentLevelData,
  proud: number,
): WallMiterData | undefined {
  return levelData.miterDataByProud.get(proudKey(proud))
}

type WallTreatmentLevelDataState = {
  byLevelId: ReadonlyMap<string, WallTreatmentLevelData>
  setLevelData: (levelId: string, data: WallTreatmentLevelData) => void
}

export const useWallTreatmentLevelData = create<WallTreatmentLevelDataState>((set) => ({
  byLevelId: new Map(),
  setLevelData: (levelId, data) =>
    set((state) => {
      const byLevelId = new Map(state.byLevelId)
      byLevelId.set(levelId, data)
      return { byLevelId }
    }),
}))
