import react from '@vitejs/plugin-react'
import { defineConfig, loadEnv, type Plugin } from 'vite'

/**
 * The Content-Security-Policy for the production build, written into index.html.
 * It allows only this site, the Pascal API and the storage host the signed
 * 3D-file URLs point at. Extend it here when you add a third-party script, font
 * or analytics host.
 *
 * What the 3D file decoders need:
 * - 'wasm-unsafe-eval': the meshopt decoder and the Basis (KTX2) transcoder are WebAssembly.
 * - 'unsafe-eval': three's Basis transcoder is Emscripten output whose embind
 *   bindings build functions at runtime (`new Function`) inside the KTX2 worker.
 *   A blob worker inherits this page's policy, so without it every KTX2 texture
 *   fails and the model never finishes loading. Drop it only if you serve a
 *   transcoder built with -sDYNAMIC_EXECUTION=0.
 * - worker-src blob: the KTX2Loader runs its transcoder in blob-URL workers.
 */
function contentSecurityPolicy(env: Record<string, string>): Plugin {
  const apiOrigin = new URL(env.VITE_PASCAL_BASE_URL || 'https://editor.pascal.app').origin
  const assetOrigins = (env.VITE_PASCAL_ASSET_ORIGINS || 'https://*.supabase.co')
    .split(/[\s,]+/)
    .filter(Boolean)
  const policy = [
    "default-src 'self'",
    "script-src 'self' 'wasm-unsafe-eval' 'unsafe-eval'",
    "worker-src 'self' blob:",
    `connect-src 'self' ${[apiOrigin, ...assetOrigins].join(' ')}`,
    `img-src 'self' data: blob: https: ${assetOrigins.join(' ')}`,
    "style-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
  ].join('; ')
  return {
    name: 'content-security-policy',
    apply: 'build',
    transformIndexHtml: () => [
      {
        tag: 'meta',
        attrs: { 'http-equiv': 'Content-Security-Policy', content: policy },
        injectTo: 'head-prepend',
      },
    ],
  }
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), 'VITE_')
  return {
    plugins: [react(), contentSecurityPolicy(env)],
    build: { target: 'es2022', chunkSizeWarningLimit: 1500 },
  }
})
