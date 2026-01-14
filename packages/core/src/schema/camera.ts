import { z } from "zod";

const Vector3Schema = z.tuple([z.number(), z.number(), z.number()]);

export const CameraSchema = z.object({
  position: Vector3Schema,
  target: Vector3Schema,
  mode: z.enum(["perspective", "orthographic"]).default("perspective"),
  fov: z.number().optional(), // For perspective
  zoom: z.number().optional(), // For orthographic
});

export type Camera = z.infer<typeof CameraSchema>;
