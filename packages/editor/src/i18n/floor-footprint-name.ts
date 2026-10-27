import {
  type AnyNode,
  floorFootprintNaming,
  type PascalI18n,
  type SlabNode,
} from '@pascal-app/core'

/** `floorFootprintName` in the UI language; MCP and agents keep core's English. */
export function localizedFloorFootprintName(
  nodes: Readonly<Record<string, AnyNode>>,
  plate: SlabNode,
  i18n: PascalI18n,
): string {
  const naming = floorFootprintNaming(nodes, plate)
  switch (naming.kind) {
    case 'named':
      return naming.name
    case 'room':
      return i18n._({
        id: 'editor.floorFootprint.room',
        message: '{room} floor',
        values: { room: naming.room },
      })
    case 'shared':
      return i18n._({ id: 'editor.floorFootprint.shared', message: 'Shared floor' })
    case 'area':
      return i18n._({ id: 'editor.floorFootprint.area', message: 'Floor area' })
  }
}
