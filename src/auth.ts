import { timingSafeEqual } from "node:crypto";
import { FastifyReply, FastifyRequest, preHandlerHookHandler } from "fastify";

import { HttpProblem } from "./problem.js";

function parseAuthorizationHeader(value: string | undefined): string | null {
  if (!value) {
    return null;
  }

  const [scheme, token] = value.trim().split(/\s+/, 2);
  if (scheme?.toLowerCase() !== "bearer" || !token) {
    return null;
  }

  return token;
}

function matchesApiKey(candidate: string, expected: string): boolean {
  const left = Buffer.from(candidate);
  const right = Buffer.from(expected);

  if (left.length !== right.length) {
    return false;
  }

  return timingSafeEqual(left, right);
}

function hasMatchingKey(candidate: string, apiKeys: Set<string>): boolean {
  for (const expected of apiKeys) {
    if (matchesApiKey(candidate, expected)) {
      return true;
    }
  }

  return false;
}

export function buildApiKeyAuth(apiKeys: Set<string>): preHandlerHookHandler {
  return async function apiKeyAuth(
    request: FastifyRequest,
    _reply: FastifyReply,
  ): Promise<void> {
    const token = parseAuthorizationHeader(request.headers.authorization);
    if (!token || !hasMatchingKey(token, apiKeys)) {
      throw new HttpProblem({
        type: "https://api.crosspost.local/problems/unauthorized",
        title: "Unauthorized",
        status: 401,
        detail: "A valid Bearer API key is required",
        instance: request.url,
      });
    }
  };
}
