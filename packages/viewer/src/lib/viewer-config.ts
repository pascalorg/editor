export type ViewerConfig = {
  assetsBaseUrl?: string
  storageUrl?: string
  decoders?: {
    dracoPath?: string
    basisPath?: string
  }
}

export const ASSETS_CDN_URL = 'https://editor.pascal.app'

let config: ViewerConfig = {}

/** Configure the page's viewer runtime before hydrating or loading assets. */
export function configureViewer(options: ViewerConfig): void {
  config = { ...options, decoders: { ...options.decoders } }
}

/** Resolve at use time so browser hosts need neither Next nor a process polyfill. */
export function getViewerConfig() {
  return {
    assetsBaseUrl:
      config.assetsBaseUrl ??
      ((typeof process !== 'undefined' ? process.env.NEXT_PUBLIC_ASSETS_CDN_URL : undefined) ||
        ASSETS_CDN_URL),
    storageUrl:
      config.storageUrl ??
      (typeof process !== 'undefined' ? process.env.NEXT_PUBLIC_SUPABASE_URL : undefined),
    decoders: {
      dracoPath:
        config.decoders?.dracoPath ?? 'https://www.gstatic.com/draco/versioned/decoders/1.5.5/',
      basisPath:
        config.decoders?.basisPath ??
        'https://cdn.jsdelivr.net/npm/three@0.187.0/examples/jsm/libs/basis/',
    },
  }
}
