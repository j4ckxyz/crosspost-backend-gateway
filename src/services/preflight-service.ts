import { HttpProblem } from "../problem.js";
import { PostSegment, PublishRequest } from "../types.js";
import {
  BLUESKY_MAX_CHARACTERS,
  X_MAX_CHARACTERS,
  classifyMediaType,
  countCodePoints,
  fetchMastodonInstanceLimits,
} from "./platform-capabilities.js";

function assertNonEmptySegments(segments: PostSegment[]): void {
  if (segments.length === 0) {
    throw new HttpProblem({
      type: "https://api.crosspost.local/problems/validation-error",
      title: "Validation failed",
      status: 400,
      detail: "At least one thread segment is required",
    });
  }

  for (const [index, segment] of segments.entries()) {
    if (segment.text.trim().length === 0) {
      throw new HttpProblem({
        type: "https://api.crosspost.local/problems/validation-error",
        title: "Validation failed",
        status: 400,
        detail: `Thread segment ${index + 1} text must not be empty`,
      });
    }
  }
}

function validateBlueskyMedia(segments: PostSegment[]): void {
  for (const [index, segment] of segments.entries()) {
    const imageMedia = segment.media.filter(
      (item) => classifyMediaType(item.mimeType) === "image",
    );
    const videoMedia = segment.media.filter(
      (item) => classifyMediaType(item.mimeType) === "video",
    );
    const unsupportedMedia = segment.media.filter(
      (item) => classifyMediaType(item.mimeType) === "other",
    );

    if (unsupportedMedia.length > 0) {
      throw new HttpProblem({
        type: "https://api.crosspost.local/problems/bluesky-media-invalid",
        title: "Invalid Bluesky media",
        status: 400,
        detail: `Thread segment ${index + 1} has unsupported media MIME type(s) for Bluesky`,
      });
    }

    if (imageMedia.length > 0 && videoMedia.length > 0) {
      throw new HttpProblem({
        type: "https://api.crosspost.local/problems/bluesky-media-invalid",
        title: "Invalid Bluesky media",
        status: 400,
        detail:
          "Bluesky supports either 1 video or 1-4 images per post segment, not mixed media",
      });
    }

    if (imageMedia.length > 4) {
      throw new HttpProblem({
        type: "https://api.crosspost.local/problems/bluesky-media-invalid",
        title: "Invalid Bluesky media",
        status: 400,
        detail: `Thread segment ${index + 1} has ${imageMedia.length} images. Bluesky allows up to 4.`,
      });
    }

    if (videoMedia.length > 1) {
      throw new HttpProblem({
        type: "https://api.crosspost.local/problems/bluesky-media-invalid",
        title: "Invalid Bluesky media",
        status: 400,
        detail: `Thread segment ${index + 1} has ${videoMedia.length} videos. Bluesky allows only 1.`,
      });
    }

    if (videoMedia.length === 1) {
      const videoMimeType = videoMedia[0]?.mimeType.toLowerCase() || "";
      if (videoMimeType !== "video/mp4") {
        throw new HttpProblem({
          type: "https://api.crosspost.local/problems/bluesky-media-invalid",
          title: "Invalid Bluesky media",
          status: 400,
          detail:
            "Bluesky video upload requires video/mp4 for reliable publishing in this gateway",
        });
      }
    }
  }
}

export class PreflightService {
  async validate(publishRequest: PublishRequest): Promise<void> {
    assertNonEmptySegments(publishRequest.segments);

    if (publishRequest.targets.x) {
      for (const [index, segment] of publishRequest.segments.entries()) {
        const length = countCodePoints(segment.text);
        if (length > X_MAX_CHARACTERS) {
          throw new HttpProblem({
            type: "https://api.crosspost.local/problems/x-length-exceeded",
            title: "X character limit exceeded",
            status: 400,
            detail: `Thread segment ${index + 1} has ${length} characters. This gateway enforces 280 for non-premium X users.`,
          });
        }
      }
    }

    if (publishRequest.targets.bluesky) {
      for (const [index, segment] of publishRequest.segments.entries()) {
        const length = countCodePoints(segment.text);
        if (length > BLUESKY_MAX_CHARACTERS) {
          throw new HttpProblem({
            type: "https://api.crosspost.local/problems/bluesky-length-exceeded",
            title: "Bluesky character limit exceeded",
            status: 400,
            detail: `Thread segment ${index + 1} has ${length} characters. Bluesky allows up to 300.`,
          });
        }
      }

      validateBlueskyMedia(publishRequest.segments);
    }

    if (publishRequest.targets.mastodon) {
      const limits = await fetchMastodonInstanceLimits(
        publishRequest.targets.mastodon.instanceUrl,
        publishRequest.targets.mastodon.accessToken,
      );

      for (const [index, segment] of publishRequest.segments.entries()) {
        const length = countCodePoints(segment.text);
        if (length > limits.maxCharacters) {
          throw new HttpProblem({
            type: "https://api.crosspost.local/problems/mastodon-length-exceeded",
            title: "Mastodon character limit exceeded",
            status: 400,
            detail: `Thread segment ${index + 1} has ${length} characters. Instance ${limits.instanceUrl} currently allows ${limits.maxCharacters}.`,
          });
        }

        if (segment.media.length > limits.maxMediaAttachments) {
          throw new HttpProblem({
            type: "https://api.crosspost.local/problems/mastodon-media-exceeded",
            title: "Mastodon media limit exceeded",
            status: 400,
            detail: `Thread segment ${index + 1} has ${segment.media.length} media files. Instance ${limits.instanceUrl} currently allows ${limits.maxMediaAttachments}.`,
          });
        }
      }
    }
  }
}
