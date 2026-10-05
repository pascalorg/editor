import { describe, expect, test } from 'bun:test'
import { type AnyNode, sceneRegistry } from '@pascal-app/core'
import * as THREE from 'three'
import { collectIfcMeshes, exportPreparedSceneToIfc, ifcFileName } from './ifc-export'

const node = (id: string, type: string, parentId: string | null = null) =>
  ({
    object: 'node',
    id,
    type,
    parentId,
    visible: true,
    metadata: {},
    children: [],
  }) as unknown as AnyNode

function identity(object: THREE.Object3D, id: string) {
  object.userData = { pascalId: id }
  return object
}

describe('collectIfcMeshes', () => {
  const nodes: Record<string, AnyNode> = {
    level_a: node('level_a', 'level'),
    wall_a: { ...node('wall_a', 'wall', 'level_a'), start: [0, 0], end: [1, 0] } as AnyNode,
    item_a: node('item_a', 'item', 'level_a'),
  }

  function scene() {
    const root = new THREE.Group()
    const level = identity(new THREE.Group(), 'level_a')
    level.position.y = 3
    root.add(level)

    const wall = identity(
      new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial()),
      'wall_a',
    )
    level.add(wall)

    const item = identity(new THREE.Group(), 'item_a')
    item.position.set(2, 0, 0)
    level.add(item)
    const geometry = new THREE.BoxGeometry(1, 1, 1)
    // BoxGeometry has six material groups (one per face).
    const red = new THREE.MeshStandardMaterial({ color: new THREE.Color('#ff0000') })
    const glass = new THREE.MeshStandardMaterial({ transparent: true, opacity: 0.25 })
    const materials = [red, red, red, red, glass, glass]
    const child = new THREE.Mesh(geometry, materials)
    item.add(child)
    const hidden = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial())
    hidden.visible = false
    item.add(hidden)
    return root
  }

  test('bakes world transforms per owning node and skips parametric kinds', () => {
    const { meshes: parts, renderedNodeIds } = collectIfcMeshes(scene(), nodes)
    expect([...parts.keys()]).toEqual(['item_a'])
    expect([...renderedNodeIds].sort()).toEqual(['item_a', 'wall_a'])
    const itemParts = parts.get('item_a')!
    expect(itemParts).toHaveLength(6)
    const xs: number[] = []
    const ys: number[] = []
    for (const part of itemParts) {
      expect(part.indices!.length % 3).toBe(0)
      expect(part.positions.length).toBe(4 * 3)
      for (let i = 0; i < part.positions.length; i += 3) {
        xs.push(part.positions[i]!)
        ys.push(part.positions[i + 1]!)
      }
    }
    expect(Math.min(...xs)).toBeCloseTo(1.5)
    expect(Math.max(...xs)).toBeCloseTo(2.5)
    expect(Math.min(...ys)).toBeCloseTo(2.5)
    expect(Math.max(...ys)).toBeCloseTo(3.5)
    const [r, g, b] = itemParts[0]!.color!
    expect([r, g, b].map((channel) => Math.round(channel * 1000) / 1000)).toEqual([1, 0, 0])
    expect(itemParts[5]!.opacity).toBe(0.25)
  })

  test('feeds the IFC writer', () => {
    const { data, warnings } = exportPreparedSceneToIfc(scene(), nodes, { projectName: 'Demo' })
    expect(data).toContain("FILE_SCHEMA(('IFC4'));")
    expect(data).toContain('IFCFURNISHINGELEMENT(')
    expect(data).toContain('IFCTRIANGULATEDFACESET(')
    expect(warnings).toEqual([])
  })
})

describe('export warnings', () => {
  test('flag nodes drawn in the editor that reached the file without geometry', () => {
    const nodes: Record<string, AnyNode> = {
      level_a: node('level_a', 'level'),
      item_ghost: node('item_ghost', 'item', 'level_a'),
      marker_a: node('marker_a', 'item', 'level_a'),
    }
    // Live editor objects: the item draws on the scene layer; the marker only
    // on an overlay layer, like the spawn point.
    const drawn = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial())
    const overlay = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial())
    overlay.layers.set(5)
    sceneRegistry.nodes.set('item_ghost', drawn)
    sceneRegistry.nodes.set('marker_a', overlay)
    try {
      const { warnings } = exportPreparedSceneToIfc(new THREE.Group(), nodes, {})
      expect(warnings).toEqual([
        '1 object has no exportable geometry and was left out of the IFC file.',
      ])
    } finally {
      sceneRegistry.nodes.delete('item_ghost')
      sceneRegistry.nodes.delete('marker_a')
    }
  })
})

describe('visibility default', () => {
  test('a hidden wall is left out when no option is given, as scene preparation does', () => {
    const nodes: Record<string, AnyNode> = {
      level_a: node('level_a', 'level'),
      wall_hidden: {
        ...node('wall_hidden', 'wall', 'level_a'),
        visible: false,
        start: [0, 0],
        end: [3, 0],
      } as AnyNode,
    }
    expect(exportPreparedSceneToIfc(new THREE.Group(), nodes, {}).data).not.toContain('IFCWALL(')
    expect(
      exportPreparedSceneToIfc(new THREE.Group(), nodes, { onlyVisible: false }).data,
    ).toContain('IFCWALL(')
  })
})

describe('ifcFileName', () => {
  test('uses a filesystem-safe project name', () => {
    expect(ifcFileName('House: v2/final', 'model')).toBe('House- v2-final.ifc')
    expect(ifcFileName('  ', 'model_2026-09-30')).toBe('model_2026-09-30.ifc')
    expect(ifcFileName(undefined, 'model')).toBe('model.ifc')
  })
})
