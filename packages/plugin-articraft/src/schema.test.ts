import { describe, expect, test } from 'bun:test'
import { ArticraftAssetNode } from './schema'

describe('Articraft asset schema', () => {
  test('persists an immutable artifact and joint pose', () => {
    const node = ArticraftAssetNode.parse({
      catalogId: 'globe',
      title: 'Articulated globe',
      source: 'articraft-10k',
      artifact: {
        format: 'urdf',
        url: 'https://assets.example/model.urdf',
        sha256: 'a'.repeat(64),
      },
      dimensions: [0.2, 0.3, 0.2],
      parts: [{ name: 'base' }, { name: 'globe' }],
      joints: [
        {
          name: 'globe_spin',
          type: 'continuous',
          parent: 'base',
          child: 'globe',
          axis: [0, 0, 1],
          origin: { xyz: [0, 0, 0.1], rpy: [0, 0, 0] },
          limits: null,
        },
      ],
      jointValues: { globe_spin: 1.25 },
      motionEnabled: true,
      attribution: {
        creator: 'Articraft authors',
        license: 'CC-BY-4.0',
        sourceUrl: 'https://huggingface.co/datasets/camvsl/Articraft-10K',
      },
    })

    expect(node.type).toBe('articraft:asset')
    expect(node.jointValues.globe_spin).toBe(1.25)
    expect(node.motionEnabled).toBe(true)
    expect(node.artifact.sha256).toBe('a'.repeat(64))
  })

  test('keeps older nodes still until motion is explicitly enabled', () => {
    const node = ArticraftAssetNode.parse({
      catalogId: 'legacy',
      title: 'Existing asset',
      source: 'articraft-10k',
      artifact: { format: 'urdf', url: 'https://assets.example/model.urdf' },
      attribution: {
        creator: 'Articraft authors',
        license: 'CC-BY-4.0',
        sourceUrl: 'https://huggingface.co/datasets/camvsl/Articraft-10K',
      },
    })

    expect(node.motionEnabled).toBe(false)
  })
})
