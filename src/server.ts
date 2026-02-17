import { mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";

import helmet from "@fastify/helmet";
import multipart, { MultipartFile } from "@fastify/multipart";
import rateLimit from "@fastify/rate-limit";
import swagger from "@fastify/swagger";
import swaggerUi from "@fastify/swagger-ui";
import Fastify, { FastifyRequest } from "fastify";
import { ZodError } from "zod";

import { buildApiKeyAuth } from "./auth.js";
import { resolveConfig } from "./config.js";
import { HttpProblem, fromZodError, isHttpProblem } from "./problem.js";
import {
  BLUESKY_MAX_CHARACTERS,
  X_MAX_CHARACTERS,
  fetchMastodonInstanceLimits,
} from "./services/platform-capabilities.js";
import { PreflightService } from "./services/preflight-service.js";
import { CrosspostService } from "./services/crosspost-service.js";
import { SchedulerService } from "./services/scheduler-service.js";
import { JobStore } from "./store/job-store.js";
import {
  IncomingMedia,
  PostPayload,
  PostPayloadSchema,
  PostSegment,
  PublishRequest,
} from "./types.js";

interface ParsedPostRequest {
  payload: PostPayload;
  publishRequest: PublishRequest;
}

function toHtmlStatusDocument(input: {
  startedAt: string;
  serviceAddress: string;
  counts: Record<string, number>;
}): string {
  const uptimeSeconds = Math.floor(process.uptime());

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Crosspost Gateway Status</title>
  <style>
    body { font-family: ui-monospace, Menlo, Consolas, monospace; margin: 2rem; background: #f8fafc; color: #111827; }
    h1 { margin-bottom: 0.25rem; }
    .box { background: white; border: 1px solid #cbd5e1; border-radius: 8px; padding: 1rem; max-width: 820px; }
    dt { font-weight: 700; }
    dd { margin: 0 0 0.75rem 0; }
  </style>
</head>
<body>
  <h1>Crosspost Gateway</h1>
  <p>Service is running.</p>
  <div class="box">
    <dl>
      <dt>Uptime (seconds)</dt>
      <dd>${uptimeSeconds}</dd>
      <dt>Started at (UTC)</dt>
      <dd>${input.startedAt}</dd>
      <dt>Listening address</dt>
      <dd>${input.serviceAddress}</dd>
      <dt>Scheduler counters</dt>
      <dd>${Object.entries(input.counts)
        .map(([key, value]) => `${key}: ${value}`)
        .join(" | ")}</dd>
    </dl>
  </div>
</body>
</html>`;
}

function buildBaseSegments(payload: PostPayload): PostSegment[] {
  if (payload.thread) {
    return payload.thread.map((segment) => ({
      text: segment.text,
      media: [],
    }));
  }

  if (payload.text) {
    return [
      {
        text: payload.text,
        media: [],
      },
    ];
  }

  throw new HttpProblem({
    type: "https://api.crosspost.local/problems/validation-error",
    title: "Validation failed",
    status: 400,
    detail: "Provide either text or thread",
  });
}

function buildPublishRequest(
  payload: PostPayload,
  mediaFiles: IncomingMedia[],
  instance: string,
): PublishRequest {
  const segments = buildBaseSegments(payload);

  if (mediaFiles.length === 0) {
    if (payload.media && payload.media.length > 0) {
      throw new HttpProblem({
        type: "https://api.crosspost.local/problems/invalid-request",
        title: "Invalid request body",
        status: 400,
        detail: "payload.media is present but no media files were uploaded",
        instance,
      });
    }

    return {
      targets: payload.targets,
      segments,
      clientRequestId: payload.clientRequestId,
    };
  }

  if (payload.media && payload.media.length !== mediaFiles.length) {
    throw new HttpProblem({
      type: "https://api.crosspost.local/problems/invalid-request",
      title: "Invalid request body",
      status: 400,
      detail: "payload.media length must match number of media files",
      instance,
    });
  }

  const metadata: Array<{
    altText?: string;
    threadIndex?: number;
  }> =
    payload.media ??
    mediaFiles.map(() => ({
      threadIndex: 0,
    }));

  for (const [index, uploaded] of mediaFiles.entries()) {
    const mediaMeta = metadata[index];
    const segmentIndex = mediaMeta?.threadIndex ?? 0;

    if (segmentIndex < 0 || segmentIndex >= segments.length) {
      throw new HttpProblem({
        type: "https://api.crosspost.local/problems/invalid-request",
        title: "Invalid media mapping",
        status: 400,
        detail: `media[${index}] references threadIndex ${segmentIndex}, but there are ${segments.length} segment(s)`,
        instance,
      });
    }

    segments[segmentIndex]!.media.push({
      ...uploaded,
      altText: mediaMeta?.altText,
    });
  }

  return {
    targets: payload.targets,
    segments,
    clientRequestId: payload.clientRequestId,
  };
}

async function parseMultipartRequest(request: FastifyRequest): Promise<ParsedPostRequest> {
  let payloadRaw: string | undefined;
  const files: MultipartFile[] = [];

  for await (const part of request.parts()) {
    if (part.type === "file") {
      if (part.fieldname !== "media") {
        await part.toBuffer();
        continue;
      }

      files.push(part);
      continue;
    }

    if (part.fieldname === "payload") {
      payloadRaw = String(part.value);
    }
  }

  if (!payloadRaw) {
    throw new HttpProblem({
      type: "https://api.crosspost.local/problems/invalid-request",
      title: "Invalid request body",
      status: 400,
      detail: "Multipart requests must include a payload field",
      instance: request.url,
    });
  }

  let parsedPayloadBody: unknown;
  try {
    parsedPayloadBody = JSON.parse(payloadRaw);
  } catch {
    throw new HttpProblem({
      type: "https://api.crosspost.local/problems/invalid-request",
      title: "Invalid request body",
      status: 400,
      detail: "payload must be valid JSON",
      instance: request.url,
    });
  }

  const payload = PostPayloadSchema.parse(parsedPayloadBody);
  const media: IncomingMedia[] = [];

  for (const [index, file] of files.entries()) {
    const buffer = await file.toBuffer();

    media.push({
      buffer,
      fileName: file.filename || `media-${index + 1}`,
      mimeType: file.mimetype || "application/octet-stream",
    });
  }

  return {
    payload,
    publishRequest: buildPublishRequest(payload, media, request.url),
  };
}

async function parseJsonRequest(request: FastifyRequest): Promise<ParsedPostRequest> {
  const payload = PostPayloadSchema.parse(request.body);

  if (payload.media && payload.media.length > 0) {
    throw new HttpProblem({
      type: "https://api.crosspost.local/problems/invalid-request",
      title: "Invalid request body",
      status: 400,
      detail: "To upload media, use multipart/form-data with media file parts",
      instance: request.url,
    });
  }

  return {
    payload,
    publishRequest: buildPublishRequest(payload, [], request.url),
  };
}

async function parseRequestBody(request: FastifyRequest): Promise<ParsedPostRequest> {
  if (request.isMultipart()) {
    return parseMultipartRequest(request);
  }

  return parseJsonRequest(request);
}

async function main(): Promise<void> {
  const config = resolveConfig();
  await mkdir(config.dataDir, { recursive: true });

  const httpsOptions =
    config.tlsKeyPath && config.tlsCertPath
      ? {
          key: await readFile(config.tlsKeyPath),
          cert: await readFile(config.tlsCertPath),
        }
      : undefined;

  const app = Fastify({
    logger: {
      level: process.env.LOG_LEVEL || "info",
      redact: {
        paths: [
          "req.headers.authorization",
          "req.body.targets.x.authToken",
          "req.body.targets.bluesky.appPassword",
          "req.body.targets.mastodon.accessToken",
        ],
        censor: "[REDACTED]",
      },
    },
    ...(httpsOptions ? { https: httpsOptions } : {}),
  });

  await app.register(helmet, {
    global: true,
  });

  await app.register(rateLimit, {
    global: true,
    max: config.rateLimitMax,
    timeWindow: config.rateLimitWindowMs,
    skipOnError: true,
  });

  await app.register(multipart, {
    limits: {
      files: 100,
      fileSize: 512 * 1024 * 1024,
    },
  });

  await app.register(swagger, {
    openapi: {
      openapi: "3.1.0",
      info: {
        title: "Crosspost Gateway API",
        version: "1.1.0",
        description:
          "Gateway API for posting threads to X, Bluesky, and Mastodon with optional scheduling.",
      },
      components: {
        securitySchemes: {
          bearerAuth: {
            type: "http",
            scheme: "bearer",
            bearerFormat: "API Key",
          },
        },
      },
    },
  });

  await app.register(swaggerUi, {
    routePrefix: "/docs",
  });

  const preflightService = new PreflightService();
  const crosspostService = new CrosspostService(preflightService);
  const jobStore = new JobStore(join(config.dataDir, "jobs.json"));
  const scheduler = new SchedulerService(
    jobStore,
    crosspostService,
    config.encryptionKey,
    config.dataDir,
    {
      info: (message, extra) => app.log.info(extra ?? {}, message),
      warn: (message, extra) => app.log.warn(extra ?? {}, message),
      error: (message, extra) => app.log.error(extra ?? {}, message),
    },
    config.schedulerPollMs,
  );

  await scheduler.start();

  const startedAt = new Date().toISOString();
  const authHook = buildApiKeyAuth(config.apiKeys);

  app.setErrorHandler((error, request, reply) => {
    const fastifyValidationError = error as {
      code?: string;
      statusCode?: number;
      message?: string;
      validation?: Array<{
        instancePath?: string;
        message?: string;
      }>;
    };

    if (
      fastifyValidationError.code === "FST_ERR_VALIDATION" ||
      fastifyValidationError.statusCode === 400
    ) {
      void reply
        .code(400)
        .type("application/problem+json")
        .send({
          type: "https://api.crosspost.local/problems/validation-error",
          title: "Validation failed",
          status: 400,
          detail: fastifyValidationError.message || "Request validation failed",
          instance: request.url,
          errors: fastifyValidationError.validation?.map((issue) => ({
            path: (issue.instancePath || "/").replace(/^\//, "").replaceAll("/", "."),
            message: issue.message || "Invalid value",
          })),
        });
      return;
    }

    if (error instanceof ZodError) {
      const problem = fromZodError(error, request.url);
      void reply
        .code(problem.details.status)
        .type("application/problem+json")
        .send(problem.details);
      return;
    }

    if (isHttpProblem(error)) {
      void reply
        .code(error.details.status)
        .type("application/problem+json")
        .send({
          ...error.details,
          instance: error.details.instance ?? request.url,
        });
      return;
    }

    request.log.error({ err: error }, "Unhandled server error");
    void reply
      .code(500)
      .type("application/problem+json")
      .send({
        type: "https://api.crosspost.local/problems/internal-error",
        title: "Internal server error",
        status: 500,
        detail: "Unexpected error while handling request",
        instance: request.url,
      });
  });

  app.get(
    "/",
    {
      schema: {
        tags: ["Status"],
        summary: "API entrypoint",
      },
    },
    async () => {
      return {
        name: "crosspost-gateway",
        version: "1.1.0",
        docs: "/docs",
        openapi: "/openapi.json",
        status: "/status",
      };
    },
  );

  app.get(
    "/openapi.json",
    {
      schema: {
        hide: true,
      },
    },
    async () => app.swagger(),
  );

  app.get(
    "/status",
    {
      schema: {
        tags: ["Status"],
        summary: "HTML service status",
        response: {
          200: {
            type: "string",
          },
        },
      },
    },
    async (_request, reply) => {
      const counts = await scheduler.getCounts();
      const serviceAddress = app.server.address();
      const renderedAddress =
        typeof serviceAddress === "string"
          ? serviceAddress
          : serviceAddress
            ? `${serviceAddress.address}:${serviceAddress.port}`
            : "unknown";

      reply.type("text/html; charset=utf-8");
      return toHtmlStatusDocument({
        startedAt,
        serviceAddress: renderedAddress,
        counts,
      });
    },
  );

  app.get(
    "/v1/limits",
    {
      preHandler: authHook,
      schema: {
        tags: ["Capabilities"],
        security: [{ bearerAuth: [] }],
        summary: "Get platform limits for client-side compose validation",
        querystring: {
          type: "object",
          properties: {
            mastodonInstanceUrl: { type: "string", format: "uri" },
            mastodonAccessToken: { type: "string" },
          },
        },
      },
    },
    async (request) => {
      const query = request.query as {
        mastodonInstanceUrl?: string;
        mastodonAccessToken?: string;
      };

      const response: {
        x: {
          maxCharacters: number;
          assumedUserTier: string;
        };
        bluesky: {
          maxCharacters: number;
          mediaRule: string;
        };
        mastodon?: Awaited<ReturnType<typeof fetchMastodonInstanceLimits>>;
      } = {
        x: {
          maxCharacters: X_MAX_CHARACTERS,
          assumedUserTier: "non-premium",
        },
        bluesky: {
          maxCharacters: BLUESKY_MAX_CHARACTERS,
          mediaRule: "either 1 video or 1-4 images per post segment",
        },
      };

      if (query.mastodonInstanceUrl) {
        response.mastodon = await fetchMastodonInstanceLimits(
          query.mastodonInstanceUrl,
          query.mastodonAccessToken,
        );
      }

      return response;
    },
  );

  app.post(
    "/v1/posts",
    {
      preHandler: authHook,
      schema: {
        tags: ["Posts"],
        security: [{ bearerAuth: [] }],
        summary: "Create a cross-post (single post or thread), immediately or scheduled",
        consumes: ["application/json", "multipart/form-data"],
      },
    },
    async (request, reply) => {
      const { payload, publishRequest } = await parseRequestBody(request);

      await preflightService.validate(publishRequest);

      if (payload.scheduleAt) {
        const scheduled = await scheduler.schedule(payload.scheduleAt, publishRequest);
        reply.code(202);
        return {
          scheduled: true,
          job: scheduled,
        };
      }

      const result = await crosspostService.dispatch(publishRequest);

      reply.code(result.overall === "success" ? 201 : 207);
      return result;
    },
  );

  app.get(
    "/v1/jobs",
    {
      preHandler: authHook,
      schema: {
        tags: ["Jobs"],
        security: [{ bearerAuth: [] }],
        summary: "List scheduled and completed jobs",
      },
    },
    async () => {
      const jobs = await scheduler.listJobs();
      return {
        jobs,
      };
    },
  );

  app.get(
    "/v1/jobs/:jobId",
    {
      preHandler: authHook,
      schema: {
        tags: ["Jobs"],
        security: [{ bearerAuth: [] }],
        summary: "Get job by ID",
        params: {
          type: "object",
          required: ["jobId"],
          properties: {
            jobId: { type: "string", format: "uuid" },
          },
        },
      },
    },
    async (request) => {
      const params = request.params as { jobId: string };
      const job = await scheduler.getJob(params.jobId);

      if (!job) {
        throw new HttpProblem({
          type: "https://api.crosspost.local/problems/not-found",
          title: "Job not found",
          status: 404,
          detail: `No job exists with id ${params.jobId}`,
          instance: request.url,
        });
      }

      return {
        job,
      };
    },
  );

  app.delete(
    "/v1/jobs/:jobId",
    {
      preHandler: authHook,
      schema: {
        tags: ["Jobs"],
        security: [{ bearerAuth: [] }],
        summary: "Cancel a scheduled job",
        params: {
          type: "object",
          required: ["jobId"],
          properties: {
            jobId: { type: "string", format: "uuid" },
          },
        },
      },
    },
    async (request) => {
      const params = request.params as { jobId: string };
      const job = await scheduler.cancel(params.jobId);
      return {
        cancelled: true,
        job,
      };
    },
  );

  app.addHook("onClose", async () => {
    await scheduler.stop();
  });

  const address = await app.listen({
    host: config.host,
    port: config.port,
  });

  app.log.info({ address }, "Crosspost gateway listening");

  if (httpsOptions) {
    app.log.info("HTTPS enabled via TLS_KEY_PATH/TLS_CERT_PATH");
  }

  if (config.generatedApiKey) {
    app.log.warn(
      {
        generatedApiKey: config.generatedApiKey,
      },
      "No API_KEYS provided. Generated an ephemeral API key for this process.",
    );
  }

  if (config.generatedEncryptionKey) {
    app.log.warn(
      "No SCHEDULER_ENCRYPTION_KEY provided. Scheduled jobs cannot survive restarts.",
    );
  }
}

void main();
