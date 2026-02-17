import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

import {
  JobStatus,
  PlatformName,
  StoredMediaReference,
  TargetDelivery,
} from "../types.js";

export interface StoredJob {
  id: string;
  createdAt: string;
  runAt: string;
  status: JobStatus;
  encryptedPayload: string;
  media: StoredMediaReference[];
  attemptCount: number;
  completedAt?: string;
  lastError?: string;
  deliveries?: Partial<Record<PlatformName, TargetDelivery>>;
}

export interface JobSummary {
  id: string;
  createdAt: string;
  runAt: string;
  status: JobStatus;
  attemptCount: number;
  completedAt?: string;
  lastError?: string;
  deliveries?: Partial<Record<PlatformName, TargetDelivery>>;
}

interface PersistedState {
  jobs: StoredJob[];
}

export class JobStore {
  private readonly jobs = new Map<string, StoredJob>();
  private lock: Promise<unknown> = Promise.resolve();

  constructor(private readonly filePath: string) {}

  async init(): Promise<void> {
    await mkdir(dirname(this.filePath), { recursive: true });

    try {
      const content = await readFile(this.filePath, "utf8");
      const parsed = JSON.parse(content) as PersistedState;
      if (Array.isArray(parsed.jobs)) {
        for (const job of parsed.jobs) {
          this.jobs.set(job.id, job);
        }
      }
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== "ENOENT") {
        throw error;
      }

      await this.flush();
    }
  }

  async create(job: StoredJob): Promise<void> {
    await this.withLock(async () => {
      this.jobs.set(job.id, job);
      await this.flush();
    });
  }

  async get(id: string): Promise<StoredJob | undefined> {
    return this.jobs.get(id);
  }

  async list(): Promise<StoredJob[]> {
    return [...this.jobs.values()].sort((a, b) =>
      a.createdAt.localeCompare(b.createdAt),
    );
  }

  async listDue(atIso: string): Promise<StoredJob[]> {
    return [...this.jobs.values()]
      .filter((job) => job.status === "scheduled" && job.runAt <= atIso)
      .sort((a, b) => a.runAt.localeCompare(b.runAt));
  }

  async update(
    id: string,
    mutate: (current: StoredJob) => StoredJob,
  ): Promise<StoredJob | undefined> {
    return this.withLock(async () => {
      const current = this.jobs.get(id);
      if (!current) {
        return undefined;
      }

      const next = mutate(current);
      this.jobs.set(id, next);
      await this.flush();
      return next;
    });
  }

  private async flush(): Promise<void> {
    const data: PersistedState = {
      jobs: [...this.jobs.values()].sort((a, b) =>
        a.createdAt.localeCompare(b.createdAt),
      ),
    };

    await writeFile(this.filePath, JSON.stringify(data, null, 2), "utf8");
  }

  private async withLock<T>(fn: () => Promise<T>): Promise<T> {
    const previous = this.lock;

    let resolveCurrent: (value: unknown) => void;
    this.lock = new Promise((resolve) => {
      resolveCurrent = resolve;
    });

    await previous;

    try {
      return await fn();
    } finally {
      resolveCurrent!(undefined);
    }
  }
}

export function toJobSummary(job: StoredJob): JobSummary {
  return {
    id: job.id,
    createdAt: job.createdAt,
    runAt: job.runAt,
    status: job.status,
    attemptCount: job.attemptCount,
    completedAt: job.completedAt,
    lastError: job.lastError,
    deliveries: job.deliveries,
  };
}
