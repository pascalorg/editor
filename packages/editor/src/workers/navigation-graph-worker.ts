/// <reference lib="webworker" />

import type { AnyNode, BuildingNode } from '@pascal-app/core'
import { buildNavigationGraph } from '../lib/navigation'

type NavigationGraphWorkerRequest = {
  buildingId: BuildingNode['id'] | null
  nodes: Record<string, AnyNode>
  requestId: number
  rootNodeIds: string[]
}

type NavigationGraphWorkerResponse =
  | {
      graph: ReturnType<typeof buildNavigationGraph>
      requestId: number
    }
  | {
      error: string
      requestId: number
    }

self.onmessage = (event: MessageEvent<NavigationGraphWorkerRequest>) => {
  const { buildingId, nodes, requestId, rootNodeIds } = event.data

  try {
    const graph = buildNavigationGraph(nodes, rootNodeIds, buildingId)
    ;(self as DedicatedWorkerGlobalScope).postMessage({
      graph,
      requestId,
    } satisfies NavigationGraphWorkerResponse)
  } catch (error) {
    ;(self as DedicatedWorkerGlobalScope).postMessage({
      error: error instanceof Error ? error.message : String(error),
      requestId,
    } satisfies NavigationGraphWorkerResponse)
  }
}
