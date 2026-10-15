import { describe, expect, test } from 'bun:test'
import { BoxGeometry, Group, Mesh, MeshBasicMaterial, Raycaster, Scene, Vector3 } from 'three'
import { collectElevatorButtons } from './elevator-interaction-system'

describe('elevator buttons', () => {
  test('a click raycasts only the buttons, past a mesh whose groups have no material', () => {
    const scene = new Scene()
    // A wall caught mid paint preview in front of the button: three throws on any raycast of it.
    const torn = new Mesh(new BoxGeometry(2, 2, 0.2), [new MeshBasicMaterial()])
    torn.geometry.clearGroups()
    torn.geometry.addGroup(0, Number.POSITIVE_INFINITY, 4)
    torn.position.z = 1
    const panel = new Group()
    const button = new Mesh(new BoxGeometry(0.1, 0.1, 0.05), new MeshBasicMaterial())
    panel.userData.elevatorButton = { action: 'open-door', disabled: false, elevatorId: 'e' }
    panel.add(button)
    scene.add(torn, new Group().add(panel))
    scene.updateMatrixWorld(true)

    const buttons = collectElevatorButtons(scene)
    expect(buttons).toEqual([panel])
    const raycaster = new Raycaster(new Vector3(0, 0, 5), new Vector3(0, 0, -1))
    expect(() => raycaster.intersectObjects(scene.children, true)).toThrow()
    expect(raycaster.intersectObjects(buttons, true).map((hit) => hit.object)).toContain(button)
  })
})
