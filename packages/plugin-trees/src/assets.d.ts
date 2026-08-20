// Bundled image assets. Both consumers (community + apps/editor) are Next, whose
// static image import returns a StaticImageData-shaped object; `.src` is the
// hashed, cached URL the bundler emits. Declared locally so the package needs no
// `next` type dependency. See `art.ts`.
declare module '*.webp' {
  const asset: { src: string; height: number; width: number; blurDataURL?: string }
  export default asset
}
