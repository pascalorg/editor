'use client'

import type { TankNode } from './schema'
import { TankPreview } from './renderer'

export default function Preview({ node }: { node: TankNode }) {
  return <TankPreview node={node} />
}

