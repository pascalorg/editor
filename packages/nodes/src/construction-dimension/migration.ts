export function migrateConstructionDimensionV6ToV7(value: unknown): unknown {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value
  const {
    reference: _reference,
    referenceStyle: _referenceStyle,
    ...dimension
  } = value as Record<string, unknown>
  const drawingOverrides = Array.isArray(dimension.drawingOverrides)
    ? dimension.drawingOverrides.map((entry) => {
        if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return entry
        const override = entry as Record<string, unknown>
        return override.presentation === 'reference'
          ? { ...override, presentation: 'shown' }
          : override
      })
    : dimension.drawingOverrides
  return { ...dimension, drawingOverrides }
}
