import { AnyNode } from '@pascal-app/core/schema'

type PatchRecord = Record<string, unknown>

export type FactoryScenePatchSafetyIssue = {
  code: string
  index: number
  message: string
  severity: 'error' | 'warning'
}

export type FactoryScenePatchSafetyContext = {
  allowProcessLineCatalogItems?: boolean
  existingNodeIds?: Iterable<string>
  fallbackParentId?: string | null
}

export type FactoryScenePatchSafetyResult = {
  createCount: number
  deleteCount: number
  issues: FactoryScenePatchSafetyIssue[]
  safe: boolean
  updateCount: number
}

const FORBIDDEN_UPDATE_FIELDS = new Set(['children', 'id', 'object', 'parentId', 'type'])

function isRecord(value: unknown): value is PatchRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function nodeMetadata(node: PatchRecord) {
  return isRecord(node.metadata) ? node.metadata : {}
}

function resolvedParentId(patch: PatchRecord, node: PatchRecord, fallbackParentId?: string | null) {
  if (typeof patch.parentId === 'string' && patch.parentId) return patch.parentId
  if (typeof node.parentId === 'string' && node.parentId) return node.parentId
  return fallbackParentId || undefined
}

function issue(
  issues: FactoryScenePatchSafetyIssue[],
  index: number,
  code: string,
  message: string,
  severity: FactoryScenePatchSafetyIssue['severity'] = 'error',
) {
  issues.push({ code, index, message, severity })
}

export function validateFactoryScenePatches(
  patches: unknown[],
  context: FactoryScenePatchSafetyContext = {},
): FactoryScenePatchSafetyResult {
  const issues: FactoryScenePatchSafetyIssue[] = []
  const knownIds = new Set(context.existingNodeIds ?? [])
  const createdIds = new Set<string>()
  let createCount = 0
  let deleteCount = 0
  let updateCount = 0

  patches.forEach((patch, index) => {
    if (!isRecord(patch)) {
      issue(issues, index, 'patch_not_object', 'Factory scene patch must be an object.')
      return
    }

    if (patch.op === 'create') {
      createCount += 1
      if (!isRecord(patch.node)) {
        issue(issues, index, 'create_missing_node', 'Create patch must include a node object.')
        return
      }

      const node = patch.node
      const parsed = AnyNode.safeParse(node)
      if (!parsed.success) {
        issue(issues, index, 'create_invalid_node', 'Create patch node failed schema validation.')
        return
      }

      const nodeId = parsed.data.id
      if (knownIds.has(nodeId) || createdIds.has(nodeId)) {
        issue(
          issues,
          index,
          'create_duplicate_id',
          `Create patch node id already exists: ${nodeId}.`,
        )
      }

      const metadata = nodeMetadata(node)
      if (
        parsed.data.type === 'item' &&
        typeof metadata.processId === 'string' &&
        context.allowProcessLineCatalogItems !== true
      ) {
        issue(
          issues,
          index,
          'process_line_catalog_item',
          'Automatic process-line patches must use native/primitive nodes instead of catalog GLB items.',
        )
      }
      if (
        parsed.data.type === 'item' &&
        typeof metadata.processId === 'string' &&
        context.allowProcessLineCatalogItems === true &&
        metadata.processCatalogQualified !== true
      ) {
        issue(
          issues,
          index,
          'process_line_unqualified_catalog_item',
          'Automatic process-line catalog items must be explicitly qualified by the process equipment resolver.',
        )
      }

      const parentId = resolvedParentId(patch, node, context.fallbackParentId)
      if (parentId && !knownIds.has(parentId) && !createdIds.has(parentId)) {
        issue(
          issues,
          index,
          'create_missing_parent',
          `Create patch parent does not exist in the scene or earlier patch batch: ${parentId}.`,
        )
      }

      createdIds.add(nodeId)
      return
    }

    if (patch.op === 'update') {
      updateCount += 1
      if (typeof patch.id !== 'string' || !patch.id) {
        issue(issues, index, 'update_missing_id', 'Update patch must include a target id.')
        return
      }
      if (context.existingNodeIds && !knownIds.has(patch.id)) {
        issue(issues, index, 'update_missing_target', `Update target does not exist: ${patch.id}.`)
      }
      if (!isRecord(patch.data) || Object.keys(patch.data).length === 0) {
        issue(issues, index, 'update_empty_data', 'Update patch must include non-empty data.')
        return
      }

      for (const field of Object.keys(patch.data)) {
        if (FORBIDDEN_UPDATE_FIELDS.has(field)) {
          issue(
            issues,
            index,
            'update_forbidden_field',
            `Update patch cannot change structural field "${field}".`,
          )
        }
      }
      return
    }

    if (patch.op === 'delete') {
      deleteCount += 1
      if (typeof patch.id !== 'string' || !patch.id) {
        issue(issues, index, 'delete_missing_id', 'Delete patch must include a target id.')
        return
      }
      if (context.existingNodeIds && !knownIds.has(patch.id)) {
        issue(issues, index, 'delete_missing_target', `Delete target does not exist: ${patch.id}.`)
      }
      return
    }

    issue(
      issues,
      index,
      'unknown_op',
      'Factory scene patch op must be "create", "update", or "delete".',
    )
  })

  return {
    createCount,
    deleteCount,
    issues,
    safe: !issues.some((item) => item.severity === 'error'),
    updateCount,
  }
}
