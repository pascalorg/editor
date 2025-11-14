'use client'

import type { z } from 'zod'
import type { SiteNode } from './site-node'

export function SiteRenderer({ node }: { node: z.infer<typeof SiteNode> }) {
  return <div>SiteRenderer</div>
}
