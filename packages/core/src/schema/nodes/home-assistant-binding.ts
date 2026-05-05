import { z } from 'zod'
import { BaseNode, nodeType, objectId } from '../base'
import type { CollectionId } from '../collections'

export const HomeAssistantBindingNode = BaseNode.extend({
  id: objectId('ha-binding'),
  type: nodeType('home-assistant-binding'),
  collectionId: z.custom<CollectionId>(),
  resources: z.array(z.unknown()).default([]),
}).passthrough()

export type HomeAssistantBindingNode = z.infer<typeof HomeAssistantBindingNode>
export type HomeAssistantBindingNodeId = HomeAssistantBindingNode['id']
