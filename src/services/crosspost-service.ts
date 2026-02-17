import { HttpProblem } from "../problem.js";
import { publishToBluesky } from "../platforms/bluesky.js";
import { publishToMastodon } from "../platforms/mastodon.js";
import { publishToX } from "../platforms/x.js";
import {
  CrosspostDispatchResult,
  PlatformName,
  PublishRequest,
  TargetDelivery,
} from "../types.js";
import { PreflightService } from "./preflight-service.js";

function extractErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message) {
    return error.message;
  }

  return "Unknown publishing error";
}

export class CrosspostService {
  constructor(private readonly preflightService: PreflightService) {}

  async dispatch(publishRequest: PublishRequest): Promise<CrosspostDispatchResult> {
    await this.preflightService.validate(publishRequest);

    const deliveries: Partial<Record<PlatformName, TargetDelivery>> = {};

    const tasks: Array<Promise<void>> = [];

    if (publishRequest.targets.x) {
      tasks.push(
        this.runTarget("x", deliveries, () =>
          publishToX(publishRequest.targets.x!, publishRequest.segments),
        ),
      );
    }

    if (publishRequest.targets.bluesky) {
      tasks.push(
        this.runTarget("bluesky", deliveries, () =>
          publishToBluesky(publishRequest.targets.bluesky!, publishRequest.segments),
        ),
      );
    }

    if (publishRequest.targets.mastodon) {
      tasks.push(
        this.runTarget("mastodon", deliveries, () =>
          publishToMastodon(publishRequest.targets.mastodon!, publishRequest.segments),
        ),
      );
    }

    await Promise.all(tasks);

    const targetResults = Object.values(deliveries);
    const successCount = targetResults.filter((item) => item?.ok).length;
    const failureCount = targetResults.length - successCount;

    if (targetResults.length === 0 || successCount === 0) {
      throw new HttpProblem({
        type: "https://api.crosspost.local/problems/delivery-failed",
        title: "Delivery failed",
        status: 502,
        detail:
          "None of the target platforms accepted the post. Check per-platform error details.",
      });
    }

    return {
      overall: failureCount === 0 ? "success" : "partial",
      postedAt: new Date().toISOString(),
      clientRequestId: publishRequest.clientRequestId,
      deliveries,
    };
  }

  private async runTarget(
    platform: PlatformName,
    deliveries: Partial<Record<PlatformName, TargetDelivery>>,
    operation: () => Promise<TargetDelivery>,
  ): Promise<void> {
    try {
      deliveries[platform] = await operation();
    } catch (error) {
      deliveries[platform] = {
        ok: false,
        platform,
        error: extractErrorMessage(error),
      };
    }
  }
}
