import type { ProfileId } from "../config/schema";

/**
 * Adds the required profile query parameter without exposing a caller-provided
 * profile ID or target URL to query-string parsing.
 */
export function profileApiUrl(path: string, profileId: ProfileId, params?: URLSearchParams): string {
  const queryIndex = path.indexOf("?");
  const basePath = queryIndex < 0 ? path : path.slice(0, queryIndex);
  const existingQuery = queryIndex < 0 ? "" : path.slice(queryIndex + 1);
  const query = new URLSearchParams();
  query.set("profile", profileId);

  for (const [key, value] of new URLSearchParams(existingQuery)) {
    if (key !== "profile") query.append(key, value);
  }
  if (params !== undefined) {
    for (const [key, value] of params) {
      if (key !== "profile") query.append(key, value);
    }
  }

  const serialized = query.toString();
  return serialized.length === 0 ? basePath : `${basePath}?${serialized}`;
}
