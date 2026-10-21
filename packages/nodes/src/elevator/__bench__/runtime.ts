import {
  BlockNode,
  BuildingNode,
  ElevatorNode,
  LevelNode,
  stepElevatorRuntimes,
  useInteractive,
  useScene,
} from '@pascal-app/core'

const building = BuildingNode.parse({})
const levels = [0, 1].map((level) => LevelNode.parse({ parentId: building.id, level, height: 3 }))
const elevators = Array.from({ length: 20 }, () =>
  ElevatorNode.parse({
    parentId: building.id,
    fromLevelId: levels[0]!.id,
    toLevelId: levels[1]!.id,
  }),
)
building.children = [
  ...levels.map((level) => level.id),
  ...elevators.map((elevator) => elevator.id),
]
const values = [
  building,
  ...levels,
  ...elevators,
  ...Array.from({ length: 2000 }, () => BlockNode.parse({ parentId: levels[0]!.id })),
]
let scans = 0
const nodes = new Proxy(Object.fromEntries(values.map((node) => [node.id, node])), {
  ownKeys(target) {
    scans++
    return Reflect.ownKeys(target)
  },
})
useScene.setState({ nodes })
useInteractive.setState({ elevators: {} })
stepElevatorRuntimes(0, 1 / 60)
const warmupScans = scans
for (let frame = 1; frame <= 100; frame++) stepElevatorRuntimes((frame * 1000) / 60, 1 / 60)
console.log(
  JSON.stringify({
    nodes: values.length,
    elevators: elevators.length,
    idleFrames: 100,
    warmupSceneScans: warmupScans,
    idleSceneScans: scans - warmupScans,
  }),
)
