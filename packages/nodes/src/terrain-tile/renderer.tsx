'use client'

import { type TerrainTileNode, useRegistry } from '@pascal-app/core'
import { useMemo, useRef } from 'react'
import { Group } from 'three'
import { TerrainGroundSurface, useTerrainGround } from '../site/terrain-ground-surface'
import { buildTerrainTileMesh } from './geometry'
import { breakLines, identityKey, tileMeetsLot, tileNeighbours } from './mesh-inputs'

export default function TerrainTileRenderer({ node }: { node: TerrainTileNode }) {
  const root = useMemo(() => new Group(), [])
  const ref = useRef(root)
  useRegistry(node.id, 'terrain-tile', ref)
  const ground = useTerrainGround()
  const ownsPatch =
    ground?.tiles.find((tile) => tile.ix === node.ix && tile.iz === node.iz)?.id === node.id
  // The mesh reads this tile, its eight neighbours' rim and the breaks, so it is rebuilt for those:
  // the ground is rebuilt for any tile or break, and the 23 other tiles' meshes do not change.
  const field = useRef(ground?.field)
  field.current = ground?.field
  const inputs = ground
    ? identityKey([...tileNeighbours(node, ground.tiles), ...breakLines(ground.field)])
    : ''
  // biome-ignore lint/correctness/useExhaustiveDependencies: keyed on the inputs the mesh reads (above), not on the field object.
  const buffers = useMemo(
    () =>
      ground && field.current && ownsPatch
        ? buildTerrainTileMesh(node, field.current, ground.holes, ground.cuts)
        : null,
    [node, inputs, ground?.holes, ground?.cuts, ownsPatch],
  )
  // The mesh stays (a pointer still finds the ground there); it is not drawn where none of it shows.
  const drawn = useMemo(
    () => tileMeetsLot(node, ground?.polygon ?? []),
    [node.ix, node.iz, ground?.polygon],
  )
  return (
    <primitive object={root} ref={ref}>
      {buffers && <TerrainGroundSurface buffers={buffers} drawn={drawn} />}
    </primitive>
  )
}
