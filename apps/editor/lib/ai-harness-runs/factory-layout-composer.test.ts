import { describe, expect, test } from 'bun:test'
import { composeFactoryLayout, extractFactoryLineStations } from './factory-layout-composer'

const productionLinePlan = {
  kind: 'layout' as const,
  reason: 'production line is layout composition',
  layoutType: 'production_line' as const,
  suggestedOperations: ['create_room', 'place_item', 'apply_patch'],
}

describe('factory layout composer', () => {
  test('extracts ordered production-line stations from Chinese prompt', () => {
    const stations = extractFactoryLineStations({
      prompt:
        '\u751f\u6210\u4e00\u676112\u7c73\u957f\u7684\u74f6\u88c5\u996e\u6599\u704c\u88c5\u4ea7\u7ebf\uff0c\u4ea7\u7ebf\u4ece\u5de6\u5230\u53f3\u4f9d\u6b21\u5305\u542b\uff1a\u4e0a\u6599\u8f93\u9001\u673a\u3001\u51b2\u6d17\u8bbe\u5907\u3001\u704c\u88c5\u673a\u3001\u65cb\u76d6\u673a\u3001\u8d34\u6807\u673a\u3001\u672b\u7aef\u6253\u5305\u533a\u3002',
    })

    expect(stations.map((station) => station.name)).toEqual([
      '\u4e0a\u6599\u8f93\u9001\u673a',
      '\u51b2\u6d17\u8bbe\u5907',
      '\u704c\u88c5\u673a',
      '\u65cb\u76d6\u673a',
      '\u8d34\u6807\u673a',
      '\u672b\u7aef\u6253\u5305\u533a',
    ])
    expect(stations.map((station) => station.role)).toEqual([
      'feeding_conveyor',
      'washer',
      'filler',
      'capper',
      'labeler',
      'packing',
    ])
  })

  test('composes production line area, backbone, station placeholders, and missing assets', () => {
    const result = composeFactoryLayout({
      prompt:
        '\u751f\u6210\u4e00\u676112\u7c73\u957f\u7684\u74f6\u88c5\u996e\u6599\u704c\u88c5\u4ea7\u7ebf\uff0c\u4ea7\u7ebf\u4ece\u5de6\u5230\u53f3\u4f9d\u6b21\u5305\u542b\uff1a\u4e0a\u6599\u8f93\u9001\u673a\u3001\u51b2\u6d17\u8bbe\u5907\u3001\u704c\u88c5\u673a\u3001\u65cb\u76d6\u673a\u3001\u8d34\u6807\u673a\u3001\u672b\u7aef\u6253\u5305\u533a\u3002',
      plan: productionLinePlan,
      placement: { parentId: 'level_factory', generatedBy: 'factory-agent' },
    })

    expect(result.summary).toContain('6 production-line stations')
    expect(result.patches).toHaveLength(18)
    expect(result.patches.filter((patch) => patch.node.type === 'zone')).toHaveLength(8)
    expect(result.patches.some((patch) => patch.node.name === 'Production line backbone')).toBe(true)
    expect(result.missingAssets).toHaveLength(5)
    expect(result.missingAssets.map((asset) => asset.name)).toContain('\u704c\u88c5\u673a')
    expect(result.patches.every((patch) => patch.op === 'create')).toBe(true)
  })

  test('places catalog matches for explicit station params', () => {
    const result = composeFactoryLayout({
      prompt: 'compose line with barrel and unknown machine',
      plan: productionLinePlan,
      placement: { parentId: 'level_factory', generatedBy: 'factory-agent' },
      params: {
        stations: [
          { name: 'factory barrel', role: 'storage' },
          { name: 'unavailable custom mixer', role: 'custom_mixer' },
        ],
      },
    })

    expect(result.stations).toHaveLength(2)
    expect(result.stations[0]?.asset?.id).toBe('factory-barrel')
    expect(result.patches.some((patch) => patch.node.type === 'item')).toBe(true)
    expect(result.missingAssets).toEqual([
      {
        name: 'unavailable custom mixer',
        reason:
          'No catalog item matched this production-line station yet; generate it with primitive geometry in the next phase.',
        required: true,
      },
    ])
  })
})
