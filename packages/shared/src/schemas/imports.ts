import { z } from "zod";

export const IMPORTABLE_EXTENSIONS = ["fit", "gpx", "tcx"] as const;

export const importPreviewSchema = z.object({
  teamId: z.string().uuid().optional(),
  visibility: z.enum(["PRIVATE", "TEAM"]).default("TEAM"),
  title: z.string().min(1).max(120).optional(),
});
export type ImportPreviewInput = z.infer<typeof importPreviewSchema>;
