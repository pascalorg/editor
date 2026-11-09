import { expect, test } from 'bun:test'
import {
  type AssetInput,
  BlockNode,
  BuildingNode,
  createBoxBlockTopology,
  emitter,
  ItemNode,
  LevelNode,
  SiteNode,
  sceneRegistry,
  useLiveNodeOverrides,
  useScene,
} from '@pascal-app/core'
import { useDraftNode, useEditor, usePlacementCoordinator } from '@pascal-app/editor'
import { useViewer } from '@pascal-app/viewer'
import { act, create } from '@react-three/test-renderer'
import { type Mesh, Vector3 } from 'three'
import { getInitialState } from '../item/move-tool'
import { installMountedScene, LevelScene, SceneSystems, settle } from './harness'

installMountedScene()

const site = SiteNode.parse({})
const building = BuildingNode.parse({ parentId: site.id })
const level = LevelNode.parse({ parentId: building.id })

function Placement({ asset, source }: { asset: AssetInput; source?: ItemNode }) {
  const draftNode = useDraftNode()
  return usePlacementCoordinator({
    asset,
    draftNode,
    initialState: source ? getInitialState(source) : undefined,
    initDraft: (position) => {
      if (source) {
        draftNode.adopt(source)
        position.set(...source.position)
      } else if (!asset.attachTo) draftNode.create(position, asset)
    },
    onCommitted: () => false,
  })
}
function Scene({ asset, source }: { asset: AssetInput; source?: ItemNode }) {
  return (
    <>
      <LevelScene building={building} level={level} />
      <Placement asset={asset} source={source} />
      <SceneSystems />
    </>
  )
}
for (const order of ['grid first', 'host first'])
  for (const moving of [false, true])
    for (const side of [false, true])
      for (const rotation of [0, Math.PI / 6])
        test(`${moving ? 'move' : 'fresh'} ${side ? 'side' : 'top'} face stays mounted, ${rotation}, ${order}`, async () => {
          const asset: AssetInput = {
            id: 'blink-box',
            name: 'Blink box',
            category: 'decor',
            thumbnail: '',
            src: '/block-blink.glb',
            dimensions: [0.2, 0.3, 0.2],
            ...(side ? { attachTo: 'wall' as const } : {}),
          }
          const host = BlockNode.parse({
            parentId: level.id,
            topology: createBoxBlockTopology(1.5, 1.5, 1.5),
            rotation,
          })
          const faceId = side ? 'f-back' : 'f-top'
          const source = moving
            ? ItemNode.parse({
                asset,
                parentId: host.id,
                blockFaceId: faceId,
                position: [0, 0, 0],
                rotation: side ? [0, 0, 0] : [Math.PI / 2, 0, 0],
              })
            : undefined
          useScene.setState({
            nodes: {
              [site.id]: { ...site, children: [building.id] },
              [building.id]: { ...building, children: [level.id] },
              [level.id]: { ...level, children: [host.id] },
              [host.id]: { ...host, children: source ? [source.id] : [] },
              ...(source ? { [source.id]: source } : {}),
            },
            rootNodeIds: [site.id],
            dirtyNodes: new Set(),
            readOnly: false,
            materials: {},
            collections: {},
            installedPlugins: [],
          })
          useScene.temporal.getState().pause()
          useEditor.setState({
            mode: 'build',
            tool: 'item',
            viewLayouts: {},
            movingNodeOrigin: '3d',
            placementDragMode: false,
          })
          useEditor.getState().setSnappingMode('item', 'off')
          useViewer.setState({
            textures: false,
            showZones: false,
            showMeasurements: false,
            selection: {
              buildingId: building.id,
              levelId: level.id,
              zoneId: null,
              selectedIds: [],
            },
          })
          const renderer = await create(<Scene asset={asset} source={source} />)
          try {
            await settle(renderer)
            const group = sceneRegistry.nodes.get(host.id)!
            const body = () => group.children.find((o) => o.name === 'block-body') as Mesh
            const move = async (i: number, targetFace = faceId) => {
              const object = body()
              const range = object.geometry.userData.blockFaces.find(
                (r: { faceId: string }) => r.faceId === targetFace,
              )
              const localPosition: [number, number, number] =
                targetFace === 'f-right'
                  ? [0.75, 0.8, -0.2 + i * 0.02]
                  : side
                    ? [-0.2 + i * 0.02, 0.8, 0.75]
                    : [-0.2 + i * 0.02, 1.5, 0]
              const position = object.localToWorld(new Vector3(...localPosition)).toArray()
              const nativeEvent = {}
              const event = {
                node: useScene.getState().nodes[host.id],
                object,
                faceIndex: range.start / 3,
                localPosition,
                position,
                nativeEvent: { nativeEvent },
                stopPropagation() {},
              }
              const grid = () =>
                emitter.emit('grid:move', {
                  ...event,
                  position: [position[0], 0, position[2]],
                  localPosition: [position[0], 0, position[2]],
                } as never)
              const hit = () => {
                if (i === 0) {
                  if (source) emitter.emit('node:leave', { ...event, node: source } as never)
                  emitter.emit('block:enter', event as never)
                  emitter.emit('node:enter', event as never)
                }
                emitter.emit('block:move', event as never)
                emitter.emit('node:move', event as never)
              }
              await act(async () => {
                if (order === 'grid first') {
                  grid()
                  hit()
                } else {
                  hit()
                  grid()
                }
              })
              await settle(renderer)
            }
            const initialHostMesh = body().uuid
            await move(0)
            expect(body().uuid).toBe(initialHostMesh)
            const item = Object.values(useScene.getState().nodes).find(
              (n) => n.type === 'item',
            ) as ItemNode
            const mesh = sceneRegistry.nodes.get(item.id)!
            const wrapper = mesh.parent
            const geometry = body().geometry
            const hostMesh = body()
            for (let i = 1; i <= 10; i++) {
              await move(i)
              expect(body()).toBe(hostMesh)
              expect(body().geometry).toBe(geometry)
              expect(sceneRegistry.nodes.get(item.id)).toBe(mesh)
              expect(mesh.parent).toBe(wrapper)
              expect(mesh.visible).toBe(true)
              const stored = useScene.getState().nodes[item.id] as ItemNode
              expect(stored.parentId).toBe(host.id)
              expect(
                useLiveNodeOverrides.getState().get(item.id)?.blockFaceId ?? stored.blockFaceId,
              ).toBe(faceId)
              mesh.updateWorldMatrix(true, false)
              expect(mesh.getWorldPosition(new Vector3()).toArray().every(Number.isFinite)).toBe(
                true,
              )
            }
            if (side) {
              await move(11, 'f-right')
              await move(12, 'f-right')
              expect(useLiveNodeOverrides.getState().get(item.id)?.blockFaceId).toBe('f-right')
              expect(sceneRegistry.nodes.get(item.id)).toBe(mesh)
              expect(mesh.parent).toBe(wrapper)
              expect(body().uuid).toBe(initialHostMesh)
            }
          } finally {
            await renderer.unmount()
          }
        })
