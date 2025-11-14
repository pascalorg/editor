'use client'

import type { z } from 'zod'
import type { PropertyNode } from './property-node'

export function PropertyRenderer({ node }: { node: z.infer<typeof PropertyNode> }) {
  return <div>PropertyRenderer</div>
}
