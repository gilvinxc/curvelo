import type { ActivityDTO, ImportedActivitySummary } from "@curvelo/shared";
import { ApiError, BASE_URL } from "../../lib/api";

export interface ImportOptions {
  title?: string;
  visibility?: "PRIVATE" | "TEAM";
  teamId?: string;
  taggedUserIds?: string[];
}

type ImportEndpoint = "/activities/import/preview" | "/activities/import/confirm";

interface ErrorBody {
  error?: { code?: string; message?: string; details?: unknown };
}

/**
 * Multipart import request. The browser sets the Content-Type (with the
 * multipart boundary) itself, so we never set it manually here.
 */
async function importRequest<T>(
  endpoint: ImportEndpoint,
  file: File,
  options: ImportOptions,
): Promise<T> {
  const form = new FormData();
  form.append("file", file, file.name);
  if (options.title?.trim()) form.set("title", options.title.trim());
  if (options.visibility) form.set("visibility", options.visibility);
  if (options.teamId) form.set("teamId", options.teamId);

  let res: Response;
  try {
    res = await fetch(`${BASE_URL}${endpoint}`, {
      method: "POST",
      credentials: "include",
      body: form,
    });
  } catch {
    throw new ApiError(
      "Couldn't reach the Stride Sense API. Make sure it's running on port 4000.",
      "NETWORK_ERROR",
      0,
    );
  }

  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    // non-JSON body — handled below via status
  }

  if (!res.ok) {
    const err = (body as ErrorBody | null)?.error;
    throw new ApiError(
      err?.message ?? `Request failed (${res.status})`,
      err?.code ?? "UNKNOWN",
      res.status,
      err?.details,
    );
  }
  return body as T;
}

/** Parse a workout file without creating an activity. */
export function previewImport(file: File, options: ImportOptions = {}) {
  return importRequest<{ summary: ImportedActivitySummary }>(
    "/activities/import/preview",
    file,
    options,
  );
}

/** Parse and save a workout file as a new activity. */
export function confirmImport(file: File, options: ImportOptions = {}) {
  return importRequest<{ activity: ActivityDTO; summary: ImportedActivitySummary }>(
    "/activities/import/confirm",
    file,
    options,
  );
}
