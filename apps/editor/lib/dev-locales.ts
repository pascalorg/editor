/**
 * `en-XA` is a test locale. The require sits inside a `NODE_ENV` branch that
 * bundlers drop from production builds, so its catalog never ships.
 */
export function registerDevLocales(): void {
  if (process.env.NODE_ENV !== 'production') {
    const { registerPseudoLocale } =
      require('@pascal-app/editor/locales/pseudo') as typeof import('@pascal-app/editor/locales/pseudo')
    registerPseudoLocale()
  }
}
