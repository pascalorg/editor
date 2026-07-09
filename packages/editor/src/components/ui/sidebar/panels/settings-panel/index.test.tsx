import { describe, expect, test } from 'bun:test'
import { __settingsPanelCaptureTestHooks } from './index'

type TestJsonValue =
  | string
  | number
  | boolean
  | null
  | TestJsonValue[]
  | { [key: string]: TestJsonValue }

describe('settings panel capture scene graph export', () => {
  test('lifts capture review modes into the exported capture summary', () => {
    const reviewModes: TestJsonValue[] = [
      {
        id: 'clayMesh',
        label: 'Clay mesh',
        cameraPath: { path: 'previews/camera_path_sample.json' },
        files: [{ path: 'previews/mesh_sample.json' }],
      },
      {
        id: 'pointCloud',
        label: 'Point cloud',
        cameraPath: { path: 'previews/camera_path_sample.json' },
        files: [{ path: 'previews/pointcloud_sample.json' }],
      },
      {
        id: 'pascal3d',
        label: 'Pascal 3D',
        files: [],
      },
      {
        id: 'room',
        label: 'Room',
        files: [{ path: 'roomplan/room.usdz' }],
      },
    ]

    const captures = __settingsPanelCaptureTestHooks.buildCaptureReferences({
      zone_1: {
        id: 'zone_1',
        type: 'zone',
        metadata: {
          pascalCapture: {
            captureId: 'capture_1',
            projectId: 'project_1',
            levelId: 'level_1',
            bundle: {
              artifacts: { totalFiles: 4 },
              reviewModes,
            },
          },
        },
      },
    })

    expect(captures).toHaveLength(1)
    expect(captures[0]?.reviewModes).toEqual(reviewModes)
    expect(captures[0]?.reviewModeLabels).toEqual([
      'Clay mesh',
      'Point cloud',
      'Pascal 3D',
      'Room',
    ])
  })

  test('preserves review modes when a capture ref is seen before full metadata', () => {
    const captures = __settingsPanelCaptureTestHooks.buildCaptureReferences({
      item_1: {
        id: 'item_1',
        type: 'item',
        metadata: {
          pascalCaptureRef: {
            captureId: 'capture_2',
            projectId: 'project_1',
          },
        },
      },
      zone_1: {
        id: 'zone_1',
        type: 'zone',
        metadata: {
          pascalCapture: {
            captureId: 'capture_2',
            projectId: 'project_1',
            bundle: {
              reviewModes: [
                { id: 'clayMesh', label: 'Clay mesh', files: [] },
                { id: 'motion', label: 'Motion', files: [] },
              ],
            },
          },
        },
      },
    })

    expect(captures).toHaveLength(1)
    expect(captures[0]?.reviewModeLabels).toEqual(['Clay mesh', 'Motion'])
    expect(captures[0]?.nodes).toHaveLength(2)
  })
})
