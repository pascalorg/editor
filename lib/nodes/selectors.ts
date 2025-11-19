import type { LevelNode, RootNode, WallNode } from '../scenegraph/schema/index'

function getLevelsFromRoot(root: RootNode): LevelNode[] {
  const building = root.buildings[0]
  return building ? building.children : []
}

export const selectWallsFromLevel =
  (levelId: string) =>
  (state: { scene: { root: RootNode } }): WallNode[] => {
    const level = getLevelsFromRoot(state.scene.root).find((l) => l.id === levelId)
    if (!level) {
      return []
    }

    const walls: WallNode[] = []

    // Get direct wall children
    const directWalls = level.children.filter((child) => child.type === 'wall') as WallNode[]
    walls.push(...directWalls)

    // Get walls from groups
    const groups = level.children.filter((child) => child.type === 'group')
    for (const group of groups) {
      const groupWalls = group.children.filter((child) => child.type === 'wall') as WallNode[]
      walls.push(...groupWalls)
    }

    return walls
  }
