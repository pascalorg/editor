export interface GridPoint {
  x: number
  z: number
}

export interface GridItem {
  position: [number, number] // x, z in grid coordinates
  rotation: number // radians
  size: [number, number] // width, depth in grid units
  canPlace?: boolean // Whether the item can be placed at its current position
  elevation?: number // Y offset from base (vertical position in meters)
}

