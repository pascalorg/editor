import {
  type AnyNode,
  type AnyNodeId,
  COLLECTION_TEMPLATES,
  type Collection,
  type CollectionId,
  type CollectionTemplateId,
  generateCollectionId,
} from '@pascal-app/core'
import * as WebIFC from 'web-ifc'

export function importCollections(
  api: WebIFC.IfcAPI,
  modelID: number,
  nodes: Record<string, AnyNode>,
  nodeIds: ReadonlyMap<number, string>,
): Record<CollectionId, Collection> {
  const groups = api.GetLineIDsWithType(modelID, WebIFC.IFCGROUP, true)
  if (groups.size() === 0) return {}
  const properties = new Map<number, Record<string, unknown>>()
  const definitions = api.GetLineIDsWithType(modelID, WebIFC.IFCRELDEFINESBYPROPERTIES)
  for (let i = 0; i < definitions.size(); i++) {
    const rel = api.GetLine(modelID, definitions.get(i))
    if (!rel.RelatingPropertyDefinition?.value) continue
    const definition = api.GetLine(modelID, rel.RelatingPropertyDefinition.value)
    if (definition?.Name?.value !== 'PascalCollection') continue
    const values: Record<string, unknown> = {}
    for (const ref of definition.HasProperties ?? []) {
      const property = api.GetLine(modelID, ref.value)
      if (property?.Name?.value) values[property.Name.value] = property.NominalValue?.value
    }
    for (const ref of rel.RelatedObjects ?? []) properties.set(ref.value, values)
  }

  const members = new Map<number, Set<AnyNodeId>>()
  const assignments = api.GetLineIDsWithType(modelID, WebIFC.IFCRELASSIGNSTOGROUP, true)
  for (let i = 0; i < assignments.size(); i++) {
    const rel = api.GetLine(modelID, assignments.get(i))
    const groupId = rel.RelatingGroup?.value
    if (!groupId) continue
    const ids = members.get(groupId) ?? new Set<AnyNodeId>()
    for (const ref of rel.RelatedObjects ?? []) {
      const id = nodeIds.get(ref.value)
      if (id && nodes[id]) ids.add(id as AnyNodeId)
    }
    members.set(groupId, ids)
  }

  const collections: Record<CollectionId, Collection> = {}
  for (let i = 0; i < groups.size(); i++) {
    const expressId = groups.get(i)
    const ids = members.get(expressId)
    if (!ids?.size) continue
    const group = api.GetLine(modelID, expressId)
    const values = properties.get(expressId)
    const storedId = values?.CollectionId
    const id =
      typeof storedId === 'string' &&
      storedId.startsWith('collection_') &&
      !Object.hasOwn(collections, storedId)
        ? (storedId as CollectionId)
        : generateCollectionId()
    const template = values?.Template
    collections[id] = {
      id,
      name: (typeof group.Name?.value === 'string' && group.Name.value.trim()) || 'IFC group',
      nodeIds: [...ids],
      ...(typeof template === 'string' && Object.hasOwn(COLLECTION_TEMPLATES, template)
        ? { template: template as CollectionTemplateId }
        : {}),
      ...(typeof values?.Color === 'string' ? { color: values.Color } : {}),
    }
  }
  return collections
}
