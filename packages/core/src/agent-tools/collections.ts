import { z } from 'zod'
import { COLLECTION_TEMPLATE_IDS } from '../schema/collection-templates'
import { NodeId } from './node-id'

export const editCollectionTool = {
  name: 'edit_collection',
  title: 'Edit collection',
  description:
    "Create, rename, recolour or delete a collection, or add and remove its elements. A collection is a named set of any scene elements (lights, windows, doors, columns, objects built with add_object…), listed in the editor's Collections; being in one changes nothing about the elements. Without collectionId the call works on the scene's collection with that template, or else that name, and creates it when there is none.",
  input: {
    collectionId: z.string().min(1).optional().describe('The collection to change.'),
    template: z
      .enum(COLLECTION_TEMPLATE_IDS)
      .optional()
      .describe('Start from a template, which gives the name and colour unless you pass them.'),
    name: z.string().trim().min(1).optional().describe('Name of the collection, or its new name.'),
    color: z.string().optional().describe('Colour, e.g. #f5b83d.'),
    add: z.array(NodeId).optional().describe('Ids of the elements to add.'),
    remove: z.array(NodeId).optional().describe('Ids of the elements to take out.'),
    delete: z
      .boolean()
      .optional()
      .describe('Delete the collection; its elements stay in the scene.'),
  },
}

export const listCollectionsTool = {
  name: 'list_collections',
  title: 'List collections',
  description:
    "List the scene's collections with their elements (id, name, type, level), and the templates a collection can start from.",
  input: {
    collectionId: z.string().min(1).optional().describe('Only this collection.'),
  },
}
