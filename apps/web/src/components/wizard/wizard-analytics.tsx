"use client";

import { useEffect, useRef } from "react";
import { useAnalytics } from "@/components/analytics-provider";

/**
 * Reports a completed wizard run.
 *
 * The answers are the whole point of recording it. Which questions actually
 * change the outcome, and which answer sets come back with a relaxed
 * constraint — that is, which coffees people ask for and we do not stock — are
 * both things only this event can tell us, and the second one is a stocking
 * decision waiting to be made.
 *
 * Nothing here identifies anybody: the answers are five enumerated values, the
 * facts used are names of criteria, and no part of the payload is derived from
 * the visitor.
 */
export function WizardAnalytics({
  system,
  taste,
  volume,
  budget,
  requirements,
  resultCount,
  relaxed,
  factsUsed,
}: {
  system: string;
  taste: string | null;
  volume: string | null;
  budget: string | null;
  requirements: readonly string[];
  resultCount: number;
  relaxed: readonly string[];
  /** `result.factsUsed` from the scorer. */
  factsUsed: readonly string[];
}) {
  const analytics = useAnalytics();
  const reported = useRef(false);

  useEffect(() => {
    // Strict mode mounts twice in development; one run is one event.
    if (reported.current) return;
    reported.current = true;

    analytics.track({
      name: "wizard_completed",
      system,
      taste,
      volume,
      budget,
      requirements: [...requirements].sort().join(","),
      resultCount,
      relaxed: [...relaxed].sort().join(","),
      factsUsed: factsUsed.join(","),
    });
  }, [analytics, system, taste, volume, budget, requirements, resultCount, relaxed, factsUsed]);

  return null;
}
