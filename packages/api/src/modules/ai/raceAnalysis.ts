import type {
  RaceAnalysisDTO,
  RaceSplitAnalysis,
} from "@curvelo/shared";

export interface RaceAnalysisInput {
  athleteName: string;
  raceName: string;
  distanceM: number;
  distanceLabel: string;
  durationS: number;
  racedAt: string;
  splits: Array<{ distanceM: number; durationS: number }> | null;
  finishPlace: number | null;
  ageGroupPlace: number | null;
  fieldSize: number | null;
  /** Past results at the same distance, most recent first (excluding this race). */
  history: Array<{ durationS: number; racedAt: string; raceName: string }>;
  personalBestS: number | null;
}

export interface DeterministicRaceAnalysis {
  hasSplits: boolean;
  pacingVerdict: "even" | "positive" | "negative" | "insufficient";
  verdictDetail: string;
  splits: RaceSplitAnalysis[];
  fadeOrKick: string | null;
  vsPrevious: string | null;
  highlights: string[];
  coachingCues: string[];
}

const fmtPct = (pct: number): string => `${Math.abs(Math.round(pct))}%`;

/**
 * Deterministic race analysis. Everything here is computed from the
 * athlete's own official numbers — the AI narrates, it never invents.
 */
export function analyzeRaceDeterministic(
  input: RaceAnalysisInput,
): DeterministicRaceAnalysis {
  const highlights: string[] = [];
  const coachingCues: string[] = [];
  const splits: RaceSplitAnalysis[] = [];

  const avgPacePerM = input.durationS / input.distanceM; // sec per meter

  // --- Splits -------------------------------------------------------------
  let pacingVerdict: DeterministicRaceAnalysis["pacingVerdict"] = "insufficient";
  let verdictDetail =
    "Log per-mile or per-kilometer splits with your next race to unlock pacing analysis.";
  let fadeOrKick: string | null = null;

  const raw = (input.splits ?? []).filter(
    (s) => s.distanceM > 0 && s.durationS > 0,
  );
  if (raw.length >= 2) {
    let cumDist = 0;
    raw.forEach((s, i) => {
      const paceSecPerKm = (s.durationS / s.distanceM) * 1000;
      const vsAvgPct =
        ((paceSecPerKm - avgPacePerM * 1000) / (avgPacePerM * 1000)) * 100;
      splits.push({
        index: i + 1,
        distanceM: s.distanceM,
        durationS: s.durationS,
        paceSecPerKm: Math.round(paceSecPerKm * 10) / 10,
        vsAvgPct: Math.round(vsAvgPct * 10) / 10,
      });
      cumDist += s.distanceM;
    });

    // First half vs second half by distance.
    const halfDist = cumDist / 2;
    let first = { dist: 0, time: 0 };
    let second = { dist: 0, time: 0 };
    let acc = 0;
    for (const s of raw) {
      const segStart = acc;
      const segEnd = acc + s.distanceM;
      acc = segEnd;
      // Attribute the segment proportionally when it straddles the halfway point.
      const firstPart = Math.max(0, Math.min(segEnd, halfDist) - segStart);
      const secondPart = s.distanceM - firstPart;
      first.dist += firstPart;
      first.time += (firstPart / s.distanceM) * s.durationS;
      second.dist += secondPart;
      second.time += (secondPart / s.distanceM) * s.durationS;
    }
    const firstPace = first.time / first.dist;
    const secondPace = second.time / second.dist;
    const driftPct = ((secondPace - firstPace) / firstPace) * 100;

    if (driftPct > 3) {
      pacingVerdict = "positive";
      verdictDetail = `Positive split — the second half was ${fmtPct(driftPct)} slower than the first. You went out faster than you could hold.`;
      coachingCues.push(
        `You went out too fast: the second half faded ${fmtPct(driftPct)}. Next race, aim to run the first half at your goal average pace, not faster — the time you "bank" early almost always gets paid back with interest.`,
      );
    } else if (driftPct < -3) {
      pacingVerdict = "negative";
      verdictDetail = `Negative split — the second half was ${fmtPct(driftPct)} faster than the first. That's textbook racing.`;
      highlights.push("Negative split — textbook pacing");
      coachingCues.push(
        "You finished stronger than you started. That takes discipline — it's the hardest skill in racing and you've got it.",
      );
    } else {
      pacingVerdict = "even";
      verdictDetail = `Even pacing — the two halves were within ${fmtPct(driftPct)} of each other. Very well judged.`;
      highlights.push("Even pacing");
    }

    // Kick or fade on the final split.
    const last = splits[splits.length - 1];
    if (last.vsAvgPct > 8) {
      const unit = last.distanceM >= 1500 ? "mile" : "kilometer";
      fadeOrKick = `faded ${fmtPct(last.vsAvgPct)} over the final ${unit}`;
      if (pacingVerdict !== "positive") {
        coachingCues.push(
          `The final split faded ${fmtPct(last.vsAvgPct)} — you may have left your kick too late or simply emptied the tank getting there.`,
        );
      }
    } else if (last.vsAvgPct < -5) {
      fadeOrKick = `closed ${fmtPct(last.vsAvgPct)} faster than average`;
      highlights.push("Strong finish");
    }

    // Biggest swing between consecutive splits.
    let maxSwing = 0;
    for (let i = 1; i < splits.length; i++) {
      const swing = Math.abs(splits[i].vsAvgPct - splits[i - 1].vsAvgPct);
      if (swing > maxSwing) maxSwing = swing;
    }
    if (maxSwing > 15) {
      coachingCues.push(
        `Your pace swung ${fmtPct(maxSwing)} between consecutive splits — hills, wind, or surging can do that, but smoother is faster on a flat course.`,
      );
    }
  }

  // --- Place ---------------------------------------------------------------
  if (input.finishPlace !== null && input.fieldSize !== null) {
    const pctile = (input.finishPlace / input.fieldSize) * 100;
    highlights.push(
      `Finished ${ordinal(input.finishPlace)} of ${input.fieldSize} (top ${Math.max(1, Math.round(pctile))}%)`,
    );
  } else if (input.finishPlace !== null) {
    highlights.push(`Finished ${ordinal(input.finishPlace)}`);
  }

  // --- vs history ------------------------------------------------------------
  let vsPrevious: string | null = null;
  const prev = input.history[0];
  if (prev) {
    const delta = input.durationS - prev.durationS;
    if (delta < 0) {
      vsPrevious = `${fmtDuration(-delta)} faster than your previous ${input.distanceLabel} (${prev.raceName})`;
      highlights.push("Faster than your last race at this distance");
    } else if (delta > 0) {
      vsPrevious = `${fmtDuration(delta)} slower than your previous ${input.distanceLabel} (${prev.raceName})`;
      coachingCues.push(
        `This was ${fmtDuration(delta)} off your previous ${input.distanceLabel}. One race doesn't define fitness — compare the splits to see whether it was pacing, conditions, or just an off day.`,
      );
    } else {
      vsPrevious = `Exactly matched your previous ${input.distanceLabel} — remarkably consistent.`;
    }
  }
  if (
    input.personalBestS !== null &&
    input.durationS <= input.personalBestS &&
    input.history.length > 0
  ) {
    highlights.push("New personal best!");
  }

  if (!raw.length) {
    coachingCues.push(
      "Log splits with your next race (per mile or per kilometer) to get pacing feedback — did you go out too fast, fade late, or judge it perfectly?",
    );
  }

  return {
    hasSplits: raw.length >= 2,
    pacingVerdict,
    verdictDetail,
    splits,
    fadeOrKick,
    vsPrevious,
    highlights,
    coachingCues,
  };
}

function ordinal(n: number): string {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

function fmtDuration(totalS: number): string {
  const s = Math.round(totalS);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
  return `${m}:${String(sec).padStart(2, "0")}`;
}

/** Shape the deterministic result into the API DTO (narrative filled by the provider). */
export function toRaceAnalysisDTO(
  det: DeterministicRaceAnalysis,
  narrative: string,
  provider: "local" | "llm",
): RaceAnalysisDTO {
  return {
    hasSplits: det.hasSplits,
    pacingVerdict: det.pacingVerdict,
    verdictDetail: det.verdictDetail,
    splits: det.splits,
    fadeOrKick: det.fadeOrKick,
    vsPrevious: det.vsPrevious,
    highlights: det.highlights,
    coachingCues: det.coachingCues,
    narrative,
    provider,
  };
}
