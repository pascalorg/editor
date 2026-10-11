/**
 * A file the host keeps for the agent, named rather than inlined: a hosted server answers
 * `request_upload` with an `asset:<id>` the agent then passes as an image input, so the bytes never
 * become output tokens. Resolved to its bytes, its type and the URL a scene may point at: `keep`
 * when the scene will point at it (a plan's guide), `read` when only the call reads it (a photo
 * crop). Null when the source is not one the host names, so the input is read inline as without a
 * host; a refusal is thrown.
 */
export type SourceResolver = (
  source: string,
  use: 'keep' | 'read',
) => Promise<ResolvedSource | null>

export type ResolvedSource = { bytes: Uint8Array; mediaType: string; url: string }

/** What an inline-only input says when its host resolves uploads. */
export const UPLOAD_HINT =
  'To skip writing out a file, upload a PNG, JPEG or WebP with request_upload and pass its asset:<id>; pass an SVG inline.'
