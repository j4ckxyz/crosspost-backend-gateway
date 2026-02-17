import Emusks from "emusks";

import { PostSegment, TargetDeliverySuccess, XTarget } from "../types.js";

async function uploadSegmentMedia(
  client: Emusks,
  segment: PostSegment,
): Promise<string[]> {
  const mediaIds: string[] = [];

  for (const item of segment.media) {
    const uploaded = await client.media.create(item.buffer, {
      alt_text: item.altText,
      mediaType: item.mimeType,
      type: "tweet",
    });

    const mediaId = uploaded.media_id ?? uploaded.media_id_string;
    if (!mediaId) {
      throw new Error("X upload succeeded but no media_id was returned");
    }

    mediaIds.push(mediaId);
  }

  return mediaIds;
}

export async function publishToX(
  credentials: XTarget,
  segments: PostSegment[],
): Promise<TargetDeliverySuccess> {
  const client = new Emusks();

  await client.login({
    auth_token: credentials.authToken,
    client: credentials.client,
  });

  let previousTweetId: string | undefined;
  let rootTweetId: string | undefined;
  let rootUsername: string | undefined;
  const postedIds: string[] = [];

  for (const segment of segments) {
    const mediaIds = await uploadSegmentMedia(client, segment);
    const posted = await client.tweets.create(segment.text, {
      mediaIds,
      replyTo: previousTweetId,
    });

    const tweetId = posted.id;
    if (!tweetId) {
      throw new Error("X post succeeded but no tweet id was returned");
    }

    if (!rootTweetId) {
      rootTweetId = tweetId;
      rootUsername = posted.user?.username ?? client.user?.username;
    }

    postedIds.push(tweetId);
    previousTweetId = tweetId;
  }

  if (!rootTweetId) {
    throw new Error("X thread publish failed: no posts were created");
  }

  const url = rootUsername
    ? `https://x.com/${encodeURIComponent(rootUsername)}/status/${rootTweetId}`
    : `https://x.com/i/status/${rootTweetId}`;

  return {
    ok: true,
    platform: "x",
    id: rootTweetId,
    url,
    raw: {
      rootTweetId,
      tweetIds: postedIds,
    },
  };
}
