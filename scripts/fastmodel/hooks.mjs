// Resolves web/src's extensionless relative imports ('./grid') to their .ts files, as Vite does.
export async function resolve(specifier, context, next) {
  if (/^\.\.?\//.test(specifier) && !/\.\w+$/.test(specifier)) {
    try {
      return await next(`${specifier}.ts`, context)
    } catch {}
  }
  return next(specifier, context)
}
