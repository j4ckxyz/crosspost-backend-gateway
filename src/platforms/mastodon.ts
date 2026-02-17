import { createRestAPIClient } from "masto";

import {
  MastodonTarget,
  PostSegment,
  TargetDeliverySuccess,
} from "../types.js";
import { fetchMastodonInstanceLimits } from "../services/platform-capabilities.js";

function normalizeInstanceUrl(instanceUrl: string): string {
  return instanceUrl.replace(/\/$/, "");
}

async function uploadSegmentMedia(
  client: ReturnType<typeof createRestAPIClient>,
  segment: PostSegment,
): Promise<string[]> {
  const mediaIds: string[] = [];

  for (const item of segment.media) {
    const fileBytes = Uint8Array.from(item.buffer);
    const file = new File([fileBytes], item.fileName, {
      type: item.mimeType || "application/octet-stream",
    });

    const uploaded = await client.v2.media.create({
      file,
      description: item.altText ?? null,
      skipPolling: false,
    });

    mediaIds.push(uploaded.id);
  }

  return mediaIds;
}

export async function publishToMastodon(
  credentials: MastodonTarget,
  segments: PostSegment[],
): Promise<TargetDeliverySuccess> {
  const instanceUrl = normalizeInstanceUrl(credentials.instanceUrl);
  const client = createRestAPIClient({
    url: instanceUrl,
    accessToken: credentials.accessToken,
  });

  await fetchMastodonInstanceLimits(instanceUrl, credentials.accessToken);

  let rootStatusId: string | undefined;
  let parentStatusId: string | undefined;
  let rootStatusUrl: string | undefined;
  const statusIds: string[] = [];

  for (const segment of segments) {
    const mediaIds = await uploadSegmentMedia(client, segment);
    const posted =
      mediaIds.length > 0
        ? await client.v1.statuses.create({
            status: segment.text,
            mediaIds,
            visibility: credentials.visibility,
            inReplyToId: parentStatusId,
          })
        : await client.v1.statuses.create({
            status: segment.text,
            visibility: credentials.visibility,
            inReplyToId: parentStatusId,
          });

    if (!rootStatusId) {
      rootStatusId = posted.id;
      rootStatusUrl = posted.url ?? `${instanceUrl}/web/statuses/${posted.id}`;
    }

    parentStatusId = posted.id;
    statusIds.push(posted.id);
  }

  if (!rootStatusId) {
    throw new Error("Mastodon thread publish failed: no statuses were created");
  }

  return {
    ok: true,
    platform: "mastodon",
    id: rootStatusId,
    url: rootStatusUrl,
    raw: {
      rootStatusId,
      statusIds,
    },
  };
}
