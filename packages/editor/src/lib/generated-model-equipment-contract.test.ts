import { describe, expect, test } from 'bun:test'
import { recognizeGeneratedModelEquipment } from './generated-model-equipment-contract'

describe('generated model equipment contract recognition', () => {
  test('recognizes image-generated pump assets as equipment contracts', () => {
    const metadata = recognizeGeneratedModelEquipment({
      asset: {
        id: 'image_pump',
        name: 'Centrifugal pump',
        category: 'equipment',
        thumbnail: '/thumb.png',
        src: '/model.glb',
        dimensions: [2.4, 1.2, 1],
        tags: ['generated', 'image-to-3d', 'pump'],
      },
      prompt: '生成一个离心泵',
    })

    expect(metadata).toMatchObject({
      semanticType: 'pump',
      equipmentContract: {
        profileId: 'generated-model.pump',
        equipmentFamily: 'pump',
        primarySemanticRole: 'pump_body',
        envelope: { length: 2.4, width: 1, height: 1.2 },
        ports: [
          { id: 'inlet', medium: 'fluid', side: 'west' },
          { id: 'outlet', medium: 'fluid', side: 'east' },
        ],
      },
    })
  })

  test('does not invent an equipment contract for unknown decorative assets', () => {
    expect(
      recognizeGeneratedModelEquipment({
        asset: {
          id: 'image_statue',
          name: 'Abstract statue',
          category: 'decor',
          thumbnail: '/thumb.png',
          src: '/model.glb',
          dimensions: [1, 2, 1],
          tags: ['generated', 'image-to-3d'],
        },
        prompt: '生成一个抽象雕塑',
      }),
    ).toBeNull()
  })
})
