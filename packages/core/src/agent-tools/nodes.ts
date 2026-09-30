import { NodeId } from './node-id'

export const getNodeTool = {
  name: 'get_node',
  title: 'Get node',
  description: 'Get the full data of any node by its id.',
  input: { id: NodeId.describe('The node id.') },
}

export const deleteNodeTool = {
  name: 'delete_node',
  title: 'Delete node',
  description:
    "Delete a node with everything under it, as the editor's Delete does: a wall goes with its doors and windows, a level with everything on it. The floors above a deleted level keep their index.",
  input: { id: NodeId.describe('The node id.') },
}
