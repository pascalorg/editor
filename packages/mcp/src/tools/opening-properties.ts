import { DoorNode, WindowNode } from '@pascal-app/core/schema'
import { z } from 'zod'

function optionalProperties<T extends z.ZodRawShape>(shape: T) {
  // Zod's partial() retains inner defaults. A sparse property bag must not
  // reset fields the caller omitted, especially when refining a preset.
  return z.strictObject(
    Object.fromEntries(
      Object.entries(shape).map(([key, field]) => [
        key,
        z.optional(field instanceof z.ZodDefault ? field.removeDefault() : field),
      ]),
    ) as { [K in keyof T]: z.ZodOptional<T[K] extends z.ZodDefault<infer U> ? U : T[K]> },
  )
}

export const doorPropertiesSchema = optionalProperties(
  DoorNode.pick({
    doorCategory: true,
    doorType: true,
    leafCount: true,
    operationState: true,
    slideDirection: true,
    trackStyle: true,
    garagePanelCount: true,
    openingKind: true,
    openingShape: true,
    openingRadiusMode: true,
    openingTopRadii: true,
    cornerRadius: true,
    archHeight: true,
    openingRevealRadius: true,
    frameThickness: true,
    frameDepth: true,
    threshold: true,
    thresholdHeight: true,
    hingesSide: true,
    swingDirection: true,
    swingAngle: true,
    segments: true,
    handle: true,
    handleHeight: true,
    handleSide: true,
    contentPadding: true,
    doorCloser: true,
    panicBar: true,
    panicBarHeight: true,
  }).shape,
).extend({
  openingTopRadii: z
    .array(z.number())
    .length(2)
    .pipe(DoorNode.shape.openingTopRadii.removeDefault())
    .optional(),
  contentPadding: z
    .array(z.number())
    .length(2)
    .pipe(DoorNode.shape.contentPadding.removeDefault())
    .optional(),
})

export const windowPropertiesSchema = optionalProperties(
  WindowNode.pick({
    openingKind: true,
    windowType: true,
    operationState: true,
    awningDirection: true,
    casementStyle: true,
    hingesSide: true,
    openingShape: true,
    openingRadiusMode: true,
    openingCornerRadii: true,
    cornerRadius: true,
    archHeight: true,
    openingRevealRadius: true,
    frameThickness: true,
    frameDepth: true,
    columnRatios: true,
    rowRatios: true,
    columnDividerThickness: true,
    rowDividerThickness: true,
    sill: true,
    sillDepth: true,
    sillThickness: true,
  }).shape,
).extend({
  openingCornerRadii: z
    .array(z.number())
    .length(4)
    .pipe(WindowNode.shape.openingCornerRadii.removeDefault())
    .optional(),
})
