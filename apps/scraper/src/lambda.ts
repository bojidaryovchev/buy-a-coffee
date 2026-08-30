import type { Context } from "aws-lambda";
import { Deadline } from "@catalog/shared";
import { commandDiscovery, commandSync } from "./commands.ts";
import { createRuntime } from "./runtime.ts";

/**
 * Scheduled entry point for the recurring catalog sync.
 *
 * It calls exactly the same `commandSync` the CLI calls: there is one
 * implementation of the business logic, and this file only translates between
 * the Lambda invocation contract and that call.
 *
 * The handler returns normally on a circuit-breaker trip rather than throwing.
 * A throw would make the Scheduler retry, and retrying a run that was
 * *deliberately* refused would just repeat the refusal while looking like an
 * infrastructure fault. The alarm fires on the emitted metric instead.
 */

export interface SyncEvent {
  readonly job?: "sync" | "discovery";
  readonly dryRun?: boolean;
  readonly skipImages?: boolean;
  readonly productLimit?: number;
  readonly maxPages?: number;
}

export interface SyncResponse {
  readonly ok: boolean;
  readonly job: string;
  readonly status: string;
  readonly circuitBreakerTripped: boolean;
  readonly counts: Record<string, unknown>;
  readonly durationMs: number;
  readonly requestId: string | null;
}

/** Stop this far before the Lambda timeout so results can still be written. */
const SAFETY_MARGIN_MS = 10_000;

export async function handler(event: SyncEvent = {}, context?: Context): Promise<SyncResponse> {
  const startedAt = Date.now();
  const job = event.job ?? "sync";
  const requestId = context?.awsRequestId ?? null;

  const remaining = context?.getRemainingTimeInMillis?.() ?? Number.POSITIVE_INFINITY;
  const deadline = new Deadline(Math.max(1_000, remaining - SAFETY_MARGIN_MS));

  const runtime = await createRuntime({
    // One connection per container: a Lambda handles one invocation at a time,
    // and idle connections would exhaust the database's slots under scale-out.
    maxConnections: 1,
    context: { requestId, job },
  });

  try {
    if (job === "discovery") {
      const result = await commandDiscovery(runtime, {
        ...(event.maxPages !== undefined ? { maxPages: event.maxPages } : {}),
      });
      const response: SyncResponse = {
        ok: result.crawl.errors.length === 0,
        job,
        status: result.crawl.errors.length === 0 ? "succeeded" : "partial",
        circuitBreakerTripped: false,
        counts: {
          pages: result.crawl.pages.length,
          realPages: result.crawl.pages.filter((page) => !page.isSoft404).length,
          softNotFound: result.crawl.stats.soft404,
          products: result.catalog.products.length,
          errors: result.crawl.errors.length,
        },
        durationMs: Date.now() - startedAt,
        requestId,
      };
      emitMetrics(runtime.config.sourceKey, response);
      return response;
    }

    const result = await commandSync(runtime, {
      ...(event.dryRun !== undefined ? { dryRun: event.dryRun } : {}),
      ...(event.skipImages !== undefined ? { skipImages: event.skipImages } : {}),
      ...(event.productLimit !== undefined ? { productLimit: event.productLimit } : {}),
    });

    if (deadline.expired) {
      runtime.logger.warn("lambda.deadline_exceeded", {
        durationMs: Date.now() - startedAt,
        note: "Sync completed but ran past its safety margin; consider raising the Lambda timeout.",
      });
    }

    const response: SyncResponse = {
      ok: !result.breaker.tripped && result.status === "succeeded",
      job,
      status: result.status,
      circuitBreakerTripped: result.breaker.tripped,
      counts: {
        discovered: result.discovery.products.length,
        ...result.appliedDiff.counts,
        images: result.images,
        parserConfidence: result.discovery.confidence,
        catalogSource: result.discovery.source,
        breakerReasons: result.breaker.reasons,
      },
      durationMs: Date.now() - startedAt,
      requestId,
    };

    emitMetrics(runtime.config.sourceKey, response);
    return response;
  } catch (error) {
    runtime.logger.error("lambda.failed", { job, error });
    // A genuine failure *should* surface to the Scheduler so its DLQ and the
    // Errors alarm both see it.
    throw error;
  } finally {
    await runtime.close();
  }
}

/**
 * Emit metrics via CloudWatch Embedded Metric Format.
 *
 * EMF means metrics are produced by writing one structured log line, with no
 * extra API call, no SDK dependency and no added latency in the handler.
 */
function emitMetrics(sourceKey: string, response: SyncResponse): void {
  const counts = response.counts as Record<string, unknown>;
  const images = (counts.images ?? {}) as Record<string, number>;

  const metrics: Record<string, number> = {
    SyncSuccess: response.ok ? 1 : 0,
    SyncFailure: response.ok ? 0 : 1,
    CircuitBreakerOpen: response.circuitBreakerTripped ? 1 : 0,
    DiscoveredProducts: numberOr(counts.discovered ?? counts.products, 0),
    CreatedProducts: numberOr(counts.created, 0),
    UpdatedProducts: numberOr(counts.updated, 0),
    MissingProducts: numberOr(counts.marked_missing, 0),
    RemovedProducts: numberOr(counts.removed, 0),
    ImagesMirrored: numberOr(images.mirrored, 0),
    ImagesFailed: numberOr(images.failed, 0),
    ParserConfidence: numberOr(counts.parserConfidence, 1),
    DurationMs: response.durationMs,
  };

  process.stdout.write(
    `${JSON.stringify({
      _aws: {
        Timestamp: Date.now(),
        CloudWatchMetrics: [
          {
            Namespace: "KafezonaCatalogSync",
            Dimensions: [["SourceSite", "Job"]],
            Metrics: Object.keys(metrics).map((name) => ({
              Name: name,
              Unit: name === "DurationMs" ? "Milliseconds" : "Count",
            })),
          },
        ],
      },
      SourceSite: sourceKey,
      Job: response.job,
      status: response.status,
      requestId: response.requestId,
      ...metrics,
    })}\n`,
  );
}

function numberOr(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}
