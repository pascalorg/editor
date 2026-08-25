/**
 * Validation for the `src` parameter of the `/import` page: the URL a
 * scanning app (or any external tool) hands us to import a build JSON
 * from. The fetch itself happens client-side in the visitor's browser —
 * same trust model as dropping a file on Load Build — so the checks here
 * are about not being tricked into requesting something that is not a
 * plain https resource, not about SSRF (no server ever fetches it).
 */

/** Hard cap on the fetched document; matches generous hand-made scenes. */
export const MAX_IMPORT_BYTES = 25 * 1024 * 1024

export type ImportSrcResult = { ok: true; url: URL } | { ok: false; reason: string }

/**
 * Accepts only absolute `https:` URLs without embedded credentials.
 * `http:` is allowed for localhost only, so a scan app on the same
 * machine can hand over a file during development.
 */
export function parseImportSrc(raw: string | null | undefined): ImportSrcResult {
  if (!raw) {
    return { ok: false, reason: 'Missing `src` parameter.' }
  }
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    return { ok: false, reason: 'The `src` parameter is not an absolute URL.' }
  }
  if (url.username || url.password) {
    return { ok: false, reason: 'Credentials in the `src` URL are not allowed.' }
  }
  const isLocalhost =
    url.hostname === 'localhost' || url.hostname === '127.0.0.1' || url.hostname === '[::1]'
  if (url.protocol === 'https:' || (url.protocol === 'http:' && isLocalhost)) {
    return { ok: true, url }
  }
  return { ok: false, reason: 'Only https URLs can be imported.' }
}
