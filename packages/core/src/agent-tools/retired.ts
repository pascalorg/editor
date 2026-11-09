/**
 * MCP tools retired into another tool. A retired name is listed by no server and still answered at
 * `tools/call`, wherever an older client or a saved script can send it: `tool_retired`, with the
 * tool that replaced it and how to do the same with that one. A host keeps its own surfaces'
 * retired tools beside these, answered the same way (Pascal's hosted catalogue reads this map).
 */

export type RetiredTool = {
  /** The tool that does what this one did. */
  replacement: string
  /** How to do with the replacement what this tool was called for, said to the model. */
  how: string
}

/** What a call to a retired name gets back: a refusal, as every surface gives one. */
export type RetiredToolAnswer = { code: 'tool_retired'; error: string; replacement: string }

export function retiredToolRefusal(
  name: string,
  { replacement, how }: RetiredTool,
): RetiredToolAnswer {
  return {
    code: 'tool_retired',
    error: `${name} is retired, use ${replacement}: ${how}`,
    replacement,
  }
}

export const RETIRED_MCP_TOOLS: Readonly<Record<string, RetiredTool>> = {
  // The schema check, into the one scene check.
  validate_scene: {
    replacement: 'verify_scene',
    how: "its valid is validate_scene's valid; each field a node's schema rejects is an issue of type schema_invalid with its nodeId, path and message, every one as validate_scene listed them; nodes of a kind no schema here knows (a plugin's), each an error there, are one issue schema_unknown_kind (severity info) per kind, with its count and a few nodeIds; a hidden site, validate_scene's warning, is the issue site_hidden (severity info).",
  },
  // The node finder and the node read, into the shared ones (slice Q).
  find_nodes: {
    replacement: 'find_by_type',
    how: "it takes the same filters: type (any node kind, a plugin's too; it also finds item categories, lights and typed parts), levelId, parentId, zoneId, sourceId and sourceIdPrefix; without a type, every node they match. Each result gives the node's id, name, nodeType, levelId and parentId, with its metadata and provenance when it has them (one over 1 KB is named in omitted); get_node reads a node whole. A level, parent or zone that is not there is refused, where find_nodes found nothing; a type that names nothing is refused as before (unknown_type), with the kinds the scene holds. Past its limit, results are counted, not listed: truncated says so.",
  },
  describe_node: {
    replacement: 'get_node',
    how: "its node is describe_node's properties: the fields as stored, with a wall's resolvedHeight and heightIsExplicit (a ceiling's too), a level's or floor plate's displayName; its ancestorIds are describe_node's ancestryIds, parent first; a container's node lists its children as stored, and missingChildIds the ones that name no node (describe_node's childrenIds left them out). Its description's numbers are the node's own fields.",
  },
}
