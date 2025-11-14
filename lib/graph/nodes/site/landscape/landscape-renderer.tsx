'use client'

import type { z } from 'zod'
import type { LandscapeNode } from './landscape-node'

export function LandscapeRenderer({ node }: { node: z.infer<typeof LandscapeNode> }) {
  return <div>LandscapeRenderer</div>
}
