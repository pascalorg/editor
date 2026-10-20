import { describe, expect, test } from 'bun:test'
import { BoxGeometry, Group, Mesh, MeshBasicMaterial, Raycaster, Scene, Vector3 } from 'three'
import { collectElevatorButtons, pickElevatorButton } from './elevator-interaction-system'

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

test('buttons behind opaque walls or hidden elevator groups cannot be clicked', () => {
  const scene = new Scene()
  const panel = new Group()
  panel.userData.elevatorButton = {
    action: 'open-door',
    disabled: false,
    elevatorId: 'e',
    kind: 'cab',
  }
  panel.add(new Mesh(new BoxGeometry(1, 1, 0.1), new MeshBasicMaterial()))
  const wall = new Mesh(new BoxGeometry(2, 2, 0.1), new MeshBasicMaterial())
  wall.position.z = 1
  scene.add(panel, wall)
  scene.updateMatrixWorld(true)
  const ray = new Raycaster(new Vector3(0, 0, 5), new Vector3(0, 0, -1))
  expect(pickElevatorButton(scene, ray)).toBeNull()
  wall.visible = false
  expect(pickElevatorButton(scene, ray)?.elevatorId).toBe('e')
  panel.visible = false
  expect(pickElevatorButton(scene, ray)).toBeNull()
  panel.visible = true
  wall.visible = true
  wall.material = [new MeshBasicMaterial()]
  wall.geometry.clearGroups()
  wall.geometry.addGroup(0, Number.POSITIVE_INFINITY, 4)
  expect(() => pickElevatorButton(scene, ray)).not.toThrow()
  expect(pickElevatorButton(scene, ray)?.elevatorId).toBe('e')
})
