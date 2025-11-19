'use client'

import { useShallow } from 'zustand/react/shallow'
import { selectWallsFromLevel } from '../lib/nodes/selectors'

import type { WallNode } from '../lib/scenegraph/schema/index'
import { useEditor } from './use-editor'

export function useWalls(levelId: string): WallNode[] {
  return useEditor(useShallow(selectWallsFromLevel(levelId)))
}
