import { z } from "zod";

const xClientEnumValues = [
  "android",
  "iphone",
  "ipad",
  "mac",
  "old",
  "web",
  "tweetdeck",
] as const;

export const XTargetSchema = z
  .object({
    authToken: z.string().min(20).max(512),
    client: z.enum(xClientEnumValues).optional(),
  })
  .strict();

export const BlueskyTargetSchema = z
  .object({
    identifier: z.string().min(1).max(256),
    pdsUrl: z.string().url(),
    appPassword: z.string().min(6).max(256),
  })
  .strict();

export const MastodonTargetSchema = z
  .object({
    instanceUrl: z.string().url(),
    accessToken: z.string().min(1).max(1024),
    visibility: z.enum(["public", "unlisted", "private", "direct"]).optional(),
  })
  .strict();

export const TargetsSchema = z
  .object({
    x: XTargetSchema.optional(),
    bluesky: BlueskyTargetSchema.optional(),
    mastodon: MastodonTargetSchema.optional(),
  })
  .strict()
  .refine((value) => Boolean(value.x || value.bluesky || value.mastodon), {
    message: "At least one target platform is required",
    path: ["targets"],
  });

export const ThreadSegmentSchema = z
  .object({
    text: z.string().trim().min(1).max(5000),
  })
  .strict();

export const MediaMetadataSchema = z
  .object({
    altText: z.string().trim().max(1000).optional(),
    threadIndex: z.number().int().min(0).optional(),
  })
  .strict();

export const PostPayloadSchema = z
  .object({
    text: z.string().trim().min(1).max(5000).optional(),
    thread: z.array(ThreadSegmentSchema).min(1).max(100).optional(),
    scheduleAt: z.string().datetime({ offset: true }).optional(),
    targets: TargetsSchema,
    media: z.array(MediaMetadataSchema).max(100).optional(),
    clientRequestId: z.string().trim().min(1).max(128).optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    const hasText = typeof value.text === "string" && value.text.length > 0;
    const hasThread = Array.isArray(value.thread) && value.thread.length > 0;

    if (!hasText && !hasThread) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Provide either text or thread",
        path: ["text"],
      });
    }

    if (hasText && hasThread) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Provide either text or thread, not both",
        path: ["thread"],
      });
    }
  });

export type XTarget = z.infer<typeof XTargetSchema>;
export type BlueskyTarget = z.infer<typeof BlueskyTargetSchema>;
export type MastodonTarget = z.infer<typeof MastodonTargetSchema>;
export type Targets = z.infer<typeof TargetsSchema>;
export type MediaMetadata = z.infer<typeof MediaMetadataSchema>;
export type ThreadSegment = z.infer<typeof ThreadSegmentSchema>;
export type PostPayload = z.infer<typeof PostPayloadSchema>;

export interface IncomingMedia {
  buffer: Buffer;
  fileName: string;
  mimeType: string;
  altText?: string;
}

export interface PostSegment {
  text: string;
  media: IncomingMedia[];
}

export interface PublishRequest {
  targets: Targets;
  segments: PostSegment[];
  clientRequestId?: string;
}

export interface PersistedSegment {
  text: string;
}

export type PlatformName = "x" | "bluesky" | "mastodon";

export interface TargetDeliverySuccess {
  ok: true;
  platform: PlatformName;
  id: string;
  url?: string;
  raw?: unknown;
}

export interface TargetDeliveryFailure {
  ok: false;
  platform: PlatformName;
  error: string;
}

export type TargetDelivery = TargetDeliverySuccess | TargetDeliveryFailure;

export interface CrosspostDispatchResult {
  overall: "success" | "partial";
  postedAt: string;
  clientRequestId?: string;
  deliveries: Partial<Record<PlatformName, TargetDelivery>>;
}

export type JobStatus =
  | "scheduled"
  | "running"
  | "succeeded"
  | "partial"
  | "failed"
  | "cancelled";

export interface ScheduledJobPayload {
  targets: Targets;
  segments: PersistedSegment[];
  clientRequestId?: string;
}

export interface StoredMediaReference {
  path: string;
  segmentIndex: number;
  fileName: string;
  mimeType: string;
  altText?: string;
}

export interface MastodonInstanceLimits {
  instanceUrl: string;
  maxCharacters: number;
  maxMediaAttachments: number;
  charactersReservedPerUrl: number;
  supportedMimeTypes: string[];
  imageSizeLimit: number;
  videoSizeLimit: number;
  fetchedAt: string;
}
