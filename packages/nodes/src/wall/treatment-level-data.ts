import {
  calculateLevelMiters,
  getWallThickness,
  isCurvedWall,
  pointToKey,
  type WallMiterData,
  type WallNode,
} from '@pascal-app/core'
import { create } from 'zustand'
import { shallow } from 'zustand/vanilla/shallow'

const PROUD_KEY_PRECISION = 1e6

function proudKey(proud: number) {
  return Math.round(proud * PROUD_KEY_PRECISION) / PROUD_KEY_PRECISION
}

export function treatmentProudKeys(proudOffsets: readonly number[]): number[] {
  return [...new Set([0, ...proudOffsets.map(proudKey)])].sort((a, b) => a - b)
}

export function sameTreatmentWalls(a: readonly WallNode[], b: readonly WallNode[]): boolean {
  return a.length === b.length && a.every((wall, index) => wall === b[index])
}

export type WallTreatmentLevelData = {
  walls: readonly WallNode[]
  miterDataByProud: ReadonlyMap<number, WallMiterData>
}

const levelMiterCache = new Map<string, WallTreatmentLevelData>()

export function clearWallTreatmentMiterCache(levelId?: string): void {
  if (levelId === undefined) levelMiterCache.clear()
  else levelMiterCache.delete(levelId)
}

export function buildWallTreatmentLevelData(
  levelId: string,
  walls: readonly WallNode[],
  proudOffsets: readonly number[],
): WallTreatmentLevelData {
  const cached = levelMiterCache.get(levelId)
  const reusable = cached && sameTreatmentWalls(cached.walls, walls) ? cached : undefined
  const miterDataByProud = new Map<number, WallMiterData>()

  for (const proud of treatmentProudKeys(proudOffsets)) {
    const previous = reusable?.miterDataByProud.get(proud)
    if (previous) {
      miterDataByProud.set(proud, previous)
      continue
    }
    const adjustedWalls =
      proud === 0
        ? [...walls]
        : walls.map((wall) => ({
            ...wall,
            thickness: getWallThickness(wall) + proud * 2,
          }))
    miterDataByProud.set(proud, calculateLevelMiters(adjustedWalls))
  }

  const data = { walls, miterDataByProud }
  levelMiterCache.set(levelId, data)
  return data
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
  removeLevelData: (levelId: string) => void
}

export function createWallTreatmentSelector(node: WallNode, proudOffsets: readonly number[]) {
  const keys = isCurvedWall(node)
    ? []
    : [...new Set([node.start, node.end].map(([x, y]) => pointToKey({ x, y })))]
  const prouds = treatmentProudKeys(proudOffsets)
  let previousLevel: WallTreatmentLevelData | undefined
  let previousSlice: WallTreatmentLevelData | undefined
  let previousInputs: Array<number | boolean | undefined> = []

  return (state: WallTreatmentLevelDataState): WallTreatmentLevelData | undefined => {
    const level = node.parentId ? state.byLevelId.get(node.parentId) : undefined
    if (level === previousLevel) return previousSlice
    previousLevel = level
    if (!level) {
      previousSlice = undefined
      previousInputs = []
      return undefined
    }

    const inputs: Array<number | boolean | undefined> = []
    for (const proud of prouds) {
      const data = level.miterDataByProud.get(proud)
      inputs.push(!!data)
      for (const key of keys) {
        const entry = data?.junctionData.get(key)?.get(node.id)
        inputs.push(entry?.left?.x, entry?.left?.y, entry?.right?.x, entry?.right?.y)
      }
    }
    if (previousSlice && shallow(previousInputs, inputs)) return previousSlice

    const miterDataByProud = new Map<number, WallMiterData>()
    for (const proud of prouds) {
      const data = level.miterDataByProud.get(proud)
      if (!data) continue
      const junctionData: WallMiterData['junctionData'] = new Map()
      for (const key of keys) {
        const entry = data.junctionData.get(key)?.get(node.id)
        if (entry) junctionData.set(key, new Map([[node.id, entry]]))
      }
      // Trim boundaries read only this wall's endpoint intersections, never junction membership.
      miterDataByProud.set(proud, { junctionData, junctions: new Map() })
    }
    previousInputs = inputs
    previousSlice = { walls: [node], miterDataByProud }
    return previousSlice
  }
}

export const useWallTreatmentLevelData = create<WallTreatmentLevelDataState>((set) => ({
  byLevelId: new Map(),
  setLevelData: (levelId, data) =>
    set((state) => {
      const byLevelId = new Map(state.byLevelId)
      byLevelId.set(levelId, data)
      return { byLevelId }
    }),
  removeLevelData: (levelId) =>
    set((state) => {
      if (!state.byLevelId.has(levelId)) return state
      const byLevelId = new Map(state.byLevelId)
      byLevelId.delete(levelId)
      return { byLevelId }
    }),
}))
