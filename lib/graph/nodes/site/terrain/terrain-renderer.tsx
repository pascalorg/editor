'use client'

import type { z } from 'zod'
import type { TerrainNode } from './terrain-node'

export function TerrainRenderer({ node }: { node: z.infer<typeof TerrainNode> }) {
  return <div>TerrainRenderer</div>
}
