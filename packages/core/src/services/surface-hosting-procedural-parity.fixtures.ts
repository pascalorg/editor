import type {
  resolveSurfacePlacement,
  SurfacePlacement,
  SurfaceRejectReason,
} from './surface-hosting'

type PlacementArgs = Parameters<typeof resolveSurfacePlacement>[0]
type ProceduralFixture = {
  label: string
  host: unknown
  rows: (Pick<PlacementArgs, 'childKind' | 'childFootprint' | 'hit' | 'checkFootprint'> & {
    expected: SurfacePlacement | null
    rejections: SurfaceRejectReason[]
  })[]
}

// Captured from the passing production-query/validator comparisons at ad2a57b8 before legacy removal.
export const frozenProceduralParity: ProceduralFixture[] = [
  {
    host: {
      object: 'node',
      id: 'procedural-item_frozen-0',
      type: 'procedural-item',
      parentId: null,
      visible: true,
      metadata: {},
      recipe: {
        version: 1,
        name: 'Everyday shelf',
        description: 'An open timber bookcase with adjustable shelves and a contrasting back.',
        parameters: [
          {
            id: 'width',
            label: 'Width',
            default: 1.2,
            min: 0.6,
            max: 2.4,
            step: 0.05,
            unit: 'm',
            axis: 'x',
          },
          {
            id: 'height',
            label: 'Height',
            default: 1.8,
            min: 0.8,
            max: 2.5,
            step: 0.05,
            unit: 'm',
            axis: 'y',
          },
          {
            id: 'depth',
            label: 'Depth',
            default: 0.4,
            min: 0.25,
            max: 0.7,
            step: 0.025,
            unit: 'm',
            axis: 'z',
          },
          {
            id: 'rows',
            label: 'Shelves',
            default: 4,
            min: 2,
            max: 7,
            step: 1,
            unit: 'count',
            part: 'shelves',
          },
          {
            id: 'thickness',
            label: 'Board thickness',
            default: 0.03,
            min: 0.015,
            max: 0.06,
            step: 0.005,
            unit: 'm',
            part: 'frame',
          },
        ],
        slots: [
          {
            id: 'frame',
            label: 'Frame',
            color: '#b58a60',
          },
          {
            id: 'shelves',
            label: 'Shelves',
            color: '#d5b38d',
          },
          {
            id: 'back',
            label: 'Back',
            color: '#495b50',
          },
        ],
        parts: [
          {
            id: 'frame',
            label: 'Frame',
            count: 2,
            shapes: [
              {
                id: 'side',
                primitive: 'box',
                slot: 'frame',
                size: ['thickness', 'height', 'depth'],
                position: [
                  {
                    op: 'mul',
                    args: [
                      {
                        op: 'sub',
                        args: ['index', 0.5],
                      },
                      {
                        op: 'sub',
                        args: ['width', 'thickness'],
                      },
                    ],
                  },
                  {
                    op: 'div',
                    args: ['height', 2],
                  },
                  0,
                ],
              },
            ],
          },
          {
            id: 'shelves',
            label: 'Shelves',
            count: 'rows',
            shapes: [
              {
                id: 'board',
                primitive: 'box',
                slot: 'shelves',
                size: [
                  {
                    op: 'sub',
                    args: [
                      'width',
                      {
                        op: 'mul',
                        args: [2, 'thickness'],
                      },
                    ],
                  },
                  'thickness',
                  'depth',
                ],
                position: [
                  0,
                  {
                    op: 'add',
                    args: [
                      {
                        op: 'div',
                        args: ['thickness', 2],
                      },
                      {
                        op: 'mul',
                        args: [
                          'index',
                          {
                            op: 'div',
                            args: [
                              {
                                op: 'sub',
                                args: ['height', 'thickness'],
                              },
                              {
                                op: 'sub',
                                args: ['rows', 1],
                              },
                            ],
                          },
                        ],
                      },
                    ],
                  },
                  0,
                ],
                support: true,
              },
            ],
          },
          {
            id: 'back',
            label: 'Back panel',
            count: 1,
            shapes: [
              {
                id: 'panel',
                primitive: 'box',
                slot: 'back',
                size: [
                  {
                    op: 'sub',
                    args: [
                      'width',
                      {
                        op: 'mul',
                        args: [2, 'thickness'],
                      },
                    ],
                  },
                  'height',
                  0.012,
                ],
                position: [
                  0,
                  {
                    op: 'div',
                    args: ['height', 2],
                  },
                  {
                    op: 'add',
                    args: [
                      {
                        op: 'div',
                        args: ['depth', -2],
                      },
                      0.006,
                    ],
                  },
                ],
              },
            ],
          },
        ],
        constraints: [],
      },
      parameters: {
        height: 1.8,
      },
      slots: {},
      position: [0, 0, 0],
      rotation: [0, 0, 0],
      children: [],
      attachments: {},
    },
    rows: [
      {
        childKind: 'item',
        childFootprint: {
          size: [0.2, 1, 0.2],
          rotationY: 0,
        },
        hit: {
          point: [0, 0.03, 0],
          normalWorldY: 1,
        },
        expected: {
          position: [0, 0.03, 0],
          rotationY: 0,
          surfaceId: 'shelves:0:board:top',
          childFrame: 'surface-local',
          surfaceLocal: {
            position: [0, -0, 0],
            rotationY: 0,
            rotation: [0, 0, 0],
          },
        },
        rejections: [],
      },
      {
        childKind: 'item',
        childFootprint: {
          size: [0.2, 1, 0.2],
          rotationY: 0.3,
        },
        hit: {
          point: [0.1, 0.03, 0],
          normalWorldY: 1,
        },
        expected: {
          position: [0.1, 0.03, 0],
          rotationY: 0.3,
          surfaceId: 'shelves:0:board:top',
          childFrame: 'surface-local',
          surfaceLocal: {
            position: [0.1, -0, 0],
            rotationY: 0.3,
            rotation: [0, 0.3, 0],
          },
        },
        rejections: [],
      },
      {
        childKind: 'item',
        childFootprint: {
          size: [0.2, 1, 0.6],
          rotationY: 1.5707963267948966,
        },
        hit: {
          point: [0, 0.03, 0],
          normalWorldY: 1,
        },
        expected: {
          position: [0, 0.03, 0],
          rotationY: 1.5707963267948966,
          surfaceId: 'shelves:0:board:top',
          childFrame: 'surface-local',
          surfaceLocal: {
            position: [0, -0, 0],
            rotationY: 1.5707963267948966,
            rotation: [0, 1.5707963267948966, 0],
          },
        },
        rejections: [],
      },
      {
        childKind: 'item',
        childFootprint: {
          size: [0.6, 1, 0.2],
          rotationY: 0.7853981633974483,
        },
        hit: {
          point: [0, 0.03, 0],
          normalWorldY: 1,
        },
        expected: null,
        rejections: ['footprint-outside-surface'],
      },
      {
        childKind: 'item',
        childFootprint: {
          size: [0.4, 1, 0.2],
          rotationY: 0,
        },
        hit: {
          point: [0.5, 0.03, 0],
          normalWorldY: 1,
        },
        expected: null,
        rejections: ['footprint-outside-surface'],
      },
      {
        childKind: 'item',
        childFootprint: {
          size: [1.1400009999999998, 1, 0.4],
          rotationY: 0,
        },
        hit: {
          point: [0, 0.03, 0],
          normalWorldY: 1,
        },
        expected: {
          position: [0, 0.03, 0],
          rotationY: 0,
          surfaceId: 'shelves:0:board:top',
          childFrame: 'surface-local',
          surfaceLocal: {
            position: [0, -0, 0],
            rotationY: 0,
            rotation: [0, 0, 0],
          },
        },
        rejections: [],
      },
      {
        childKind: 'item',
        childFootprint: {
          size: [1.1400039999999998, 1, 0.4],
          rotationY: 0,
        },
        hit: {
          point: [0, 0.03, 0],
          normalWorldY: 1,
        },
        expected: null,
        rejections: ['footprint-outside-surface'],
      },
      {
        childKind: 'item',
        childFootprint: {
          size: [0.2, 1, 0.2],
          rotationY: 0,
        },
        hit: {
          point: [0, 0.62, 0],
          normalWorldY: 1,
        },
        expected: {
          position: [0, 0.62, 0],
          rotationY: 0,
          surfaceId: 'shelves:1:board:top',
          childFrame: 'surface-local',
          surfaceLocal: {
            position: [0, -0, 0],
            rotationY: 0,
            rotation: [0, 0, 0],
          },
        },
        rejections: [],
      },
      {
        childKind: 'item',
        childFootprint: {
          size: [0.2, 1, 0.2],
          rotationY: 0.3,
        },
        hit: {
          point: [0.1, 0.62, 0],
          normalWorldY: 1,
        },
        expected: {
          position: [0.1, 0.62, 0],
          rotationY: 0.3,
          surfaceId: 'shelves:1:board:top',
          childFrame: 'surface-local',
          surfaceLocal: {
            position: [0.1, -0, 0],
            rotationY: 0.3,
            rotation: [0, 0.3, 0],
          },
        },
        rejections: [],
      },
      {
        childKind: 'item',
        childFootprint: {
          size: [0.2, 1, 0.6],
          rotationY: 1.5707963267948966,
        },
        hit: {
          point: [0, 0.62, 0],
          normalWorldY: 1,
        },
        expected: {
          position: [0, 0.62, 0],
          rotationY: 1.5707963267948966,
          surfaceId: 'shelves:1:board:top',
          childFrame: 'surface-local',
          surfaceLocal: {
            position: [0, -0, 0],
            rotationY: 1.5707963267948966,
            rotation: [0, 1.5707963267948966, 0],
          },
        },
        rejections: [],
      },
      {
        childKind: 'item',
        childFootprint: {
          size: [0.6, 1, 0.2],
          rotationY: 0.7853981633974483,
        },
        hit: {
          point: [0, 0.62, 0],
          normalWorldY: 1,
        },
        expected: null,
        rejections: ['footprint-outside-surface'],
      },
      {
        childKind: 'item',
        childFootprint: {
          size: [0.4, 1, 0.2],
          rotationY: 0,
        },
        hit: {
          point: [0.5, 0.62, 0],
          normalWorldY: 1,
        },
        expected: null,
        rejections: ['footprint-outside-surface'],
      },
      {
        childKind: 'item',
        childFootprint: {
          size: [1.1400009999999998, 1, 0.4],
          rotationY: 0,
        },
        hit: {
          point: [0, 0.62, 0],
          normalWorldY: 1,
        },
        expected: {
          position: [0, 0.62, 0],
          rotationY: 0,
          surfaceId: 'shelves:1:board:top',
          childFrame: 'surface-local',
          surfaceLocal: {
            position: [0, -0, 0],
            rotationY: 0,
            rotation: [0, 0, 0],
          },
        },
        rejections: [],
      },
      {
        childKind: 'item',
        childFootprint: {
          size: [1.1400039999999998, 1, 0.4],
          rotationY: 0,
        },
        hit: {
          point: [0, 0.62, 0],
          normalWorldY: 1,
        },
        expected: null,
        rejections: ['footprint-outside-surface'],
      },
      {
        childKind: 'item',
        childFootprint: {
          size: [0.2, 1, 0.2],
          rotationY: 0,
        },
        hit: {
          point: [0, 1.2099999999999997, 0],
          normalWorldY: 1,
        },
        expected: {
          position: [0, 1.2099999999999997, 0],
          rotationY: 0,
          surfaceId: 'shelves:2:board:top',
          childFrame: 'surface-local',
          surfaceLocal: {
            position: [0, -0, 0],
            rotationY: 0,
            rotation: [0, 0, 0],
          },
        },
        rejections: [],
      },
      {
        childKind: 'item',
        childFootprint: {
          size: [0.2, 1, 0.2],
          rotationY: 0.3,
        },
        hit: {
          point: [0.1, 1.2099999999999997, 0],
          normalWorldY: 1,
        },
        expected: {
          position: [0.1, 1.2099999999999997, 0],
          rotationY: 0.3,
          surfaceId: 'shelves:2:board:top',
          childFrame: 'surface-local',
          surfaceLocal: {
            position: [0.1, -0, 0],
            rotationY: 0.3,
            rotation: [0, 0.3, 0],
          },
        },
        rejections: [],
      },
      {
        childKind: 'item',
        childFootprint: {
          size: [0.2, 1, 0.6],
          rotationY: 1.5707963267948966,
        },
        hit: {
          point: [0, 1.2099999999999997, 0],
          normalWorldY: 1,
        },
        expected: {
          position: [0, 1.2099999999999997, 0],
          rotationY: 1.5707963267948966,
          surfaceId: 'shelves:2:board:top',
          childFrame: 'surface-local',
          surfaceLocal: {
            position: [0, -0, 0],
            rotationY: 1.5707963267948966,
            rotation: [0, 1.5707963267948966, 0],
          },
        },
        rejections: [],
      },
      {
        childKind: 'item',
        childFootprint: {
          size: [0.6, 1, 0.2],
          rotationY: 0.7853981633974483,
        },
        hit: {
          point: [0, 1.2099999999999997, 0],
          normalWorldY: 1,
        },
        expected: null,
        rejections: ['footprint-outside-surface'],
      },
      {
        childKind: 'item',
        childFootprint: {
          size: [0.4, 1, 0.2],
          rotationY: 0,
        },
        hit: {
          point: [0.5, 1.2099999999999997, 0],
          normalWorldY: 1,
        },
        expected: null,
        rejections: ['footprint-outside-surface'],
      },
      {
        childKind: 'item',
        childFootprint: {
          size: [1.1400009999999998, 1, 0.4],
          rotationY: 0,
        },
        hit: {
          point: [0, 1.2099999999999997, 0],
          normalWorldY: 1,
        },
        expected: {
          position: [0, 1.2099999999999997, 0],
          rotationY: 0,
          surfaceId: 'shelves:2:board:top',
          childFrame: 'surface-local',
          surfaceLocal: {
            position: [0, -0, 0],
            rotationY: 0,
            rotation: [0, 0, 0],
          },
        },
        rejections: [],
      },
      {
        childKind: 'item',
        childFootprint: {
          size: [1.1400039999999998, 1, 0.4],
          rotationY: 0,
        },
        hit: {
          point: [0, 1.2099999999999997, 0],
          normalWorldY: 1,
        },
        expected: null,
        rejections: ['footprint-outside-surface'],
      },
      {
        childKind: 'item',
        childFootprint: {
          size: [0.2, 1, 0.2],
          rotationY: 0,
        },
        hit: {
          point: [0, 1.7999999999999998, 0],
          normalWorldY: 1,
        },
        expected: {
          position: [0, 1.7999999999999998, 0],
          rotationY: 0,
          surfaceId: 'shelves:3:board:top',
          childFrame: 'surface-local',
          surfaceLocal: {
            position: [0, -0, 0],
            rotationY: 0,
            rotation: [0, 0, 0],
          },
        },
        rejections: [],
      },
      {
        childKind: 'item',
        childFootprint: {
          size: [0.2, 1, 0.2],
          rotationY: 0.3,
        },
        hit: {
          point: [0.1, 1.7999999999999998, 0],
          normalWorldY: 1,
        },
        expected: {
          position: [0.1, 1.7999999999999998, 0],
          rotationY: 0.3,
          surfaceId: 'shelves:3:board:top',
          childFrame: 'surface-local',
          surfaceLocal: {
            position: [0.1, -0, 0],
            rotationY: 0.3,
            rotation: [0, 0.3, 0],
          },
        },
        rejections: [],
      },
      {
        childKind: 'item',
        childFootprint: {
          size: [0.2, 1, 0.6],
          rotationY: 1.5707963267948966,
        },
        hit: {
          point: [0, 1.7999999999999998, 0],
          normalWorldY: 1,
        },
        expected: {
          position: [0, 1.7999999999999998, 0],
          rotationY: 1.5707963267948966,
          surfaceId: 'shelves:3:board:top',
          childFrame: 'surface-local',
          surfaceLocal: {
            position: [0, -0, 0],
            rotationY: 1.5707963267948966,
            rotation: [0, 1.5707963267948966, 0],
          },
        },
        rejections: [],
      },
      {
        childKind: 'item',
        childFootprint: {
          size: [0.6, 1, 0.2],
          rotationY: 0.7853981633974483,
        },
        hit: {
          point: [0, 1.7999999999999998, 0],
          normalWorldY: 1,
        },
        expected: null,
        rejections: ['footprint-outside-surface'],
      },
      {
        childKind: 'item',
        childFootprint: {
          size: [0.4, 1, 0.2],
          rotationY: 0,
        },
        hit: {
          point: [0.5, 1.7999999999999998, 0],
          normalWorldY: 1,
        },
        expected: null,
        rejections: ['footprint-outside-surface'],
      },
      {
        childKind: 'item',
        childFootprint: {
          size: [1.1400009999999998, 1, 0.4],
          rotationY: 0,
        },
        hit: {
          point: [0, 1.7999999999999998, 0],
          normalWorldY: 1,
        },
        expected: {
          position: [0, 1.7999999999999998, 0],
          rotationY: 0,
          surfaceId: 'shelves:3:board:top',
          childFrame: 'surface-local',
          surfaceLocal: {
            position: [0, -0, 0],
            rotationY: 0,
            rotation: [0, 0, 0],
          },
        },
        rejections: [],
      },
      {
        childKind: 'item',
        childFootprint: {
          size: [1.1400039999999998, 1, 0.4],
          rotationY: 0,
        },
        hit: {
          point: [0, 1.7999999999999998, 0],
          normalWorldY: 1,
        },
        expected: null,
        rejections: ['footprint-outside-surface'],
      },
    ],
    label: 'shelf height 1.8: containment and tolerance',
  },
  {
    host: {
      object: 'node',
      id: 'procedural-item_frozen-1',
      type: 'procedural-item',
      parentId: null,
      visible: true,
      metadata: {},
      recipe: {
        version: 1,
        name: 'Everyday shelf',
        description: 'An open timber bookcase with adjustable shelves and a contrasting back.',
        parameters: [
          {
            id: 'width',
            label: 'Width',
            default: 1.2,
            min: 0.6,
            max: 2.4,
            step: 0.05,
            unit: 'm',
            axis: 'x',
          },
          {
            id: 'height',
            label: 'Height',
            default: 1.8,
            min: 0.8,
            max: 2.5,
            step: 0.05,
            unit: 'm',
            axis: 'y',
          },
          {
            id: 'depth',
            label: 'Depth',
            default: 0.4,
            min: 0.25,
            max: 0.7,
            step: 0.025,
            unit: 'm',
            axis: 'z',
          },
          {
            id: 'rows',
            label: 'Shelves',
            default: 4,
            min: 2,
            max: 7,
            step: 1,
            unit: 'count',
            part: 'shelves',
          },
          {
            id: 'thickness',
            label: 'Board thickness',
            default: 0.03,
            min: 0.015,
            max: 0.06,
            step: 0.005,
            unit: 'm',
            part: 'frame',
          },
        ],
        slots: [
          {
            id: 'frame',
            label: 'Frame',
            color: '#b58a60',
          },
          {
            id: 'shelves',
            label: 'Shelves',
            color: '#d5b38d',
          },
          {
            id: 'back',
            label: 'Back',
            color: '#495b50',
          },
        ],
        parts: [
          {
            id: 'frame',
            label: 'Frame',
            count: 2,
            shapes: [
              {
                id: 'side',
                primitive: 'box',
                slot: 'frame',
                size: ['thickness', 'height', 'depth'],
                position: [
                  {
                    op: 'mul',
                    args: [
                      {
                        op: 'sub',
                        args: ['index', 0.5],
                      },
                      {
                        op: 'sub',
                        args: ['width', 'thickness'],
                      },
                    ],
                  },
                  {
                    op: 'div',
                    args: ['height', 2],
                  },
                  0,
                ],
              },
            ],
          },
          {
            id: 'shelves',
            label: 'Shelves',
            count: 'rows',
            shapes: [
              {
                id: 'board',
                primitive: 'box',
                slot: 'shelves',
                size: [
                  {
                    op: 'sub',
                    args: [
                      'width',
                      {
                        op: 'mul',
                        args: [2, 'thickness'],
                      },
                    ],
                  },
                  'thickness',
                  'depth',
                ],
                position: [
                  0,
                  {
                    op: 'add',
                    args: [
                      {
                        op: 'div',
                        args: ['thickness', 2],
                      },
                      {
                        op: 'mul',
                        args: [
                          'index',
                          {
                            op: 'div',
                            args: [
                              {
                                op: 'sub',
                                args: ['height', 'thickness'],
                              },
                              {
                                op: 'sub',
                                args: ['rows', 1],
                              },
                            ],
                          },
                        ],
                      },
                    ],
                  },
                  0,
                ],
                support: true,
              },
            ],
          },
          {
            id: 'back',
            label: 'Back panel',
            count: 1,
            shapes: [
              {
                id: 'panel',
                primitive: 'box',
                slot: 'back',
                size: [
                  {
                    op: 'sub',
                    args: [
                      'width',
                      {
                        op: 'mul',
                        args: [2, 'thickness'],
                      },
                    ],
                  },
                  'height',
                  0.012,
                ],
                position: [
                  0,
                  {
                    op: 'div',
                    args: ['height', 2],
                  },
                  {
                    op: 'add',
                    args: [
                      {
                        op: 'div',
                        args: ['depth', -2],
                      },
                      0.006,
                    ],
                  },
                ],
              },
            ],
          },
        ],
        constraints: [],
      },
      parameters: {
        height: 2.4,
      },
      slots: {},
      position: [0, 0, 0],
      rotation: [0, 0, 0],
      children: [],
      attachments: {},
    },
    rows: [
      {
        childKind: 'item',
        childFootprint: {
          size: [0.2, 1, 0.2],
          rotationY: 0,
        },
        hit: {
          point: [0, 0.03, 0],
          normalWorldY: 1,
        },
        expected: {
          position: [0, 0.03, 0],
          rotationY: 0,
          surfaceId: 'shelves:0:board:top',
          childFrame: 'surface-local',
          surfaceLocal: {
            position: [0, -0, 0],
            rotationY: 0,
            rotation: [0, 0, 0],
          },
        },
        rejections: [],
      },
      {
        childKind: 'item',
        childFootprint: {
          size: [0.2, 1, 0.2],
          rotationY: 0.3,
        },
        hit: {
          point: [0.1, 0.03, 0],
          normalWorldY: 1,
        },
        expected: {
          position: [0.1, 0.03, 0],
          rotationY: 0.3,
          surfaceId: 'shelves:0:board:top',
          childFrame: 'surface-local',
          surfaceLocal: {
            position: [0.1, -0, 0],
            rotationY: 0.3,
            rotation: [0, 0.3, 0],
          },
        },
        rejections: [],
      },
      {
        childKind: 'item',
        childFootprint: {
          size: [0.2, 1, 0.6],
          rotationY: 1.5707963267948966,
        },
        hit: {
          point: [0, 0.03, 0],
          normalWorldY: 1,
        },
        expected: {
          position: [0, 0.03, 0],
          rotationY: 1.5707963267948966,
          surfaceId: 'shelves:0:board:top',
          childFrame: 'surface-local',
          surfaceLocal: {
            position: [0, -0, 0],
            rotationY: 1.5707963267948966,
            rotation: [0, 1.5707963267948966, 0],
          },
        },
        rejections: [],
      },
      {
        childKind: 'item',
        childFootprint: {
          size: [0.6, 1, 0.2],
          rotationY: 0.7853981633974483,
        },
        hit: {
          point: [0, 0.03, 0],
          normalWorldY: 1,
        },
        expected: null,
        rejections: ['footprint-outside-surface'],
      },
      {
        childKind: 'item',
        childFootprint: {
          size: [0.4, 1, 0.2],
          rotationY: 0,
        },
        hit: {
          point: [0.5, 0.03, 0],
          normalWorldY: 1,
        },
        expected: null,
        rejections: ['footprint-outside-surface'],
      },
      {
        childKind: 'item',
        childFootprint: {
          size: [1.1400009999999998, 1, 0.4],
          rotationY: 0,
        },
        hit: {
          point: [0, 0.03, 0],
          normalWorldY: 1,
        },
        expected: {
          position: [0, 0.03, 0],
          rotationY: 0,
          surfaceId: 'shelves:0:board:top',
          childFrame: 'surface-local',
          surfaceLocal: {
            position: [0, -0, 0],
            rotationY: 0,
            rotation: [0, 0, 0],
          },
        },
        rejections: [],
      },
      {
        childKind: 'item',
        childFootprint: {
          size: [1.1400039999999998, 1, 0.4],
          rotationY: 0,
        },
        hit: {
          point: [0, 0.03, 0],
          normalWorldY: 1,
        },
        expected: null,
        rejections: ['footprint-outside-surface'],
      },
      {
        childKind: 'item',
        childFootprint: {
          size: [0.2, 1, 0.2],
          rotationY: 0,
        },
        hit: {
          point: [0, 0.8200000000000001, 0],
          normalWorldY: 1,
        },
        expected: {
          position: [0, 0.8200000000000001, 0],
          rotationY: 0,
          surfaceId: 'shelves:1:board:top',
          childFrame: 'surface-local',
          surfaceLocal: {
            position: [0, -0, 0],
            rotationY: 0,
            rotation: [0, 0, 0],
          },
        },
        rejections: [],
      },
      {
        childKind: 'item',
        childFootprint: {
          size: [0.2, 1, 0.2],
          rotationY: 0.3,
        },
        hit: {
          point: [0.1, 0.8200000000000001, 0],
          normalWorldY: 1,
        },
        expected: {
          position: [0.1, 0.8200000000000001, 0],
          rotationY: 0.3,
          surfaceId: 'shelves:1:board:top',
          childFrame: 'surface-local',
          surfaceLocal: {
            position: [0.1, -0, 0],
            rotationY: 0.3,
            rotation: [0, 0.3, 0],
          },
        },
        rejections: [],
      },
      {
        childKind: 'item',
        childFootprint: {
          size: [0.2, 1, 0.6],
          rotationY: 1.5707963267948966,
        },
        hit: {
          point: [0, 0.8200000000000001, 0],
          normalWorldY: 1,
        },
        expected: {
          position: [0, 0.8200000000000001, 0],
          rotationY: 1.5707963267948966,
          surfaceId: 'shelves:1:board:top',
          childFrame: 'surface-local',
          surfaceLocal: {
            position: [0, -0, 0],
            rotationY: 1.5707963267948966,
            rotation: [0, 1.5707963267948966, 0],
          },
        },
        rejections: [],
      },
      {
        childKind: 'item',
        childFootprint: {
          size: [0.6, 1, 0.2],
          rotationY: 0.7853981633974483,
        },
        hit: {
          point: [0, 0.8200000000000001, 0],
          normalWorldY: 1,
        },
        expected: null,
        rejections: ['footprint-outside-surface'],
      },
      {
        childKind: 'item',
        childFootprint: {
          size: [0.4, 1, 0.2],
          rotationY: 0,
        },
        hit: {
          point: [0.5, 0.8200000000000001, 0],
          normalWorldY: 1,
        },
        expected: null,
        rejections: ['footprint-outside-surface'],
      },
      {
        childKind: 'item',
        childFootprint: {
          size: [1.1400009999999998, 1, 0.4],
          rotationY: 0,
        },
        hit: {
          point: [0, 0.8200000000000001, 0],
          normalWorldY: 1,
        },
        expected: {
          position: [0, 0.8200000000000001, 0],
          rotationY: 0,
          surfaceId: 'shelves:1:board:top',
          childFrame: 'surface-local',
          surfaceLocal: {
            position: [0, -0, 0],
            rotationY: 0,
            rotation: [0, 0, 0],
          },
        },
        rejections: [],
      },
      {
        childKind: 'item',
        childFootprint: {
          size: [1.1400039999999998, 1, 0.4],
          rotationY: 0,
        },
        hit: {
          point: [0, 0.8200000000000001, 0],
          normalWorldY: 1,
        },
        expected: null,
        rejections: ['footprint-outside-surface'],
      },
      {
        childKind: 'item',
        childFootprint: {
          size: [0.2, 1, 0.2],
          rotationY: 0,
        },
        hit: {
          point: [0, 1.6099999999999999, 0],
          normalWorldY: 1,
        },
        expected: {
          position: [0, 1.6099999999999999, 0],
          rotationY: 0,
          surfaceId: 'shelves:2:board:top',
          childFrame: 'surface-local',
          surfaceLocal: {
            position: [0, -0, 0],
            rotationY: 0,
            rotation: [0, 0, 0],
          },
        },
        rejections: [],
      },
      {
        childKind: 'item',
        childFootprint: {
          size: [0.2, 1, 0.2],
          rotationY: 0.3,
        },
        hit: {
          point: [0.1, 1.6099999999999999, 0],
          normalWorldY: 1,
        },
        expected: {
          position: [0.1, 1.6099999999999999, 0],
          rotationY: 0.3,
          surfaceId: 'shelves:2:board:top',
          childFrame: 'surface-local',
          surfaceLocal: {
            position: [0.1, -0, 0],
            rotationY: 0.3,
            rotation: [0, 0.3, 0],
          },
        },
        rejections: [],
      },
      {
        childKind: 'item',
        childFootprint: {
          size: [0.2, 1, 0.6],
          rotationY: 1.5707963267948966,
        },
        hit: {
          point: [0, 1.6099999999999999, 0],
          normalWorldY: 1,
        },
        expected: {
          position: [0, 1.6099999999999999, 0],
          rotationY: 1.5707963267948966,
          surfaceId: 'shelves:2:board:top',
          childFrame: 'surface-local',
          surfaceLocal: {
            position: [0, -0, 0],
            rotationY: 1.5707963267948966,
            rotation: [0, 1.5707963267948966, 0],
          },
        },
        rejections: [],
      },
      {
        childKind: 'item',
        childFootprint: {
          size: [0.6, 1, 0.2],
          rotationY: 0.7853981633974483,
        },
        hit: {
          point: [0, 1.6099999999999999, 0],
          normalWorldY: 1,
        },
        expected: null,
        rejections: ['footprint-outside-surface'],
      },
      {
        childKind: 'item',
        childFootprint: {
          size: [0.4, 1, 0.2],
          rotationY: 0,
        },
        hit: {
          point: [0.5, 1.6099999999999999, 0],
          normalWorldY: 1,
        },
        expected: null,
        rejections: ['footprint-outside-surface'],
      },
      {
        childKind: 'item',
        childFootprint: {
          size: [1.1400009999999998, 1, 0.4],
          rotationY: 0,
        },
        hit: {
          point: [0, 1.6099999999999999, 0],
          normalWorldY: 1,
        },
        expected: {
          position: [0, 1.6099999999999999, 0],
          rotationY: 0,
          surfaceId: 'shelves:2:board:top',
          childFrame: 'surface-local',
          surfaceLocal: {
            position: [0, -0, 0],
            rotationY: 0,
            rotation: [0, 0, 0],
          },
        },
        rejections: [],
      },
      {
        childKind: 'item',
        childFootprint: {
          size: [1.1400039999999998, 1, 0.4],
          rotationY: 0,
        },
        hit: {
          point: [0, 1.6099999999999999, 0],
          normalWorldY: 1,
        },
        expected: null,
        rejections: ['footprint-outside-surface'],
      },
      {
        childKind: 'item',
        childFootprint: {
          size: [0.2, 1, 0.2],
          rotationY: 0,
        },
        hit: {
          point: [0, 2.4000000000000004, 0],
          normalWorldY: 1,
        },
        expected: {
          position: [0, 2.4000000000000004, 0],
          rotationY: 0,
          surfaceId: 'shelves:3:board:top',
          childFrame: 'surface-local',
          surfaceLocal: {
            position: [0, -0, 0],
            rotationY: 0,
            rotation: [0, 0, 0],
          },
        },
        rejections: [],
      },
      {
        childKind: 'item',
        childFootprint: {
          size: [0.2, 1, 0.2],
          rotationY: 0.3,
        },
        hit: {
          point: [0.1, 2.4000000000000004, 0],
          normalWorldY: 1,
        },
        expected: {
          position: [0.1, 2.4000000000000004, 0],
          rotationY: 0.3,
          surfaceId: 'shelves:3:board:top',
          childFrame: 'surface-local',
          surfaceLocal: {
            position: [0.1, -0, 0],
            rotationY: 0.3,
            rotation: [0, 0.3, 0],
          },
        },
        rejections: [],
      },
      {
        childKind: 'item',
        childFootprint: {
          size: [0.2, 1, 0.6],
          rotationY: 1.5707963267948966,
        },
        hit: {
          point: [0, 2.4000000000000004, 0],
          normalWorldY: 1,
        },
        expected: {
          position: [0, 2.4000000000000004, 0],
          rotationY: 1.5707963267948966,
          surfaceId: 'shelves:3:board:top',
          childFrame: 'surface-local',
          surfaceLocal: {
            position: [0, -0, 0],
            rotationY: 1.5707963267948966,
            rotation: [0, 1.5707963267948966, 0],
          },
        },
        rejections: [],
      },
      {
        childKind: 'item',
        childFootprint: {
          size: [0.6, 1, 0.2],
          rotationY: 0.7853981633974483,
        },
        hit: {
          point: [0, 2.4000000000000004, 0],
          normalWorldY: 1,
        },
        expected: null,
        rejections: ['footprint-outside-surface'],
      },
      {
        childKind: 'item',
        childFootprint: {
          size: [0.4, 1, 0.2],
          rotationY: 0,
        },
        hit: {
          point: [0.5, 2.4000000000000004, 0],
          normalWorldY: 1,
        },
        expected: null,
        rejections: ['footprint-outside-surface'],
      },
      {
        childKind: 'item',
        childFootprint: {
          size: [1.1400009999999998, 1, 0.4],
          rotationY: 0,
        },
        hit: {
          point: [0, 2.4000000000000004, 0],
          normalWorldY: 1,
        },
        expected: {
          position: [0, 2.4000000000000004, 0],
          rotationY: 0,
          surfaceId: 'shelves:3:board:top',
          childFrame: 'surface-local',
          surfaceLocal: {
            position: [0, -0, 0],
            rotationY: 0,
            rotation: [0, 0, 0],
          },
        },
        rejections: [],
      },
      {
        childKind: 'item',
        childFootprint: {
          size: [1.1400039999999998, 1, 0.4],
          rotationY: 0,
        },
        hit: {
          point: [0, 2.4000000000000004, 0],
          normalWorldY: 1,
        },
        expected: null,
        rejections: ['footprint-outside-surface'],
      },
    ],
    label: 'shelf height 2.4: containment and tolerance',
  },
  {
    host: {
      object: 'node',
      id: 'procedural-item_frozen-2',
      type: 'procedural-item',
      parentId: 'shelf_outer',
      visible: true,
      metadata: {},
      recipe: {
        version: 1,
        name: 'Everyday shelf',
        description: 'An open timber bookcase with adjustable shelves and a contrasting back.',
        surfaces: [
          {
            id: 'ledge',
            label: 'Ledge',
            position: [2, 3, -1],
            rotation: [0, 0.6, 0],
            size: [1.5, 0.6],
          },
        ],
        parameters: [
          {
            id: 'width',
            label: 'Width',
            default: 1.2,
            min: 0.6,
            max: 2.4,
            step: 0.05,
            unit: 'm',
            axis: 'x',
          },
          {
            id: 'height',
            label: 'Height',
            default: 1.8,
            min: 0.8,
            max: 2.5,
            step: 0.05,
            unit: 'm',
            axis: 'y',
          },
          {
            id: 'depth',
            label: 'Depth',
            default: 0.4,
            min: 0.25,
            max: 0.7,
            step: 0.025,
            unit: 'm',
            axis: 'z',
          },
          {
            id: 'rows',
            label: 'Shelves',
            default: 4,
            min: 2,
            max: 7,
            step: 1,
            unit: 'count',
            part: 'shelves',
          },
          {
            id: 'thickness',
            label: 'Board thickness',
            default: 0.03,
            min: 0.015,
            max: 0.06,
            step: 0.005,
            unit: 'm',
            part: 'frame',
          },
        ],
        slots: [
          {
            id: 'frame',
            label: 'Frame',
            color: '#b58a60',
          },
          {
            id: 'shelves',
            label: 'Shelves',
            color: '#d5b38d',
          },
          {
            id: 'back',
            label: 'Back',
            color: '#495b50',
          },
        ],
        parts: [
          {
            id: 'frame',
            label: 'Frame',
            count: 2,
            shapes: [
              {
                id: 'side',
                primitive: 'box',
                slot: 'frame',
                size: ['thickness', 'height', 'depth'],
                position: [
                  {
                    op: 'mul',
                    args: [
                      {
                        op: 'sub',
                        args: ['index', 0.5],
                      },
                      {
                        op: 'sub',
                        args: ['width', 'thickness'],
                      },
                    ],
                  },
                  {
                    op: 'div',
                    args: ['height', 2],
                  },
                  0,
                ],
              },
            ],
          },
          {
            id: 'shelves',
            label: 'Shelves',
            count: 'rows',
            shapes: [
              {
                id: 'board',
                primitive: 'box',
                slot: 'shelves',
                size: [
                  {
                    op: 'sub',
                    args: [
                      'width',
                      {
                        op: 'mul',
                        args: [2, 'thickness'],
                      },
                    ],
                  },
                  'thickness',
                  'depth',
                ],
                position: [
                  0,
                  {
                    op: 'add',
                    args: [
                      {
                        op: 'div',
                        args: ['thickness', 2],
                      },
                      {
                        op: 'mul',
                        args: [
                          'index',
                          {
                            op: 'div',
                            args: [
                              {
                                op: 'sub',
                                args: ['height', 'thickness'],
                              },
                              {
                                op: 'sub',
                                args: ['rows', 1],
                              },
                            ],
                          },
                        ],
                      },
                    ],
                  },
                  0,
                ],
                support: true,
              },
            ],
          },
          {
            id: 'back',
            label: 'Back panel',
            count: 1,
            shapes: [
              {
                id: 'panel',
                primitive: 'box',
                slot: 'back',
                size: [
                  {
                    op: 'sub',
                    args: [
                      'width',
                      {
                        op: 'mul',
                        args: [2, 'thickness'],
                      },
                    ],
                  },
                  'height',
                  0.012,
                ],
                position: [
                  0,
                  {
                    op: 'div',
                    args: ['height', 2],
                  },
                  {
                    op: 'add',
                    args: [
                      {
                        op: 'div',
                        args: ['depth', -2],
                      },
                      0.006,
                    ],
                  },
                ],
              },
            ],
          },
        ],
        constraints: [],
      },
      parameters: {},
      slots: {},
      position: [8, 2, 7],
      rotation: [0, 1, 0],
      children: [],
      attachments: {},
    },
    rows: [
      {
        childKind: 'plugin-child',
        childFootprint: {
          size: [0.4, 1, 0.2],
          rotationY: 0.6,
        },
        hit: {
          point: [2.1932992466516876, 3, -1.0716617139335232],
          normalWorldY: 1,
        },
        expected: {
          position: [2.1932992466516876, 3, -1.0716617139335232],
          rotationY: 0.6,
          surfaceId: 'ledge',
          childFrame: 'surface-local',
          surfaceLocal: {
            position: [0.20000000000000018, -0, 0.05000000000000011],
            rotationY: 0,
            rotation: [0, 0, 0],
          },
        },
        rejections: [],
      },
      {
        childKind: 'item',
        childFootprint: {
          size: [0.5, 1, 0.5],
          rotationY: 0,
        },
        hit: {
          point: [20, 3, 20],
          normalWorldY: 1,
        },
        expected: null,
        rejections: ['no-surface'],
      },
    ],
    label: 'offset yawed ledge: free placement and outside hit',
  },
  {
    host: {
      object: 'node',
      id: 'procedural-item_frozen-3',
      type: 'procedural-item',
      parentId: null,
      visible: true,
      metadata: {},
      recipe: {
        version: 1,
        name: 'Everyday shelf',
        description: 'An open timber bookcase with adjustable shelves and a contrasting back.',
        surfaces: [
          {
            id: 'ledge',
            label: 'Ledge',
            position: [2, 3, -1],
            rotation: [0, 0.6, 0],
            size: [1.5, 0.6],
          },
        ],
        parameters: [
          {
            id: 'width',
            label: 'Width',
            default: 1.2,
            min: 0.6,
            max: 2.4,
            step: 0.05,
            unit: 'm',
            axis: 'x',
          },
          {
            id: 'height',
            label: 'Height',
            default: 1.8,
            min: 0.8,
            max: 2.5,
            step: 0.05,
            unit: 'm',
            axis: 'y',
          },
          {
            id: 'depth',
            label: 'Depth',
            default: 0.4,
            min: 0.25,
            max: 0.7,
            step: 0.025,
            unit: 'm',
            axis: 'z',
          },
          {
            id: 'rows',
            label: 'Shelves',
            default: 4,
            min: 2,
            max: 7,
            step: 1,
            unit: 'count',
            part: 'shelves',
          },
          {
            id: 'thickness',
            label: 'Board thickness',
            default: 0.03,
            min: 0.015,
            max: 0.06,
            step: 0.005,
            unit: 'm',
            part: 'frame',
          },
        ],
        slots: [
          {
            id: 'frame',
            label: 'Frame',
            color: '#b58a60',
          },
          {
            id: 'shelves',
            label: 'Shelves',
            color: '#d5b38d',
          },
          {
            id: 'back',
            label: 'Back',
            color: '#495b50',
          },
        ],
        parts: [
          {
            id: 'frame',
            label: 'Frame',
            count: 2,
            shapes: [
              {
                id: 'side',
                primitive: 'box',
                slot: 'frame',
                size: ['thickness', 'height', 'depth'],
                position: [
                  {
                    op: 'mul',
                    args: [
                      {
                        op: 'sub',
                        args: ['index', 0.5],
                      },
                      {
                        op: 'sub',
                        args: ['width', 'thickness'],
                      },
                    ],
                  },
                  {
                    op: 'div',
                    args: ['height', 2],
                  },
                  0,
                ],
              },
            ],
          },
          {
            id: 'shelves',
            label: 'Shelves',
            count: 'rows',
            shapes: [
              {
                id: 'board',
                primitive: 'box',
                slot: 'shelves',
                size: [
                  {
                    op: 'sub',
                    args: [
                      'width',
                      {
                        op: 'mul',
                        args: [2, 'thickness'],
                      },
                    ],
                  },
                  'thickness',
                  'depth',
                ],
                position: [
                  0,
                  {
                    op: 'add',
                    args: [
                      {
                        op: 'div',
                        args: ['thickness', 2],
                      },
                      {
                        op: 'mul',
                        args: [
                          'index',
                          {
                            op: 'div',
                            args: [
                              {
                                op: 'sub',
                                args: ['height', 'thickness'],
                              },
                              {
                                op: 'sub',
                                args: ['rows', 1],
                              },
                            ],
                          },
                        ],
                      },
                    ],
                  },
                  0,
                ],
                support: true,
              },
            ],
          },
          {
            id: 'back',
            label: 'Back panel',
            count: 1,
            shapes: [
              {
                id: 'panel',
                primitive: 'box',
                slot: 'back',
                size: [
                  {
                    op: 'sub',
                    args: [
                      'width',
                      {
                        op: 'mul',
                        args: [2, 'thickness'],
                      },
                    ],
                  },
                  'height',
                  0.012,
                ],
                position: [
                  0,
                  {
                    op: 'div',
                    args: ['height', 2],
                  },
                  {
                    op: 'add',
                    args: [
                      {
                        op: 'div',
                        args: ['depth', -2],
                      },
                      0.006,
                    ],
                  },
                ],
              },
            ],
          },
        ],
        constraints: [],
      },
      parameters: {},
      slots: {},
      position: [8, 2, 7],
      rotation: [0.1, 1, -0.15],
      children: [],
      attachments: {},
    },
    rows: [
      {
        childKind: 'item',
        childFootprint: {
          size: [0.2, 0.1, 0.2],
          rotationY: 0.6,
        },
        hit: {
          point: [2.539507643010095, 3, -1.344864470674629],
          normalWorldY: 1,
        },
        expected: {
          position: [2.539507643010095, 3, -1.344864470674629],
          rotationY: 0.6,
          surfaceId: 'ledge',
          childFrame: 'surface-local',
          surfaceLocal: {
            position: [0.6400000000000001, -0, 0.020000000000000018],
            rotationY: 0,
            rotation: [0, 0, 0],
          },
        },
        rejections: [],
      },
      {
        childKind: 'item',
        childFootprint: {
          size: [0.2, 0.1, 0.2],
          rotationY: 0.6,
        },
        hit: {
          point: [2.5560143553082884, 3, -1.3561573201425299],
          normalWorldY: 1,
        },
        expected: null,
        rejections: ['footprint-outside-surface'],
      },
      {
        childKind: 'item',
        childFootprint: {
          size: [0.2, 0.1, 0.2],
          rotationY: 0.6,
        },
        hit: {
          point: [2.5560143553082884, 3, -1.3561573201425299],
          normalWorldY: 1,
        },
        checkFootprint: false,
        expected: {
          position: [2.5560143553082884, 3, -1.3561573201425299],
          rotationY: 0.6,
          surfaceId: 'ledge',
          childFrame: 'surface-local',
          surfaceLocal: {
            position: [0.66, -0, 0.019999999999999907],
            rotationY: 0,
            rotation: [0, 0, 0],
          },
        },
        rejections: [],
      },
    ],
    label: 'offset ledge: inverse point at edge and overhang',
  },
  {
    host: {
      object: 'node',
      id: 'procedural-item_frozen-4',
      type: 'procedural-item',
      parentId: null,
      visible: true,
      metadata: {},
      recipe: {
        version: 1,
        name: 'Everyday shelf',
        description: 'An open timber bookcase with adjustable shelves and a contrasting back.',
        surfaces: [
          {
            id: 'ledge',
            label: 'Ledge',
            position: [2, 3, -1],
            rotation: [0, 0.6, 0],
            size: [1.5, 0.6],
          },
        ],
        parameters: [
          {
            id: 'width',
            label: 'Width',
            default: 1.2,
            min: 0.6,
            max: 2.4,
            step: 0.05,
            unit: 'm',
            axis: 'x',
          },
          {
            id: 'height',
            label: 'Height',
            default: 1.8,
            min: 0.8,
            max: 2.5,
            step: 0.05,
            unit: 'm',
            axis: 'y',
          },
          {
            id: 'depth',
            label: 'Depth',
            default: 0.4,
            min: 0.25,
            max: 0.7,
            step: 0.025,
            unit: 'm',
            axis: 'z',
          },
          {
            id: 'rows',
            label: 'Shelves',
            default: 4,
            min: 2,
            max: 7,
            step: 1,
            unit: 'count',
            part: 'shelves',
          },
          {
            id: 'thickness',
            label: 'Board thickness',
            default: 0.03,
            min: 0.015,
            max: 0.06,
            step: 0.005,
            unit: 'm',
            part: 'frame',
          },
        ],
        slots: [
          {
            id: 'frame',
            label: 'Frame',
            color: '#b58a60',
          },
          {
            id: 'shelves',
            label: 'Shelves',
            color: '#d5b38d',
          },
          {
            id: 'back',
            label: 'Back',
            color: '#495b50',
          },
        ],
        parts: [
          {
            id: 'frame',
            label: 'Frame',
            count: 2,
            shapes: [
              {
                id: 'side',
                primitive: 'box',
                slot: 'frame',
                size: ['thickness', 'height', 'depth'],
                position: [
                  {
                    op: 'mul',
                    args: [
                      {
                        op: 'sub',
                        args: ['index', 0.5],
                      },
                      {
                        op: 'sub',
                        args: ['width', 'thickness'],
                      },
                    ],
                  },
                  {
                    op: 'div',
                    args: ['height', 2],
                  },
                  0,
                ],
              },
            ],
          },
          {
            id: 'shelves',
            label: 'Shelves',
            count: 'rows',
            shapes: [
              {
                id: 'board',
                primitive: 'box',
                slot: 'shelves',
                size: [
                  {
                    op: 'sub',
                    args: [
                      'width',
                      {
                        op: 'mul',
                        args: [2, 'thickness'],
                      },
                    ],
                  },
                  'thickness',
                  'depth',
                ],
                position: [
                  0,
                  {
                    op: 'add',
                    args: [
                      {
                        op: 'div',
                        args: ['thickness', 2],
                      },
                      {
                        op: 'mul',
                        args: [
                          'index',
                          {
                            op: 'div',
                            args: [
                              {
                                op: 'sub',
                                args: ['height', 'thickness'],
                              },
                              {
                                op: 'sub',
                                args: ['rows', 1],
                              },
                            ],
                          },
                        ],
                      },
                    ],
                  },
                  0,
                ],
                support: true,
              },
            ],
          },
          {
            id: 'back',
            label: 'Back panel',
            count: 1,
            shapes: [
              {
                id: 'panel',
                primitive: 'box',
                slot: 'back',
                size: [
                  {
                    op: 'sub',
                    args: [
                      'width',
                      {
                        op: 'mul',
                        args: [2, 'thickness'],
                      },
                    ],
                  },
                  'height',
                  0.012,
                ],
                position: [
                  0,
                  {
                    op: 'div',
                    args: ['height', 2],
                  },
                  {
                    op: 'add',
                    args: [
                      {
                        op: 'div',
                        args: ['depth', -2],
                      },
                      0.006,
                    ],
                  },
                ],
              },
            ],
          },
        ],
        constraints: [],
      },
      parameters: {},
      slots: {},
      position: [8, 2, 7],
      rotation: [0.1, 1, -0.15],
      children: [],
      attachments: {},
    },
    rows: [
      {
        childKind: 'item',
        childFootprint: {
          size: [0.8, 0.1, 0.2],
          rotationY: 0.6,
        },
        hit: {
          point: [2.365310480078546, 3, -1.0681780987178604],
          normalWorldY: 1,
        },
        expected: {
          position: [2.365310480078546, 3, -1.0681780987178604],
          rotationY: 0.6,
          surfaceId: 'ledge',
          childFrame: 'surface-local',
          surfaceLocal: {
            position: [0.33999999999999997, -0, 0.14999999999999986],
            rotationY: 0,
            rotation: [0, 0, 0],
          },
        },
        rejections: [],
      },
      {
        childKind: 'item',
        childFootprint: {
          size: [0.8, 0.1, 0.2],
          rotationY: 0.6,
        },
        hit: {
          point: [2.3818171923767393, 3, -1.079470948185761],
          normalWorldY: 1,
        },
        expected: null,
        rejections: ['footprint-outside-surface'],
      },
      {
        childKind: 'item',
        childFootprint: {
          size: [0.8, 0.1, 0.2],
          rotationY: 0.6,
        },
        hit: {
          point: [2.3818171923767393, 3, -1.079470948185761],
          normalWorldY: 1,
        },
        checkFootprint: false,
        expected: {
          position: [2.3818171923767393, 3, -1.079470948185761],
          rotationY: 0.6,
          surfaceId: 'ledge',
          childFrame: 'surface-local',
          surfaceLocal: {
            position: [0.3599999999999998, -0, 0.1499999999999999],
            rotationY: 0,
            rotation: [0, 0, 0],
          },
        },
        rejections: [],
      },
    ],
    label: 'yawed ledge: rotated footprint at edge and overhang',
  },
  {
    host: {
      object: 'node',
      id: 'procedural-item_frozen-5',
      type: 'procedural-item',
      parentId: null,
      visible: true,
      metadata: {},
      recipe: {
        version: 1,
        name: 'Everyday shelf',
        description: 'An open timber bookcase with adjustable shelves and a contrasting back.',
        surfaces: [
          {
            id: 'ledge',
            label: 'Ledge',
            position: [2, 3, -1],
            rotation: [0.3, 0.6, 0.2],
            size: [1.5, 0.6],
          },
        ],
        parameters: [
          {
            id: 'width',
            label: 'Width',
            default: 1.2,
            min: 0.6,
            max: 2.4,
            step: 0.05,
            unit: 'm',
            axis: 'x',
          },
          {
            id: 'height',
            label: 'Height',
            default: 1.8,
            min: 0.8,
            max: 2.5,
            step: 0.05,
            unit: 'm',
            axis: 'y',
          },
          {
            id: 'depth',
            label: 'Depth',
            default: 0.4,
            min: 0.25,
            max: 0.7,
            step: 0.025,
            unit: 'm',
            axis: 'z',
          },
          {
            id: 'rows',
            label: 'Shelves',
            default: 4,
            min: 2,
            max: 7,
            step: 1,
            unit: 'count',
            part: 'shelves',
          },
          {
            id: 'thickness',
            label: 'Board thickness',
            default: 0.03,
            min: 0.015,
            max: 0.06,
            step: 0.005,
            unit: 'm',
            part: 'frame',
          },
        ],
        slots: [
          {
            id: 'frame',
            label: 'Frame',
            color: '#b58a60',
          },
          {
            id: 'shelves',
            label: 'Shelves',
            color: '#d5b38d',
          },
          {
            id: 'back',
            label: 'Back',
            color: '#495b50',
          },
        ],
        parts: [
          {
            id: 'frame',
            label: 'Frame',
            count: 2,
            shapes: [
              {
                id: 'side',
                primitive: 'box',
                slot: 'frame',
                size: ['thickness', 'height', 'depth'],
                position: [
                  {
                    op: 'mul',
                    args: [
                      {
                        op: 'sub',
                        args: ['index', 0.5],
                      },
                      {
                        op: 'sub',
                        args: ['width', 'thickness'],
                      },
                    ],
                  },
                  {
                    op: 'div',
                    args: ['height', 2],
                  },
                  0,
                ],
              },
            ],
          },
          {
            id: 'shelves',
            label: 'Shelves',
            count: 'rows',
            shapes: [
              {
                id: 'board',
                primitive: 'box',
                slot: 'shelves',
                size: [
                  {
                    op: 'sub',
                    args: [
                      'width',
                      {
                        op: 'mul',
                        args: [2, 'thickness'],
                      },
                    ],
                  },
                  'thickness',
                  'depth',
                ],
                position: [
                  0,
                  {
                    op: 'add',
                    args: [
                      {
                        op: 'div',
                        args: ['thickness', 2],
                      },
                      {
                        op: 'mul',
                        args: [
                          'index',
                          {
                            op: 'div',
                            args: [
                              {
                                op: 'sub',
                                args: ['height', 'thickness'],
                              },
                              {
                                op: 'sub',
                                args: ['rows', 1],
                              },
                            ],
                          },
                        ],
                      },
                    ],
                  },
                  0,
                ],
                support: true,
              },
            ],
          },
          {
            id: 'back',
            label: 'Back panel',
            count: 1,
            shapes: [
              {
                id: 'panel',
                primitive: 'box',
                slot: 'back',
                size: [
                  {
                    op: 'sub',
                    args: [
                      'width',
                      {
                        op: 'mul',
                        args: [2, 'thickness'],
                      },
                    ],
                  },
                  'height',
                  0.012,
                ],
                position: [
                  0,
                  {
                    op: 'div',
                    args: ['height', 2],
                  },
                  {
                    op: 'add',
                    args: [
                      {
                        op: 'div',
                        args: ['depth', -2],
                      },
                      0.006,
                    ],
                  },
                ],
              },
            ],
          },
        ],
        constraints: [],
      },
      parameters: {},
      slots: {},
      position: [8, 2, 7],
      rotation: [0.1, 1, -0.15],
      children: [],
      attachments: {},
    },
    rows: [
      {
        childKind: 'item',
        childFootprint: {
          size: [0.2, 0.1, 0.2],
          rotationY: 0.6,
          rotation: [0.3, 0.6, 0.2],
        },
        hit: {
          point: [2.1091205088372544, 3.0231381489851734, -1.0075723584594645],
          normalWorldY: 0.9031427513007916,
        },
        expected: {
          position: [2.1091205088372544, 3.0231381489851734, -1.0075723584594645],
          rotationY: 0.6,
          surfaceId: 'ledge',
          childFrame: 'surface-local',
          surfaceLocal: {
            position: [0.10000000000000009, -0, 0.05000000000000014],
            rotationY: 1.1102230246251565e-16,
            rotation: [-0, 1.1102230246251565e-16, -0],
          },
        },
        rejections: [],
      },
    ],
    label: 'tilted ledge: positive pitch',
  },
  {
    host: {
      object: 'node',
      id: 'procedural-item_frozen-6',
      type: 'procedural-item',
      parentId: null,
      visible: true,
      metadata: {},
      recipe: {
        version: 1,
        name: 'Everyday shelf',
        description: 'An open timber bookcase with adjustable shelves and a contrasting back.',
        surfaces: [
          {
            id: 'ledge',
            label: 'Ledge',
            position: [2, 3, -1],
            rotation: [-0.35, -0.7, 0.25],
            size: [1.5, 0.6],
          },
        ],
        parameters: [
          {
            id: 'width',
            label: 'Width',
            default: 1.2,
            min: 0.6,
            max: 2.4,
            step: 0.05,
            unit: 'm',
            axis: 'x',
          },
          {
            id: 'height',
            label: 'Height',
            default: 1.8,
            min: 0.8,
            max: 2.5,
            step: 0.05,
            unit: 'm',
            axis: 'y',
          },
          {
            id: 'depth',
            label: 'Depth',
            default: 0.4,
            min: 0.25,
            max: 0.7,
            step: 0.025,
            unit: 'm',
            axis: 'z',
          },
          {
            id: 'rows',
            label: 'Shelves',
            default: 4,
            min: 2,
            max: 7,
            step: 1,
            unit: 'count',
            part: 'shelves',
          },
          {
            id: 'thickness',
            label: 'Board thickness',
            default: 0.03,
            min: 0.015,
            max: 0.06,
            step: 0.005,
            unit: 'm',
            part: 'frame',
          },
        ],
        slots: [
          {
            id: 'frame',
            label: 'Frame',
            color: '#b58a60',
          },
          {
            id: 'shelves',
            label: 'Shelves',
            color: '#d5b38d',
          },
          {
            id: 'back',
            label: 'Back',
            color: '#495b50',
          },
        ],
        parts: [
          {
            id: 'frame',
            label: 'Frame',
            count: 2,
            shapes: [
              {
                id: 'side',
                primitive: 'box',
                slot: 'frame',
                size: ['thickness', 'height', 'depth'],
                position: [
                  {
                    op: 'mul',
                    args: [
                      {
                        op: 'sub',
                        args: ['index', 0.5],
                      },
                      {
                        op: 'sub',
                        args: ['width', 'thickness'],
                      },
                    ],
                  },
                  {
                    op: 'div',
                    args: ['height', 2],
                  },
                  0,
                ],
              },
            ],
          },
          {
            id: 'shelves',
            label: 'Shelves',
            count: 'rows',
            shapes: [
              {
                id: 'board',
                primitive: 'box',
                slot: 'shelves',
                size: [
                  {
                    op: 'sub',
                    args: [
                      'width',
                      {
                        op: 'mul',
                        args: [2, 'thickness'],
                      },
                    ],
                  },
                  'thickness',
                  'depth',
                ],
                position: [
                  0,
                  {
                    op: 'add',
                    args: [
                      {
                        op: 'div',
                        args: ['thickness', 2],
                      },
                      {
                        op: 'mul',
                        args: [
                          'index',
                          {
                            op: 'div',
                            args: [
                              {
                                op: 'sub',
                                args: ['height', 'thickness'],
                              },
                              {
                                op: 'sub',
                                args: ['rows', 1],
                              },
                            ],
                          },
                        ],
                      },
                    ],
                  },
                  0,
                ],
                support: true,
              },
            ],
          },
          {
            id: 'back',
            label: 'Back panel',
            count: 1,
            shapes: [
              {
                id: 'panel',
                primitive: 'box',
                slot: 'back',
                size: [
                  {
                    op: 'sub',
                    args: [
                      'width',
                      {
                        op: 'mul',
                        args: [2, 'thickness'],
                      },
                    ],
                  },
                  'height',
                  0.012,
                ],
                position: [
                  0,
                  {
                    op: 'div',
                    args: ['height', 2],
                  },
                  {
                    op: 'add',
                    args: [
                      {
                        op: 'div',
                        args: ['depth', -2],
                      },
                      0.006,
                    ],
                  },
                ],
              },
            ],
          },
        ],
        constraints: [],
      },
      parameters: {},
      slots: {},
      position: [8, 2, 7],
      rotation: [0.1, 1, -0.15],
      children: [],
      attachments: {},
    },
    rows: [
      {
        childKind: 'item',
        childFootprint: {
          size: [0.2, 0.1, 0.2],
          rotationY: -0.7,
          rotation: [-0.35, -0.7, 0.25],
        },
        hit: {
          point: [2.0418956252289435, 3.057756944346273, -0.9139250793409752],
          normalWorldY: 0.8555181495362177,
        },
        expected: {
          position: [2.0418956252289435, 3.057756944346273, -0.9139250793409752],
          rotationY: -0.7,
          surfaceId: 'ledge',
          childFrame: 'surface-local',
          surfaceLocal: {
            position: [0.09999999999999996, 5.551115123125783e-18, 0.04999999999999994],
            rotationY: 5.551115123125783e-17,
            rotation: [-0, 5.551115123125783e-17, -5.551115123125783e-17],
          },
        },
        rejections: [],
      },
    ],
    label: 'tilted ledge: negative pitch',
  },
  {
    host: {
      object: 'node',
      id: 'procedural-item_frozen-7',
      type: 'procedural-item',
      parentId: null,
      visible: true,
      metadata: {},
      recipe: {
        version: 1,
        name: 'Everyday shelf',
        description: 'An open timber bookcase with adjustable shelves and a contrasting back.',
        surfaces: [
          {
            id: 'ledge',
            label: 'Ledge',
            position: [2, 3, -1],
            rotation: [0, 1.5707963267948966, 0],
            size: [1.5, 0.6],
          },
        ],
        parameters: [
          {
            id: 'width',
            label: 'Width',
            default: 1.2,
            min: 0.6,
            max: 2.4,
            step: 0.05,
            unit: 'm',
            axis: 'x',
          },
          {
            id: 'height',
            label: 'Height',
            default: 1.8,
            min: 0.8,
            max: 2.5,
            step: 0.05,
            unit: 'm',
            axis: 'y',
          },
          {
            id: 'depth',
            label: 'Depth',
            default: 0.4,
            min: 0.25,
            max: 0.7,
            step: 0.025,
            unit: 'm',
            axis: 'z',
          },
          {
            id: 'rows',
            label: 'Shelves',
            default: 4,
            min: 2,
            max: 7,
            step: 1,
            unit: 'count',
            part: 'shelves',
          },
          {
            id: 'thickness',
            label: 'Board thickness',
            default: 0.03,
            min: 0.015,
            max: 0.06,
            step: 0.005,
            unit: 'm',
            part: 'frame',
          },
        ],
        slots: [
          {
            id: 'frame',
            label: 'Frame',
            color: '#b58a60',
          },
          {
            id: 'shelves',
            label: 'Shelves',
            color: '#d5b38d',
          },
          {
            id: 'back',
            label: 'Back',
            color: '#495b50',
          },
        ],
        parts: [
          {
            id: 'frame',
            label: 'Frame',
            count: 2,
            shapes: [
              {
                id: 'side',
                primitive: 'box',
                slot: 'frame',
                size: ['thickness', 'height', 'depth'],
                position: [
                  {
                    op: 'mul',
                    args: [
                      {
                        op: 'sub',
                        args: ['index', 0.5],
                      },
                      {
                        op: 'sub',
                        args: ['width', 'thickness'],
                      },
                    ],
                  },
                  {
                    op: 'div',
                    args: ['height', 2],
                  },
                  0,
                ],
              },
            ],
          },
          {
            id: 'shelves',
            label: 'Shelves',
            count: 'rows',
            shapes: [
              {
                id: 'board',
                primitive: 'box',
                slot: 'shelves',
                size: [
                  {
                    op: 'sub',
                    args: [
                      'width',
                      {
                        op: 'mul',
                        args: [2, 'thickness'],
                      },
                    ],
                  },
                  'thickness',
                  'depth',
                ],
                position: [
                  0,
                  {
                    op: 'add',
                    args: [
                      {
                        op: 'div',
                        args: ['thickness', 2],
                      },
                      {
                        op: 'mul',
                        args: [
                          'index',
                          {
                            op: 'div',
                            args: [
                              {
                                op: 'sub',
                                args: ['height', 'thickness'],
                              },
                              {
                                op: 'sub',
                                args: ['rows', 1],
                              },
                            ],
                          },
                        ],
                      },
                    ],
                  },
                  0,
                ],
                support: true,
              },
            ],
          },
          {
            id: 'back',
            label: 'Back panel',
            count: 1,
            shapes: [
              {
                id: 'panel',
                primitive: 'box',
                slot: 'back',
                size: [
                  {
                    op: 'sub',
                    args: [
                      'width',
                      {
                        op: 'mul',
                        args: [2, 'thickness'],
                      },
                    ],
                  },
                  'height',
                  0.012,
                ],
                position: [
                  0,
                  {
                    op: 'div',
                    args: ['height', 2],
                  },
                  {
                    op: 'add',
                    args: [
                      {
                        op: 'div',
                        args: ['depth', -2],
                      },
                      0.006,
                    ],
                  },
                ],
              },
            ],
          },
        ],
        constraints: [],
      },
      parameters: {},
      slots: {},
      position: [8, 2, 7],
      rotation: [0.1, 1, -0.15],
      children: [],
      attachments: {},
    },
    rows: [
      {
        childKind: 'item',
        childFootprint: {
          size: [0.2, 0.1, 0.2],
          rotationY: 1.5707963267948966,
          rotation: [0, 1.5707963267948966, 0],
        },
        hit: {
          point: [2.05, 3, -1.1],
          normalWorldY: 1,
        },
        expected: {
          position: [2.05, 3, -1.1],
          rotationY: 1.5707963267948966,
          surfaceId: 'ledge',
          childFrame: 'surface-local',
          surfaceLocal: {
            position: [0.10000000000000009, -0, 0.049999999999999815],
            rotationY: 0,
            rotation: [0, 0, 0],
          },
        },
        rejections: [],
      },
    ],
    label: 'ledge: quarter-turn yaw',
  },
  {
    host: {
      object: 'node',
      id: 'procedural-item_frozen-8',
      type: 'procedural-item',
      parentId: null,
      visible: true,
      metadata: {},
      recipe: {
        version: 1,
        name: 'Everyday shelf',
        description: 'An open timber bookcase with adjustable shelves and a contrasting back.',
        surfaces: [
          {
            id: 'ledge',
            label: 'Ledge',
            position: [2, 3, -1],
            rotation: [0, 0, 0],
            size: [1.5, 0.6],
          },
        ],
        parameters: [
          {
            id: 'width',
            label: 'Width',
            default: 1.2,
            min: 0.6,
            max: 2.4,
            step: 0.05,
            unit: 'm',
            axis: 'x',
          },
          {
            id: 'height',
            label: 'Height',
            default: 1.8,
            min: 0.8,
            max: 2.5,
            step: 0.05,
            unit: 'm',
            axis: 'y',
          },
          {
            id: 'depth',
            label: 'Depth',
            default: 0.4,
            min: 0.25,
            max: 0.7,
            step: 0.025,
            unit: 'm',
            axis: 'z',
          },
          {
            id: 'rows',
            label: 'Shelves',
            default: 4,
            min: 2,
            max: 7,
            step: 1,
            unit: 'count',
            part: 'shelves',
          },
          {
            id: 'thickness',
            label: 'Board thickness',
            default: 0.03,
            min: 0.015,
            max: 0.06,
            step: 0.005,
            unit: 'm',
            part: 'frame',
          },
        ],
        slots: [
          {
            id: 'frame',
            label: 'Frame',
            color: '#b58a60',
          },
          {
            id: 'shelves',
            label: 'Shelves',
            color: '#d5b38d',
          },
          {
            id: 'back',
            label: 'Back',
            color: '#495b50',
          },
        ],
        parts: [
          {
            id: 'frame',
            label: 'Frame',
            count: 2,
            shapes: [
              {
                id: 'side',
                primitive: 'box',
                slot: 'frame',
                size: ['thickness', 'height', 'depth'],
                position: [
                  {
                    op: 'mul',
                    args: [
                      {
                        op: 'sub',
                        args: ['index', 0.5],
                      },
                      {
                        op: 'sub',
                        args: ['width', 'thickness'],
                      },
                    ],
                  },
                  {
                    op: 'div',
                    args: ['height', 2],
                  },
                  0,
                ],
              },
            ],
          },
          {
            id: 'shelves',
            label: 'Shelves',
            count: 'rows',
            shapes: [
              {
                id: 'board',
                primitive: 'box',
                slot: 'shelves',
                size: [
                  {
                    op: 'sub',
                    args: [
                      'width',
                      {
                        op: 'mul',
                        args: [2, 'thickness'],
                      },
                    ],
                  },
                  'thickness',
                  'depth',
                ],
                position: [
                  0,
                  {
                    op: 'add',
                    args: [
                      {
                        op: 'div',
                        args: ['thickness', 2],
                      },
                      {
                        op: 'mul',
                        args: [
                          'index',
                          {
                            op: 'div',
                            args: [
                              {
                                op: 'sub',
                                args: ['height', 'thickness'],
                              },
                              {
                                op: 'sub',
                                args: ['rows', 1],
                              },
                            ],
                          },
                        ],
                      },
                    ],
                  },
                  0,
                ],
                support: true,
              },
            ],
          },
          {
            id: 'back',
            label: 'Back panel',
            count: 1,
            shapes: [
              {
                id: 'panel',
                primitive: 'box',
                slot: 'back',
                size: [
                  {
                    op: 'sub',
                    args: [
                      'width',
                      {
                        op: 'mul',
                        args: [2, 'thickness'],
                      },
                    ],
                  },
                  'height',
                  0.012,
                ],
                position: [
                  0,
                  {
                    op: 'div',
                    args: ['height', 2],
                  },
                  {
                    op: 'add',
                    args: [
                      {
                        op: 'div',
                        args: ['depth', -2],
                      },
                      0.006,
                    ],
                  },
                ],
              },
            ],
          },
        ],
        constraints: [],
      },
      parameters: {},
      slots: {},
      position: [8, 2, 7],
      rotation: [0.1, 1, -0.15],
      children: [],
      attachments: {},
    },
    rows: [
      {
        childKind: 'item',
        childFootprint: {
          size: [0.3, 0.4, 0.2],
          rotationY: 0.2,
          rotation: [0.4, 0.2, 0],
          localBounds: {
            min: [-0.15, 0, -0.1],
            max: [0.15, 0.4, 0.1],
          },
        },
        hit: {
          point: [2, 3, -1],
          normalWorldY: 1,
        },
        checkFootprint: false,
        expected: {
          position: [2, 3.049770412429372, -1],
          rotationY: 0.2,
          surfaceId: 'ledge',
          childFrame: 'surface-local',
          surfaceLocal: {
            position: [0, 0.04977041242937208, 0],
            rotationY: 0.2,
            rotation: [0.39999999999999997, 0.2, -0],
          },
        },
        rejections: [],
      },
      {
        childKind: 'item',
        childFootprint: {
          size: [0.3, 0.4, 0.2],
          rotationY: 0.2,
          rotation: [0.4, 0.2, 0],
          localBounds: {
            min: [-0.15, 0, -0.1],
            max: [0.15, 0.4, 0.1],
          },
        },
        hit: {
          point: [2, 3, -1],
          normalWorldY: 1,
        },
        expected: {
          position: [2, 3.049770412429372, -1],
          rotationY: 0.2,
          surfaceId: 'ledge',
          childFrame: 'surface-local',
          surfaceLocal: {
            position: [0, 0.04977041242937208, 0],
            rotationY: 0.2,
            rotation: [0.39999999999999997, 0.2, -0],
          },
        },
        rejections: [],
      },
      {
        childKind: 'item',
        childFootprint: {
          size: [0.3, 0.4, 0.2],
          rotationY: 0.2,
          rotation: [0.4, 0.2, 0],
          localBounds: {
            min: [-0.15, 0, -0.1],
            max: [0.15, 0.4, 0.1],
          },
        },
        hit: {
          point: [2.35, 3, -1],
          normalWorldY: 1,
        },
        checkFootprint: false,
        expected: {
          position: [2.35, 3.049770412429372, -1],
          rotationY: 0.2,
          surfaceId: 'ledge',
          childFrame: 'surface-local',
          surfaceLocal: {
            position: [0.3500000000000001, 0.04977041242937208, 0],
            rotationY: 0.2,
            rotation: [0.39999999999999997, 0.2, -0],
          },
        },
        rejections: [],
      },
      {
        childKind: 'item',
        childFootprint: {
          size: [0.3, 0.4, 0.2],
          rotationY: 0.2,
          rotation: [0.4, 0.2, 0],
          localBounds: {
            min: [-0.15, 0, -0.1],
            max: [0.15, 0.4, 0.1],
          },
        },
        hit: {
          point: [2.35, 3, -1],
          normalWorldY: 1,
        },
        expected: {
          position: [2.35, 3.049770412429372, -1],
          rotationY: 0.2,
          surfaceId: 'ledge',
          childFrame: 'surface-local',
          surfaceLocal: {
            position: [0.3500000000000001, 0.04977041242937208, 0],
            rotationY: 0.2,
            rotation: [0.39999999999999997, 0.2, -0],
          },
        },
        rejections: [],
      },
      {
        childKind: 'item',
        childFootprint: {
          size: [0.3, 0.4, 0.2],
          rotationY: 0.2,
          rotation: [0.4, 0.2, 0],
          localBounds: {
            min: [-0.15, 0, -0.1],
            max: [0.15, 0.4, 0.1],
          },
        },
        hit: {
          point: [2.6, 3, -1],
          normalWorldY: 1,
        },
        checkFootprint: false,
        expected: {
          position: [2.6, 3.049770412429372, -1],
          rotationY: 0.2,
          surfaceId: 'ledge',
          childFrame: 'surface-local',
          surfaceLocal: {
            position: [0.6000000000000001, 0.04977041242937208, 0],
            rotationY: 0.2,
            rotation: [0.39999999999999997, 0.2, -0],
          },
        },
        rejections: [],
      },
      {
        childKind: 'item',
        childFootprint: {
          size: [0.3, 0.4, 0.2],
          rotationY: 0.2,
          rotation: [0.4, 0.2, 0],
          localBounds: {
            min: [-0.15, 0, -0.1],
            max: [0.15, 0.4, 0.1],
          },
        },
        hit: {
          point: [2.6, 3, -1],
          normalWorldY: 1,
        },
        expected: null,
        rejections: ['footprint-outside-surface'],
      },
      {
        childKind: 'procedural-item',
        childFootprint: {
          size: [0.30000000000000004, 0.4000000000000001, 0.2],
          rotationY: 0.2,
          rotation: [0.4, 0.2, 0],
          localBounds: {
            min: [0.1, 0.14999999999999997, -0.15000000000000002],
            max: [0.4, 0.55, 0.05],
          },
        },
        hit: {
          point: [2, 3, -1],
          normalWorldY: 1,
        },
        checkFootprint: false,
        expected: {
          position: [2, 2.8731870978577416, -1],
          rotationY: 0.2,
          surfaceId: 'ledge',
          childFrame: 'surface-local',
          surfaceLocal: {
            position: [0, -0.1268129021422585, 0],
            rotationY: 0.2,
            rotation: [0.39999999999999997, 0.2, -0],
          },
        },
        rejections: [],
      },
      {
        childKind: 'procedural-item',
        childFootprint: {
          size: [0.30000000000000004, 0.4000000000000001, 0.2],
          rotationY: 0.2,
          rotation: [0.4, 0.2, 0],
          localBounds: {
            min: [0.1, 0.14999999999999997, -0.15000000000000002],
            max: [0.4, 0.55, 0.05],
          },
        },
        hit: {
          point: [2, 3, -1],
          normalWorldY: 1,
        },
        expected: {
          position: [2, 2.8731870978577416, -1],
          rotationY: 0.2,
          surfaceId: 'ledge',
          childFrame: 'surface-local',
          surfaceLocal: {
            position: [0, -0.1268129021422585, 0],
            rotationY: 0.2,
            rotation: [0.39999999999999997, 0.2, -0],
          },
        },
        rejections: [],
      },
      {
        childKind: 'procedural-item',
        childFootprint: {
          size: [0.30000000000000004, 0.4000000000000001, 0.2],
          rotationY: 0.2,
          rotation: [0.4, 0.2, 0],
          localBounds: {
            min: [0.1, 0.14999999999999997, -0.15000000000000002],
            max: [0.4, 0.55, 0.05],
          },
        },
        hit: {
          point: [2.35, 3, -1],
          normalWorldY: 1,
        },
        checkFootprint: false,
        expected: {
          position: [2.35, 2.8731870978577416, -1],
          rotationY: 0.2,
          surfaceId: 'ledge',
          childFrame: 'surface-local',
          surfaceLocal: {
            position: [0.3500000000000001, -0.1268129021422585, 0],
            rotationY: 0.2,
            rotation: [0.39999999999999997, 0.2, -0],
          },
        },
        rejections: [],
      },
      {
        childKind: 'procedural-item',
        childFootprint: {
          size: [0.30000000000000004, 0.4000000000000001, 0.2],
          rotationY: 0.2,
          rotation: [0.4, 0.2, 0],
          localBounds: {
            min: [0.1, 0.14999999999999997, -0.15000000000000002],
            max: [0.4, 0.55, 0.05],
          },
        },
        hit: {
          point: [2.35, 3, -1],
          normalWorldY: 1,
        },
        expected: null,
        rejections: ['footprint-outside-surface'],
      },
      {
        childKind: 'procedural-item',
        childFootprint: {
          size: [0.30000000000000004, 0.4000000000000001, 0.2],
          rotationY: 0.2,
          rotation: [0.4, 0.2, 0],
          localBounds: {
            min: [0.1, 0.14999999999999997, -0.15000000000000002],
            max: [0.4, 0.55, 0.05],
          },
        },
        hit: {
          point: [2.6, 3, -1],
          normalWorldY: 1,
        },
        checkFootprint: false,
        expected: {
          position: [2.6, 2.8731870978577416, -1],
          rotationY: 0.2,
          surfaceId: 'ledge',
          childFrame: 'surface-local',
          surfaceLocal: {
            position: [0.6000000000000001, -0.1268129021422585, 0],
            rotationY: 0.2,
            rotation: [0.39999999999999997, 0.2, -0],
          },
        },
        rejections: [],
      },
      {
        childKind: 'procedural-item',
        childFootprint: {
          size: [0.30000000000000004, 0.4000000000000001, 0.2],
          rotationY: 0.2,
          rotation: [0.4, 0.2, 0],
          localBounds: {
            min: [0.1, 0.14999999999999997, -0.15000000000000002],
            max: [0.4, 0.55, 0.05],
          },
        },
        hit: {
          point: [2.6, 3, -1],
          normalWorldY: 1,
        },
        expected: null,
        rejections: ['footprint-outside-surface'],
      },
      {
        childKind: 'item',
        childFootprint: {
          size: [0.3, 0.4, 0.2],
          rotationY: -0.3,
          rotation: [0, -0.3, 0.45],
          localBounds: {
            min: [-0.15, 0, -0.1],
            max: [0.15, 0.4, 0.1],
          },
        },
        hit: {
          point: [2, 3, -1],
          normalWorldY: 1,
        },
        checkFootprint: false,
        expected: {
          position: [2, 3.0652448301166846, -1],
          rotationY: -0.3,
          surfaceId: 'ledge',
          childFrame: 'surface-local',
          surfaceLocal: {
            position: [0, 0.06524483011668453, 0],
            rotationY: -0.3,
            rotation: [-0, -0.3, 0.45],
          },
        },
        rejections: [],
      },
      {
        childKind: 'item',
        childFootprint: {
          size: [0.3, 0.4, 0.2],
          rotationY: -0.3,
          rotation: [0, -0.3, 0.45],
          localBounds: {
            min: [-0.15, 0, -0.1],
            max: [0.15, 0.4, 0.1],
          },
        },
        hit: {
          point: [2, 3, -1],
          normalWorldY: 1,
        },
        expected: {
          position: [2, 3.0652448301166846, -1],
          rotationY: -0.3,
          surfaceId: 'ledge',
          childFrame: 'surface-local',
          surfaceLocal: {
            position: [0, 0.06524483011668453, 0],
            rotationY: -0.3,
            rotation: [-0, -0.3, 0.45],
          },
        },
        rejections: [],
      },
      {
        childKind: 'item',
        childFootprint: {
          size: [0.3, 0.4, 0.2],
          rotationY: -0.3,
          rotation: [0, -0.3, 0.45],
          localBounds: {
            min: [-0.15, 0, -0.1],
            max: [0.15, 0.4, 0.1],
          },
        },
        hit: {
          point: [2.35, 3, -1],
          normalWorldY: 1,
        },
        checkFootprint: false,
        expected: {
          position: [2.35, 3.0652448301166846, -1],
          rotationY: -0.3,
          surfaceId: 'ledge',
          childFrame: 'surface-local',
          surfaceLocal: {
            position: [0.3500000000000001, 0.06524483011668453, 0],
            rotationY: -0.3,
            rotation: [-0, -0.3, 0.45],
          },
        },
        rejections: [],
      },
      {
        childKind: 'item',
        childFootprint: {
          size: [0.3, 0.4, 0.2],
          rotationY: -0.3,
          rotation: [0, -0.3, 0.45],
          localBounds: {
            min: [-0.15, 0, -0.1],
            max: [0.15, 0.4, 0.1],
          },
        },
        hit: {
          point: [2.35, 3, -1],
          normalWorldY: 1,
        },
        expected: {
          position: [2.35, 3.0652448301166846, -1],
          rotationY: -0.3,
          surfaceId: 'ledge',
          childFrame: 'surface-local',
          surfaceLocal: {
            position: [0.3500000000000001, 0.06524483011668453, 0],
            rotationY: -0.3,
            rotation: [-0, -0.3, 0.45],
          },
        },
        rejections: [],
      },
      {
        childKind: 'item',
        childFootprint: {
          size: [0.3, 0.4, 0.2],
          rotationY: -0.3,
          rotation: [0, -0.3, 0.45],
          localBounds: {
            min: [-0.15, 0, -0.1],
            max: [0.15, 0.4, 0.1],
          },
        },
        hit: {
          point: [2.6, 3, -1],
          normalWorldY: 1,
        },
        checkFootprint: false,
        expected: {
          position: [2.6, 3.0652448301166846, -1],
          rotationY: -0.3,
          surfaceId: 'ledge',
          childFrame: 'surface-local',
          surfaceLocal: {
            position: [0.6000000000000001, 0.06524483011668453, 0],
            rotationY: -0.3,
            rotation: [-0, -0.3, 0.45],
          },
        },
        rejections: [],
      },
      {
        childKind: 'item',
        childFootprint: {
          size: [0.3, 0.4, 0.2],
          rotationY: -0.3,
          rotation: [0, -0.3, 0.45],
          localBounds: {
            min: [-0.15, 0, -0.1],
            max: [0.15, 0.4, 0.1],
          },
        },
        hit: {
          point: [2.6, 3, -1],
          normalWorldY: 1,
        },
        expected: null,
        rejections: ['footprint-outside-surface'],
      },
      {
        childKind: 'procedural-item',
        childFootprint: {
          size: [0.30000000000000004, 0.4000000000000001, 0.2],
          rotationY: -0.3,
          rotation: [0, -0.3, 0.45],
          localBounds: {
            min: [0.1, 0.14999999999999997, -0.15000000000000002],
            max: [0.4, 0.55, 0.05],
          },
        },
        hit: {
          point: [2, 3, -1],
          normalWorldY: 1,
        },
        checkFootprint: false,
        expected: {
          position: [2, 2.8214363812359755, -1],
          rotationY: -0.3,
          surfaceId: 'ledge',
          childFrame: 'surface-local',
          surfaceLocal: {
            position: [0, -0.17856361876402452, 0],
            rotationY: -0.3,
            rotation: [-0, -0.3, 0.45],
          },
        },
        rejections: [],
      },
      {
        childKind: 'procedural-item',
        childFootprint: {
          size: [0.30000000000000004, 0.4000000000000001, 0.2],
          rotationY: -0.3,
          rotation: [0, -0.3, 0.45],
          localBounds: {
            min: [0.1, 0.14999999999999997, -0.15000000000000002],
            max: [0.4, 0.55, 0.05],
          },
        },
        hit: {
          point: [2, 3, -1],
          normalWorldY: 1,
        },
        expected: {
          position: [2, 2.8214363812359755, -1],
          rotationY: -0.3,
          surfaceId: 'ledge',
          childFrame: 'surface-local',
          surfaceLocal: {
            position: [0, -0.17856361876402452, 0],
            rotationY: -0.3,
            rotation: [-0, -0.3, 0.45],
          },
        },
        rejections: [],
      },
      {
        childKind: 'procedural-item',
        childFootprint: {
          size: [0.30000000000000004, 0.4000000000000001, 0.2],
          rotationY: -0.3,
          rotation: [0, -0.3, 0.45],
          localBounds: {
            min: [0.1, 0.14999999999999997, -0.15000000000000002],
            max: [0.4, 0.55, 0.05],
          },
        },
        hit: {
          point: [2.35, 3, -1],
          normalWorldY: 1,
        },
        checkFootprint: false,
        expected: {
          position: [2.35, 2.8214363812359755, -1],
          rotationY: -0.3,
          surfaceId: 'ledge',
          childFrame: 'surface-local',
          surfaceLocal: {
            position: [0.3500000000000001, -0.17856361876402452, 0],
            rotationY: -0.3,
            rotation: [-0, -0.3, 0.45],
          },
        },
        rejections: [],
      },
      {
        childKind: 'procedural-item',
        childFootprint: {
          size: [0.30000000000000004, 0.4000000000000001, 0.2],
          rotationY: -0.3,
          rotation: [0, -0.3, 0.45],
          localBounds: {
            min: [0.1, 0.14999999999999997, -0.15000000000000002],
            max: [0.4, 0.55, 0.05],
          },
        },
        hit: {
          point: [2.35, 3, -1],
          normalWorldY: 1,
        },
        expected: {
          position: [2.35, 2.8214363812359755, -1],
          rotationY: -0.3,
          surfaceId: 'ledge',
          childFrame: 'surface-local',
          surfaceLocal: {
            position: [0.3500000000000001, -0.17856361876402452, 0],
            rotationY: -0.3,
            rotation: [-0, -0.3, 0.45],
          },
        },
        rejections: [],
      },
      {
        childKind: 'procedural-item',
        childFootprint: {
          size: [0.30000000000000004, 0.4000000000000001, 0.2],
          rotationY: -0.3,
          rotation: [0, -0.3, 0.45],
          localBounds: {
            min: [0.1, 0.14999999999999997, -0.15000000000000002],
            max: [0.4, 0.55, 0.05],
          },
        },
        hit: {
          point: [2.6, 3, -1],
          normalWorldY: 1,
        },
        checkFootprint: false,
        expected: {
          position: [2.6, 2.8214363812359755, -1],
          rotationY: -0.3,
          surfaceId: 'ledge',
          childFrame: 'surface-local',
          surfaceLocal: {
            position: [0.6000000000000001, -0.17856361876402452, 0],
            rotationY: -0.3,
            rotation: [-0, -0.3, 0.45],
          },
        },
        rejections: [],
      },
      {
        childKind: 'procedural-item',
        childFootprint: {
          size: [0.30000000000000004, 0.4000000000000001, 0.2],
          rotationY: -0.3,
          rotation: [0, -0.3, 0.45],
          localBounds: {
            min: [0.1, 0.14999999999999997, -0.15000000000000002],
            max: [0.4, 0.55, 0.05],
          },
        },
        hit: {
          point: [2.6, 3, -1],
          normalWorldY: 1,
        },
        expected: null,
        rejections: ['footprint-outside-surface'],
      },
      {
        childKind: 'item',
        childFootprint: {
          size: [0.3, 0.4, 0.2],
          rotationY: 0.2,
          rotation: [0.3, 0.2, -0.4],
          localBounds: {
            min: [-0.15, 0, -0.1],
            max: [0.15, 0.4, 0.1],
          },
        },
        hit: {
          point: [2, 3, -1],
          normalWorldY: 1,
        },
        checkFootprint: false,
        expected: {
          position: [2, 3.076655346148867, -1],
          rotationY: 0.2,
          surfaceId: 'ledge',
          childFrame: 'surface-local',
          surfaceLocal: {
            position: [0, 0.07665534614886717, 0],
            rotationY: 0.2,
            rotation: [0.3, 0.2, -0.39999999999999997],
          },
        },
        rejections: [],
      },
      {
        childKind: 'item',
        childFootprint: {
          size: [0.3, 0.4, 0.2],
          rotationY: 0.2,
          rotation: [0.3, 0.2, -0.4],
          localBounds: {
            min: [-0.15, 0, -0.1],
            max: [0.15, 0.4, 0.1],
          },
        },
        hit: {
          point: [2, 3, -1],
          normalWorldY: 1,
        },
        expected: {
          position: [2, 3.076655346148867, -1],
          rotationY: 0.2,
          surfaceId: 'ledge',
          childFrame: 'surface-local',
          surfaceLocal: {
            position: [0, 0.07665534614886717, 0],
            rotationY: 0.2,
            rotation: [0.3, 0.2, -0.39999999999999997],
          },
        },
        rejections: [],
      },
      {
        childKind: 'item',
        childFootprint: {
          size: [0.3, 0.4, 0.2],
          rotationY: 0.2,
          rotation: [0.3, 0.2, -0.4],
          localBounds: {
            min: [-0.15, 0, -0.1],
            max: [0.15, 0.4, 0.1],
          },
        },
        hit: {
          point: [2.35, 3, -1],
          normalWorldY: 1,
        },
        checkFootprint: false,
        expected: {
          position: [2.35, 3.076655346148867, -1],
          rotationY: 0.2,
          surfaceId: 'ledge',
          childFrame: 'surface-local',
          surfaceLocal: {
            position: [0.3500000000000001, 0.07665534614886717, 0],
            rotationY: 0.2,
            rotation: [0.3, 0.2, -0.39999999999999997],
          },
        },
        rejections: [],
      },
      {
        childKind: 'item',
        childFootprint: {
          size: [0.3, 0.4, 0.2],
          rotationY: 0.2,
          rotation: [0.3, 0.2, -0.4],
          localBounds: {
            min: [-0.15, 0, -0.1],
            max: [0.15, 0.4, 0.1],
          },
        },
        hit: {
          point: [2.35, 3, -1],
          normalWorldY: 1,
        },
        expected: {
          position: [2.35, 3.076655346148867, -1],
          rotationY: 0.2,
          surfaceId: 'ledge',
          childFrame: 'surface-local',
          surfaceLocal: {
            position: [0.3500000000000001, 0.07665534614886717, 0],
            rotationY: 0.2,
            rotation: [0.3, 0.2, -0.39999999999999997],
          },
        },
        rejections: [],
      },
      {
        childKind: 'item',
        childFootprint: {
          size: [0.3, 0.4, 0.2],
          rotationY: 0.2,
          rotation: [0.3, 0.2, -0.4],
          localBounds: {
            min: [-0.15, 0, -0.1],
            max: [0.15, 0.4, 0.1],
          },
        },
        hit: {
          point: [2.6, 3, -1],
          normalWorldY: 1,
        },
        checkFootprint: false,
        expected: {
          position: [2.6, 3.076655346148867, -1],
          rotationY: 0.2,
          surfaceId: 'ledge',
          childFrame: 'surface-local',
          surfaceLocal: {
            position: [0.6000000000000001, 0.07665534614886717, 0],
            rotationY: 0.2,
            rotation: [0.3, 0.2, -0.39999999999999997],
          },
        },
        rejections: [],
      },
      {
        childKind: 'item',
        childFootprint: {
          size: [0.3, 0.4, 0.2],
          rotationY: 0.2,
          rotation: [0.3, 0.2, -0.4],
          localBounds: {
            min: [-0.15, 0, -0.1],
            max: [0.15, 0.4, 0.1],
          },
        },
        hit: {
          point: [2.6, 3, -1],
          normalWorldY: 1,
        },
        expected: null,
        rejections: ['footprint-outside-surface'],
      },
      {
        childKind: 'procedural-item',
        childFootprint: {
          size: [0.30000000000000004, 0.4000000000000001, 0.2],
          rotationY: 0.2,
          rotation: [0.3, 0.2, -0.4],
          localBounds: {
            min: [0.1, 0.14999999999999997, -0.15000000000000002],
            max: [0.4, 0.55, 0.05],
          },
        },
        hit: {
          point: [2, 3, -1],
          normalWorldY: 1,
        },
        checkFootprint: false,
        expected: {
          position: [2, 3.006243267008579, -1],
          rotationY: 0.2,
          surfaceId: 'ledge',
          childFrame: 'surface-local',
          surfaceLocal: {
            position: [0, 0.006243267008578949, 0],
            rotationY: 0.2,
            rotation: [0.3, 0.2, -0.39999999999999997],
          },
        },
        rejections: [],
      },
      {
        childKind: 'procedural-item',
        childFootprint: {
          size: [0.30000000000000004, 0.4000000000000001, 0.2],
          rotationY: 0.2,
          rotation: [0.3, 0.2, -0.4],
          localBounds: {
            min: [0.1, 0.14999999999999997, -0.15000000000000002],
            max: [0.4, 0.55, 0.05],
          },
        },
        hit: {
          point: [2, 3, -1],
          normalWorldY: 1,
        },
        expected: {
          position: [2, 3.006243267008579, -1],
          rotationY: 0.2,
          surfaceId: 'ledge',
          childFrame: 'surface-local',
          surfaceLocal: {
            position: [0, 0.006243267008578949, 0],
            rotationY: 0.2,
            rotation: [0.3, 0.2, -0.39999999999999997],
          },
        },
        rejections: [],
      },
      {
        childKind: 'procedural-item',
        childFootprint: {
          size: [0.30000000000000004, 0.4000000000000001, 0.2],
          rotationY: 0.2,
          rotation: [0.3, 0.2, -0.4],
          localBounds: {
            min: [0.1, 0.14999999999999997, -0.15000000000000002],
            max: [0.4, 0.55, 0.05],
          },
        },
        hit: {
          point: [2.35, 3, -1],
          normalWorldY: 1,
        },
        checkFootprint: false,
        expected: {
          position: [2.35, 3.006243267008579, -1],
          rotationY: 0.2,
          surfaceId: 'ledge',
          childFrame: 'surface-local',
          surfaceLocal: {
            position: [0.3500000000000001, 0.006243267008578949, 0],
            rotationY: 0.2,
            rotation: [0.3, 0.2, -0.39999999999999997],
          },
        },
        rejections: [],
      },
      {
        childKind: 'procedural-item',
        childFootprint: {
          size: [0.30000000000000004, 0.4000000000000001, 0.2],
          rotationY: 0.2,
          rotation: [0.3, 0.2, -0.4],
          localBounds: {
            min: [0.1, 0.14999999999999997, -0.15000000000000002],
            max: [0.4, 0.55, 0.05],
          },
        },
        hit: {
          point: [2.35, 3, -1],
          normalWorldY: 1,
        },
        expected: null,
        rejections: ['footprint-outside-surface'],
      },
      {
        childKind: 'procedural-item',
        childFootprint: {
          size: [0.30000000000000004, 0.4000000000000001, 0.2],
          rotationY: 0.2,
          rotation: [0.3, 0.2, -0.4],
          localBounds: {
            min: [0.1, 0.14999999999999997, -0.15000000000000002],
            max: [0.4, 0.55, 0.05],
          },
        },
        hit: {
          point: [2.6, 3, -1],
          normalWorldY: 1,
        },
        checkFootprint: false,
        expected: {
          position: [2.6, 3.006243267008579, -1],
          rotationY: 0.2,
          surfaceId: 'ledge',
          childFrame: 'surface-local',
          surfaceLocal: {
            position: [0.6000000000000001, 0.006243267008578949, 0],
            rotationY: 0.2,
            rotation: [0.3, 0.2, -0.39999999999999997],
          },
        },
        rejections: [],
      },
      {
        childKind: 'procedural-item',
        childFootprint: {
          size: [0.30000000000000004, 0.4000000000000001, 0.2],
          rotationY: 0.2,
          rotation: [0.3, 0.2, -0.4],
          localBounds: {
            min: [0.1, 0.14999999999999997, -0.15000000000000002],
            max: [0.4, 0.55, 0.05],
          },
        },
        hit: {
          point: [2.6, 3, -1],
          normalWorldY: 1,
        },
        expected: null,
        rejections: ['footprint-outside-surface'],
      },
    ],
    label: 'full child rotation: centred and off-centre bounds',
  },
]
