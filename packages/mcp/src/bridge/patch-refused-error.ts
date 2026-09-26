/**
 * A patch op the bridge refuses because it would break node identity:
 * `node_exists` for a create whose id is already in the scene (a silent
 * replace orphans the old node's children), `identity_change` for an update
 * that rewrites `id` or `type`. The message starts with the code so MCP
 * clients, which only see the message, can branch on it.
 */
export class PatchRefusedError extends Error {
  constructor(
    readonly code: 'node_exists' | 'identity_change',
    readonly patchIndex: number,
    readonly nodeId: string,
    detail: string,
  ) {
    super(`${code}: patches[${patchIndex}] ${detail}`)
    this.name = 'PatchRefusedError'
  }
}
