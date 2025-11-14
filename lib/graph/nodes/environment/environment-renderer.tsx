'use client'

import type { z } from 'zod'
import type { EnvironmentNode } from './environment-node'

export function EnvironmentRenderer({ node }: { node: z.infer<typeof EnvironmentNode> }) {
  return <div>EnvironmentRenderer</div>
}
