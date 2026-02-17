import { randomUUID } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { HttpProblem } from "../problem.js";
import { decryptJson, encryptJson } from "../security/crypto.js";
import { JobStore, JobSummary, StoredJob, toJobSummary } from "../store/job-store.js";
import {
  IncomingMedia,
  JobStatus,
  PostSegment,
  PublishRequest,
  ScheduledJobPayload,
  StoredMediaReference,
} from "../types.js";
import { CrosspostService } from "./crosspost-service.js";

interface SchedulerLogger {
  info: (message: string, extra?: Record<string, unknown>) => void;
  warn: (message: string, extra?: Record<string, unknown>) => void;
  error: (message: string, extra?: Record<string, unknown>) => void;
}

export class SchedulerService {
  private readonly mediaRoot: string;
  private intervalHandle?: NodeJS.Timeout;
  private isProcessing = false;

  constructor(
    private readonly jobStore: JobStore,
    private readonly crosspostService: CrosspostService,
    private readonly encryptionKey: Buffer,
    dataDir: string,
    private readonly logger: SchedulerLogger,
    private readonly pollMs: number,
  ) {
    this.mediaRoot = join(dataDir, "scheduled-media");
  }

  async start(): Promise<void> {
    await this.jobStore.init();
    await mkdir(this.mediaRoot, { recursive: true });

    this.intervalHandle = setInterval(() => {
      void this.tick();
    }, this.pollMs);

    this.intervalHandle.unref();
    await this.tick();
  }

  async stop(): Promise<void> {
    if (this.intervalHandle) {
      clearInterval(this.intervalHandle);
      this.intervalHandle = undefined;
    }
  }

  async schedule(runAtIso: string, publishRequest: PublishRequest): Promise<JobSummary> {
    const runDate = new Date(runAtIso);
    if (Number.isNaN(runDate.getTime())) {
      throw new HttpProblem({
        type: "https://api.crosspost.local/problems/invalid-schedule",
        title: "Invalid schedule",
        status: 400,
        detail: "scheduleAt must be a valid ISO 8601 timestamp",
      });
    }

    if (runDate.getTime() <= Date.now()) {
      throw new HttpProblem({
        type: "https://api.crosspost.local/problems/invalid-schedule",
        title: "Invalid schedule",
        status: 400,
        detail: "scheduleAt must be in the future",
      });
    }

    const id = randomUUID();
    const mediaReferences = await this.persistMedia(id, publishRequest.segments);

    const payloadToEncrypt: ScheduledJobPayload = {
      targets: publishRequest.targets,
      segments: publishRequest.segments.map((segment) => ({ text: segment.text })),
      clientRequestId: publishRequest.clientRequestId,
    };

    const storedJob: StoredJob = {
      id,
      createdAt: new Date().toISOString(),
      runAt: runDate.toISOString(),
      status: "scheduled",
      encryptedPayload: encryptJson(payloadToEncrypt, this.encryptionKey),
      media: mediaReferences,
      attemptCount: 0,
    };

    await this.jobStore.create(storedJob);
    this.logger.info("Scheduled post", { jobId: id, runAt: storedJob.runAt });

    return toJobSummary(storedJob);
  }

  async listJobs(): Promise<JobSummary[]> {
    const jobs = await this.jobStore.list();
    return jobs.map(toJobSummary);
  }

  async getJob(jobId: string): Promise<JobSummary | undefined> {
    const job = await this.jobStore.get(jobId);
    return job ? toJobSummary(job) : undefined;
  }

  async cancel(jobId: string): Promise<JobSummary> {
    const existing = await this.jobStore.get(jobId);
    if (!existing) {
      throw new HttpProblem({
        type: "https://api.crosspost.local/problems/not-found",
        title: "Job not found",
        status: 404,
        detail: `No job exists with id ${jobId}`,
      });
    }

    if (existing.status !== "scheduled") {
      throw new HttpProblem({
        type: "https://api.crosspost.local/problems/conflict",
        title: "Job cannot be cancelled",
        status: 409,
        detail: `Job ${jobId} is ${existing.status} and can no longer be cancelled`,
      });
    }

    const cancelled = await this.jobStore.update(jobId, (current) => ({
      ...current,
      status: "cancelled",
      completedAt: new Date().toISOString(),
    }));

    if (!cancelled) {
      throw new HttpProblem({
        type: "https://api.crosspost.local/problems/not-found",
        title: "Job not found",
        status: 404,
        detail: `No job exists with id ${jobId}`,
      });
    }

    await this.cleanupMedia(jobId);
    return toJobSummary(cancelled);
  }

