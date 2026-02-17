import { createHash, randomBytes } from "node:crypto";
import { resolve } from "node:path";

export interface AppConfig {
  host: string;
  port: number;
  apiKeys: Set<string>;
  generatedApiKey?: string;
  dataDir: string;
  encryptionKey: Buffer;
  generatedEncryptionKey: boolean;
  schedulerPollMs: number;
  rateLimitMax: number;
  rateLimitWindowMs: number;
  tlsKeyPath?: string;
  tlsCertPath?: string;
}

function parsePort(rawPort: string | undefined): number {
  if (!rawPort) {
    return 0;
  }

  const parsed = Number.parseInt(rawPort, 10);
  if (Number.isNaN(parsed) || parsed < 0 || parsed > 65535) {
    throw new Error(`Invalid PORT: ${rawPort}`);
  }

  return parsed;
}

function parseApiKeys(rawKeys: string | undefined): Set<string> {
  if (!rawKeys) {
    return new Set();
  }

  const keys = rawKeys
    .split(",")
    .map((key) => key.trim())
    .filter((key) => key.length > 0);

  return new Set(keys);
}

function resolveEncryptionKey(rawValue: string | undefined): {
  key: Buffer;
  generated: boolean;
} {
  if (!rawValue) {
    return {
      key: randomBytes(32),
      generated: true,
    };
  }

  const value = rawValue.trim();

  if (/^[0-9a-fA-F]{64}$/.test(value)) {
    return {
      key: Buffer.from(value, "hex"),
      generated: false,
    };
  }

  try {
    const decoded = Buffer.from(value, "base64");
    if (decoded.length === 32) {
      return {
        key: decoded,
        generated: false,
      };
    }
  } catch {
    // Fallback to hash-based derivation below.
  }

  return {
    key: createHash("sha256").update(value).digest(),
    generated: false,
  };
}

function parseSchedulerPollMs(rawValue: string | undefined): number {
  if (!rawValue) {
    return 5000;
  }

  const parsed = Number.parseInt(rawValue, 10);
  if (Number.isNaN(parsed) || parsed < 1000) {
    throw new Error(`Invalid SCHEDULER_POLL_MS: ${rawValue}`);
  }

  return parsed;
}

function parseRateLimitMax(rawValue: string | undefined): number {
  if (!rawValue) {
    return 120;
  }

  const parsed = Number.parseInt(rawValue, 10);
  if (Number.isNaN(parsed) || parsed < 1) {
    throw new Error(`Invalid RATE_LIMIT_MAX: ${rawValue}`);
  }

  return parsed;
}

function parseRateLimitWindowMs(rawValue: string | undefined): number {
  if (!rawValue) {
    return 60_000;
  }

  const parsed = Number.parseInt(rawValue, 10);
  if (Number.isNaN(parsed) || parsed < 1_000) {
    throw new Error(`Invalid RATE_LIMIT_WINDOW_MS: ${rawValue}`);
  }

  return parsed;
}

export function resolveConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const apiKeys = parseApiKeys(env.API_KEYS);
  let generatedApiKey: string | undefined;

  if (apiKeys.size === 0) {
    generatedApiKey = randomBytes(24).toString("hex");
    apiKeys.add(generatedApiKey);
  }

  const encryption = resolveEncryptionKey(env.SCHEDULER_ENCRYPTION_KEY);

  const tlsKeyPath = env.TLS_KEY_PATH?.trim()
    ? resolve(env.TLS_KEY_PATH.trim())
    : undefined;
  const tlsCertPath = env.TLS_CERT_PATH?.trim()
    ? resolve(env.TLS_CERT_PATH.trim())
    : undefined;

  if ((tlsKeyPath && !tlsCertPath) || (!tlsKeyPath && tlsCertPath)) {
    throw new Error("TLS_KEY_PATH and TLS_CERT_PATH must both be provided together");
  }

  return {
    host: env.HOST?.trim() || "0.0.0.0",
    port: parsePort(env.PORT),
    apiKeys,
    generatedApiKey,
    dataDir: resolve(env.DATA_DIR?.trim() || ".data"),
    encryptionKey: encryption.key,
    generatedEncryptionKey: encryption.generated,
    schedulerPollMs: parseSchedulerPollMs(env.SCHEDULER_POLL_MS),
    rateLimitMax: parseRateLimitMax(env.RATE_LIMIT_MAX),
    rateLimitWindowMs: parseRateLimitWindowMs(env.RATE_LIMIT_WINDOW_MS),
    tlsKeyPath,
    tlsCertPath,
  };
}
