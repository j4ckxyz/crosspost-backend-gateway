import { AtpAgent } from "@atproto/api";

import {
  BlueskyTarget,
  PostSegment,
  TargetDeliverySuccess,
} from "../types.js";
import { classifyMediaType } from "../services/platform-capabilities.js";

interface BlueskyPostRef {
  uri: string;
  cid: string;
}

function buildBlueskyUrl(did: string | undefined, uri: string): string | undefined {
  if (!did) {
    return undefined;
  }

  const rkey = uri.split("/").at(-1);
  if (!rkey) {
    return undefined;
  }

  return `https://bsky.app/profile/${encodeURIComponent(did)}/post/${encodeURIComponent(
    rkey,
  )}`;
}

async function buildSegmentEmbed(
  agent: AtpAgent,
  segment: PostSegment,
): Promise<
  | {
      $type: "app.bsky.embed.images";
      images: Array<{ image: unknown; alt: string }>;
    }
  | {
      $type: "app.bsky.embed.video";
      video: unknown;
      alt?: string;
    }
  | undefined
> {
  if (segment.media.length === 0) {
    return undefined;
  }

  const images = segment.media.filter((item) => classifyMediaType(item.mimeType) === "image");
  const videos = segment.media.filter((item) => classifyMediaType(item.mimeType) === "video");

  if (images.length > 0) {
    const uploaded = await Promise.all(
      images.map((item) =>
        agent.uploadBlob(item.buffer, {
          encoding: item.mimeType || "application/octet-stream",
        }),
      ),
    );

    return {
      $type: "app.bsky.embed.images",
      images: uploaded.map((item, index) => ({
        image: item.data.blob,
        alt: images[index]?.altText ?? "",
      })),
    };
  }

  if (videos.length === 1) {
    const video = videos[0]!;
    const uploaded = await agent.uploadBlob(video.buffer, {
      encoding: video.mimeType || "video/mp4",
    });

    const embed: {
      $type: "app.bsky.embed.video";
      video: unknown;
      alt?: string;
    } = {
      $type: "app.bsky.embed.video",
      video: uploaded.data.blob,
    };

    if (video.altText) {
      embed.alt = video.altText;
    }

    return embed;
  }

  return undefined;
}

export async function publishToBluesky(
  credentials: BlueskyTarget,
  segments: PostSegment[],
): Promise<TargetDeliverySuccess> {
  const agent = new AtpAgent({ service: credentials.pdsUrl });

  await agent.login({
    identifier: credentials.identifier,
    password: credentials.appPassword,
  });

  let root: BlueskyPostRef | undefined;
  let parent: BlueskyPostRef | undefined;
  const postedUris: string[] = [];

  for (const segment of segments) {
    const embed = await buildSegmentEmbed(agent, segment);

    const record: {
      text: string;
      createdAt: string;
      embed?: unknown;
      reply?: {
        root: BlueskyPostRef;
        parent: BlueskyPostRef;
      };
    } = {
      text: segment.text,
      createdAt: new Date().toISOString(),
    };

    if (embed) {
      record.embed = embed;
    }

    if (root && parent) {
      record.reply = {
        root,
        parent,
      };
    }

    const posted = await agent.post(record as never);
    const ref: BlueskyPostRef = {
      uri: posted.uri,
      cid: posted.cid,
    };

    if (!root) {
      root = ref;
    }

    parent = ref;
    postedUris.push(posted.uri);
  }

  if (!root) {
    throw new Error("Bluesky thread publish failed: no posts were created");
  }

  const url = buildBlueskyUrl(agent.did ?? agent.session?.did, root.uri);

  return {
    ok: true,
    platform: "bluesky",
    id: root.uri,
    url,
    raw: {
      rootUri: root.uri,
      postUris: postedUris,
    },
  };
}