  async getCounts(): Promise<Record<JobStatus, number>> {
    const counts: Record<JobStatus, number> = {
      scheduled: 0,
      running: 0,
      succeeded: 0,
      partial: 0,
      failed: 0,
      cancelled: 0,
    };

    const jobs = await this.jobStore.list();
    for (const job of jobs) {
      counts[job.status] += 1;
    }

    return counts;
  }

  private async tick(): Promise<void> {
    if (this.isProcessing) {
      return;
    }

    this.isProcessing = true;

    try {
      const dueJobs = await this.jobStore.listDue(new Date().toISOString());

      for (const job of dueJobs) {
        await this.processJob(job);
      }
    } catch (error) {
      this.logger.error("Scheduler tick failed", {
        error: error instanceof Error ? error.message : String(error),
      });
    } finally {
      this.isProcessing = false;
    }
  }

  private async processJob(job: StoredJob): Promise<void> {
    await this.jobStore.update(job.id, (current) => ({
      ...current,
      status: "running",
      attemptCount: current.attemptCount + 1,
    }));

    try {
      const payload = decryptJson<ScheduledJobPayload>(
        job.encryptedPayload,
        this.encryptionKey,
      );
      const segments = await this.loadSegments(payload.segments, job.media);

      const result = await this.crosspostService.dispatch({
        targets: payload.targets,
        segments,
        clientRequestId: payload.clientRequestId,
      });
      const status: JobStatus = result.overall === "success" ? "succeeded" : "partial";

      await this.jobStore.update(job.id, (current) => ({
        ...current,
        status,
        completedAt: new Date().toISOString(),
        deliveries: result.deliveries,
        lastError: undefined,
      }));

      this.logger.info("Scheduled post executed", {
        jobId: job.id,
        status,
      });

      await this.cleanupMedia(job.id);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);

      await this.jobStore.update(job.id, (current) => ({
        ...current,
        status: "failed",
        completedAt: new Date().toISOString(),
        lastError: message,
      }));

      this.logger.warn("Scheduled post failed", {
        jobId: job.id,
        error: message,
      });
    }
  }

  private async persistMedia(
    jobId: string,
    segments: PostSegment[],
  ): Promise<StoredMediaReference[]> {
    const totalMediaCount = segments.reduce(
      (count, segment) => count + segment.media.length,
      0,
    );

    if (totalMediaCount === 0) {
      return [];
    }

    const folder = join(this.mediaRoot, jobId);
    await mkdir(folder, { recursive: true });

    const output: StoredMediaReference[] = [];

    let fileCounter = 0;
    for (const [segmentIndex, segment] of segments.entries()) {
      for (const item of segment.media) {
        fileCounter += 1;

        const safeFileName =
          item.fileName.replace(/[^a-zA-Z0-9._-]+/g, "_") || `media-${fileCounter}`;
        const fileName = `${fileCounter}-${safeFileName}`;
        const path = join(folder, fileName);

        await writeFile(path, item.buffer);

        output.push({
          path,
          segmentIndex,
          fileName,
          mimeType: item.mimeType,
          altText: item.altText,
        });
      }
    }

    return output;
  }

  private async loadSegments(
    persistedSegments: ScheduledJobPayload["segments"],
    media: StoredMediaReference[],
  ): Promise<PostSegment[]> {
    const loaded: PostSegment[] = persistedSegments.map((segment) => ({
      text: segment.text,
      media: [],
    }));

    for (const item of media) {
      const buffer = await readFile(item.path);
      const targetSegment = loaded[item.segmentIndex];

      if (!targetSegment) {
        continue;
      }

      targetSegment.media.push({
        buffer,
        fileName: item.fileName,
        mimeType: item.mimeType,
        altText: item.altText,
      });
    }

    return loaded;
  }

  private async cleanupMedia(jobId: string): Promise<void> {
    const folder = join(this.mediaRoot, jobId);
    await rm(folder, { recursive: true, force: true });
  }
}
