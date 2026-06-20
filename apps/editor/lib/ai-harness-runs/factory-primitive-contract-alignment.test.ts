import { describe, expect, test } from 'bun:test'
import type { GeneratedGeometryArtifact } from '../../../../packages/editor/src/lib/ai-generated-geometry-core'
import { alignFactoryPrimitiveArtifactToContract } from './factory-primitive-contract-alignment'
import { evaluateFactoryPrimitiveArtifactContract } from './factory-primitive-quality'
import type { ProcessEquipmentContract } from './process-line-types'

const contract: ProcessEquipmentContract = {
  profileId: 'test.contract_device',
  equipmentFamily: 'test.contract_device',
  scaleClass: 'test',
  envelope: { length: 2, width: 1, height: 1.2, origin: 'station_profile', tolerance: 0.05 },
  requiredRoles: ['main_body', 'support_base'],
  ports: [
    { id: 'feed_in', medium: 'material', side: 'left', height: 0.55, offset: 0 },
    { id: 'product_out', medium: 'material', side: 'right', height: 0.65, offset: 0 },
  ],
}

const oversizedArtifact: GeneratedGeometryArtifact = {
  id: 'ai_geometry_contract_alignment_test',
  title: 'Contract alignment test',
  sourceTool: 'compose_parts',
  sourceArgs: {},
  userPrompt: 'test factory contract alignment',
  version: 1,
  createdAt: '2026-06-19T00:00:00.000Z',
  shapes: [
    {
      kind: 'box',
      name: 'oversized generated housing',
      position: [0, 0.55, 0],
      rotation: [0, 0, 0],
      length: 4,
      width: 2,
      height: 1.1,
    },
  ],
  transforms: [{ position: [0, 0.55, 0], rotation: [0, 0, 0] }],
  assemblyName: 'Contract alignment test',
  assemblyPosition: [0, 0, 0],
  createdNames: ['oversized generated housing'],
  shapeDetails: '- oversized generated housing',
}

describe('factory primitive contract alignment', () => {
  test('fits generated artifact to envelope and backfills contract markers', () => {
    const before = evaluateFactoryPrimitiveArtifactContract({
      artifact: oversizedArtifact,
      contract,
    })
    expect(before.passed).toBe(false)

    const aligned = alignFactoryPrimitiveArtifactToContract({
      artifact: oversizedArtifact,
      contract,
    })
    const after = evaluateFactoryPrimitiveArtifactContract({
      artifact: aligned.artifact,
      contract,
    })

    expect(after.passed).toBe(true)
    expect(after.diagnostics.map((diagnostic) => diagnostic.code)).not.toContain(
      'factory_primitive_envelope_exceeded',
    )
    expect(aligned.alignment.addedPortMarkers).toEqual(['feed_in', 'product_out'])
    expect(aligned.alignment.addedRequiredRoleMarkers).toEqual(['main_body', 'support_base'])
    expect(aligned.artifact.shapes.some((shape) => shape.semanticRole === 'feed_in')).toBe(true)
    expect(aligned.artifact.shapes.some((shape) => shape.semanticRole === 'support_base')).toBe(
      true,
    )
  })
})
