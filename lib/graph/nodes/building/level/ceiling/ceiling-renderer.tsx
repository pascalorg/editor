'use client'

import type { z } from 'zod'
import type { CeilingNode } from './ceiling-node'

export function CeilingRenderer({ node }: { node: z.infer<typeof CeilingNode> }) {
  return <div>CeilingRenderer</div>
}
