'use client'

import {
  createSceneApi,
  persistedTerrainFieldOf,
  type TerrainBreakNode,
  terrainBreakFacts,
  useScene,
} from '@pascal-app/core'
import { PanelSection, PanelWrapper } from '@pascal-app/editor'
import { useViewer } from '@pascal-app/viewer'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { commitTerrainBreakEdit } from './edit'
import { TerrainBreakOptions } from './options'

export default function TerrainBreakPanel({ node }: { node: TerrainBreakNode }) {
  const sceneApi = useMemo(() => createSceneApi(useScene), [])
  const [error, setError] = useState<string | null>(null)
  const [line, setLine] = useState(JSON.stringify(node.line))
  useEffect(() => setLine(JSON.stringify(node.line)), [node.line])
  const nodes = useScene((state) => state.nodes)
  const site = node.parentId ? nodes[node.parentId as keyof typeof nodes] : null
  const field = site?.type === 'site' ? persistedTerrainFieldOf(site, nodes) : null
  const facts = field ? terrainBreakFacts(node, field) : null
  const commit = useCallback(
    (patch: Partial<TerrainBreakNode>) => {
      try {
        commitTerrainBreakEdit(sceneApi, node.id, patch)
        setError(null)
      } catch (error) {
        setError(error instanceof Error ? error.message : String(error))
      }
    },
    [sceneApi, node.id],
  )
  return (
    <PanelWrapper
      onClose={() => useViewer.getState().setSelection({ selectedIds: [] })}
      title="Terrain break"
      width={320}
    >
      {error && (
        <p className="px-3 py-2 text-xs text-red-500" role="alert">
          {error}
        </p>
      )}
      <PanelSection title="Vertical boundary">
        <TerrainBreakOptions onChange={commit} value={node} />
        <p className="py-1 text-xs text-muted-foreground">
          Absolute Site elevations in metres. Looking along the line, left is to your left. A closed
          counterclockwise ring has its inside on the left. Keep ground never blends across the
          boundary.
        </p>
      </PanelSection>
      <PanelSection title="Line in Site metres">
        <textarea
          aria-label="Terrain boundary points"
          className="w-full rounded border border-border bg-background p-2 text-xs"
          onBlur={() => {
            try {
              const points = JSON.parse(line)
              commit({ line: points })
            } catch (error) {
              setError(error instanceof Error ? error.message : String(error))
            }
          }}
          onChange={(event) => setLine(event.target.value)}
          rows={4}
          value={line}
        />
        <p className="py-1 text-xs text-muted-foreground">
          Use [x,z] pairs. Open lines must be straight and span the lot. Closed convex rings repeat
          the first point. Crossings and bent open lines are not supported.
        </p>
      </PanelSection>
      {facts && (
        <PanelSection title="Measured boundary">
          <p className="text-xs">Length: {facts.lengthM.toFixed(2)} m</p>
          <p className="text-xs">
            Drop: {facts.dropMinM.toFixed(2)}–{facts.dropMaxM.toFixed(2)} m
          </p>
          <p className="text-xs">Vertical area: {facts.faceAreaM2.toFixed(2)} m²</p>
        </PanelSection>
      )}
    </PanelWrapper>
  )
}
