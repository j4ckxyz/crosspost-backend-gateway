import { HttpProblem } from "../problem.js";
import { MastodonInstanceLimits } from "../types.js";

const MASTODON_CACHE_TTL_MS = 5 * 60 * 1000;
const mastodonLimitsCache = new Map<
  string,
  {
    expiresAt: number;
    data: MastodonInstanceLimits;
  }
>();

export const X_MAX_CHARACTERS = 280;
export const BLUESKY_MAX_CHARACTERS = 300;

function normalizeMastodonInstanceUrl(instanceUrl: string): string {
  return instanceUrl.replace(/\/$/, "");
}

function toInteger(value: unknown, fallback: number): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.floor(value);
  }

  return fallback;
}

export async function fetchMastodonInstanceLimits(
  instanceUrl: string,
  accessToken?: string,
): Promise<MastodonInstanceLimits> {
  const normalized = normalizeMastodonInstanceUrl(instanceUrl);
  const now = Date.now();

  const cacheEntry = mastodonLimitsCache.get(normalized);
  if (cacheEntry && cacheEntry.expiresAt > now) {
    return cacheEntry.data;
  }

  const headers: Record<string, string> = {
    accept: "application/json",
  };

  if (accessToken) {
    headers.authorization = `Bearer ${accessToken}`;
  }

  let response: Response;
  try {
    response = await fetch(`${normalized}/api/v2/instance`, {
      method: "GET",
      headers,
    });
  } catch (error) {
    throw new HttpProblem({
      type: "https://api.crosspost.local/problems/mastodon-instance-unreachable",
      title: "Mastodon instance unavailable",
      status: 502,
      detail:
        error instanceof Error
          ? error.message
          : `Could not reach Mastodon instance at ${normalized}`,
    });
  }

  if (!response.ok) {
    throw new HttpProblem({
      type: "https://api.crosspost.local/problems/mastodon-instance-error",
      title: "Mastodon instance error",
      status: 502,
      detail: `Instance ${normalized} returned HTTP ${response.status}`,
    });
  }

  const payload = (await response.json()) as {
    configuration?: {
      statuses?: {
        maxCharacters?: number;
        maxMediaAttachments?: number;
        charactersReservedPerUrl?: number;
      };
      mediaAttachments?: {
        supportedMimeTypes?: string[];
        imageSizeLimit?: number;
        videoSizeLimit?: number;
      };
    };
  };

  const statusConfig = payload.configuration?.statuses;
  const mediaConfig = payload.configuration?.mediaAttachments;

  if (!statusConfig) {
    throw new HttpProblem({
      type: "https://api.crosspost.local/problems/mastodon-instance-invalid",
      title: "Mastodon instance configuration missing",
      status: 502,
      detail: `Could not read posting limits from ${normalized}`,
    });
  }

  const limits: MastodonInstanceLimits = {
    instanceUrl: normalized,
    maxCharacters: toInteger(statusConfig.maxCharacters, 500),
    maxMediaAttachments: toInteger(statusConfig.maxMediaAttachments, 4),
    charactersReservedPerUrl: toInteger(statusConfig.charactersReservedPerUrl, 23),
    supportedMimeTypes: Array.isArray(mediaConfig?.supportedMimeTypes)
      ? mediaConfig!.supportedMimeTypes
      : [],
    imageSizeLimit: toInteger(mediaConfig?.imageSizeLimit, 0),
    videoSizeLimit: toInteger(mediaConfig?.videoSizeLimit, 0),
    fetchedAt: new Date().toISOString(),
  };

  mastodonLimitsCache.set(normalized, {
    expiresAt: now + MASTODON_CACHE_TTL_MS,
    data: limits,
  });

  return limits;
}

export function countCodePoints(text: string): number {
  return [...text].length;
}

export function classifyMediaType(mimeType: string): "image" | "video" | "other" {
  const normalized = mimeType.toLowerCase();

  if (normalized.startsWith("image/")) {
    return "image";
  }

  if (normalized.startsWith("video/")) {
    return "video";
  }

  return "other";
}
