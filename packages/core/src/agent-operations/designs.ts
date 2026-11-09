import { refuse } from '../agent-tools/refusal'
import { validateDesign } from '../procedural-items/design'
import { DesignPlacementError, planDesignPlacement } from '../procedural-items/design-placement'
import type { AnyNode } from '../schema'
import type { AgentOperation } from './types'

type DesignInput = string | Record<string, unknown>

type ValidateDesignInput = { design: DesignInput; parameters?: Record<string, number> }

type PlaceDesignInput = {
  design: DesignInput
  hostId: string
  position: number[]
  rotation?: number
  side?: 'front' | 'back'
  surfaceId?: string
  parameters?: Record<string, number>
  slots?: Record<string, string>
  name?: string
  id?: string
}

/** `validate_design`: a procedural recipe checked on its own; the scene is untouched. */
export const validateDesignOperation: AgentOperation<ValidateDesignInput> = (
  _nodes,
  { design, parameters },
) => ({
  result: validateDesign(design, { parameters }) as unknown as Record<string, unknown>,
})

/** `place_design`: one instance of a validated design, created on its host. */
export const placeDesign: AgentOperation<PlaceDesignInput> = (nodes, input) => {
  const [x, y, z] = input.position
  if (x === undefined || y === undefined || z === undefined) {
    refuse('invalid_placement', 'position must hold three coordinates.', {
      position: input.position,
    })
  }
  let placement: ReturnType<typeof planDesignPlacement>
  try {
    placement = planDesignPlacement(nodes as Record<string, AnyNode>, {
      ...input,
      position: [x, y, z],
    })
  } catch (error) {
    if (!(error instanceof DesignPlacementError)) throw error
    refuse(error.code, error.message, {
      message: error.message,
      ...(error.diagnostics.length > 0 ? { diagnostics: error.diagnostics.slice(0, 8) } : {}),
    })
  }
  const { node, parentId, hostUpdate } = placement
  return {
    result: { designId: node.id, parentId, surfaceId: input.surfaceId ?? null },
    changes: {
      create: [{ node: node as unknown as AnyNode, parentId }],
      ...(hostUpdate
        ? {
            update: [
              {
                id: hostUpdate.id,
                data: { attachments: hostUpdate.attachments } as Partial<AnyNode>,
              },
            ],
          }
        : {}),
    },
  }
}
