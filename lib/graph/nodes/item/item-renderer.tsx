'use client'

import type { z } from 'zod'
import type { CatalogNode } from './item-node'

export function CatalogRenderer({ node }: { node: z.infer<typeof CatalogNode> }) {
  return <div>CatalogRenderer</div>
}
