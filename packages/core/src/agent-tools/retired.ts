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
}
