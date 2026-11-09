import { NodeId } from './node-id'

export const getNodeTool = {
  name: 'get_node',
  title: 'Get node',
  description:
    "Get the full data of any node by its id: its fields as stored, with what the scene decides for it beside them (a wall's or a ceiling's resolvedHeight, and heightIsExplicit, false when it follows its storey; a wall's resolvedThickness; a door's or window's resolvedOpening, its floor and what it hangs from; the displayName a level or a floor plate is shown by); its ancestorIds, its parent first (a door's wall, then the level, the building, the site); and the scene materials (scene:<id>) its finishes use. A container's node lists its children as stored; any that name no node are listed again in missingChildIds. A node its schema rejects comes back as stored, with nothing derived (verify_scene says what is wrong).",
  input: { id: NodeId.describe('The node id.') },
}

export const deleteNodeTool = {
  name: 'delete_node',
  title: 'Delete node',
  description:
    "Delete a node with everything under it, as the editor's Delete does: a wall goes with its doors and windows, a level with everything on it. The floors above a deleted level keep their index.",
  input: { id: NodeId.describe('The node id.') },
}
