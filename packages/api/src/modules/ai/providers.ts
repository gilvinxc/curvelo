import type { TrainingStats } from "@curvelo/shared";
import { formatDistance, formatPace } from "./stats.js";
import type { DeterministicRaceAnalysis } from "./raceAnalysis.js";

export interface NarrativeInput {
  athleteName: string;
  periodDays: number;
  stats: TrainingStats;
}

export interface RaceNarrativeInput {
  athleteName: string;
  raceName: string;
  distanceLabel: string;
  analysis: DeterministicRaceAnalysis;
}

/**
 * A coaching-insight provider. The local analyst is deterministic and
 * rule-based (no API key needed); the LLM provider writes richer narrative
 * from the same stats. Both return grounded, data-derived insights —
 * the AI assists the coach, it never invents training data.
 */
export interface InsightProvider {
  readonly name: "local" | "llm";
  athleteNarrative(input: NarrativeInput): Promise<{
    highlights: string[];
    watchOuts: string[];
    narrative: string;
  }>;
  teamSummary(
    teamName: string,
    periodDays: number,
    rows: Array<{
      athleteName: string;
      sessions: number;
      activeDays: number;
      completionRate: number | null;
      status: string;
    }>,
  ): Promise<string>;
  /**
   * Narrate one race. The analysis is deterministic and data-derived;
   * the provider only writes the words around it.
   */
  raceNarrative(input: RaceNarrativeInput): Promise<{
    narrative: string;
    cues: string[];
  }>;
  /**
   * Draft an alumni-facing team update from verified highlights.
   * Text only, no photos. The coach always reviews before publishing —
   * the AI drafts, never sends.
   */
  alumniDigest(input: AlumniDigestInput): Promise<{ draft: string }>;
  /**
   * Draft a parent-friendly weekly recap from verified team stats.
   * Text only. The coach always reviews before publishing — the AI drafts,
   * never sends.
   */
  weeklyRecap(input: WeeklyRecapInput): Promise<{ draft: string }>;
}

/** Verified highlights the alumni digest may draw from. */
export interface AlumniDigestInput {
  teamName: string;
  days: number;
  highlights: Array<{
    kind: "MILESTONE" | "SHOUTOUT" | "WELCOME" | "ANNOUNCEMENT";
    text: string;
    date: string;
  }>;
}

/** Verified weekly stats the parent recap may draw from. */
export interface WeeklyRecapInput {
  teamName: string;
  weekLabel: string;
  totalMiles: number;
  runCount: number;
  races: Array<{
    athleteFirstName: string;
    raceName: string;
    distanceLabel: string;
    timeLabel: string;
    place: number | null;
    date: string;
  }>;
  highlights: Array<{
    kind: "MILESTONE" | "SHOUTOUT" | "WELCOME";
    text: string;
    date: string;
  }>;
}

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

export class LocalAnalyst implements InsightProvider {
  readonly name = "local" as const;

  async athleteNarrative(input: NarrativeInput) {
    const { athleteName, periodDays, stats: s } = input;
    const highlights: string[] = [];
    const watchOuts: string[] = [];

    if (s.sessions === 0) {
      watchOuts.push(`No training logged in the last ${periodDays} days.`);
    } else {
      highlights.push(
        `${plural(s.sessions, "session", "sessions")} across ${plural(s.activeDays, "active day", "active days")} — ${formatDistance(s.totalDistanceM)} total.`,
      );
      if (s.streakDays >= 3) {
        highlights.push(`On a ${s.streakDays}-day activity streak. Keep the momentum.`);
      }
      if (s.paceTrend === "improving") {
        highlights.push("Average run pace is trending faster — fitness is building.");
      }
      if (s.completionRate !== null && s.completionRate >= 0.8) {
        highlights.push(
          `Assigned-workout completion at ${Math.round(s.completionRate * 100)}% — excellent compliance.`,
        );
      }
      if (s.longestRunM >= 8000) {
        highlights.push(`Longest run ${formatDistance(s.longestRunM)} — solid aerobic base work.`);
      }
    }

    if (s.paceTrend === "declining" && s.sessions >= 4) {
      watchOuts.push("Pace is trending slower — could be fatigue, heat, or hilly routes. Worth a check-in.");
    }
    if (s.avgRpe !== null && s.avgRpe >= 8 && s.sessions >= 3) {
      watchOuts.push(`Average RPE ${s.avgRpe.toFixed(1)}/10 is high — watch for overreaching.`);
    }
    if (s.completionRate !== null && s.completionRate < 0.5 && s.assignmentsTotal >= 3) {
      watchOuts.push(
        `Only ${Math.round(s.completionRate * 100)}% of assigned workouts completed — find out what's getting in the way.`,
      );
    }
    if (s.sessions > 0 && s.activeDays <= Math.max(1, Math.floor(periodDays / 7))) {
      watchOuts.push("Training is bunched into few days — more frequent, easier sessions usually beat heroic weekends.");
    }

    const first = athleteName.split(" ")[0];
    let narrative: string;
    if (s.sessions === 0) {
      narrative = `${first} hasn't logged anything in ${periodDays} days. A quick check-in matters more than any workout right now.`;
    } else {
      const pace = s.avgPaceSecPerKm ? ` at an average ${formatPace(s.avgPaceSecPerKm)}` : "";
      narrative =
        `${first} logged ${plural(s.sessions, "session", "sessions")} (${formatDistance(s.totalDistanceM)}${pace}) over the last ${periodDays} days` +
        (s.streakDays >= 2 ? `, including a ${s.streakDays}-day streak` : "") +
        (s.paceTrend === "improving"
          ? ", with pace trending in the right direction."
          : s.paceTrend === "declining"
            ? ", though pace has softened lately."
            : ".");
      if (watchOuts.length > 0) narrative += " One thing to watch.";
    }

    return { highlights, watchOuts, narrative };
  }

  async teamSummary(
    teamName: string,
    periodDays: number,
    rows: Array<{
      athleteName: string;
      sessions: number;
      activeDays: number;
      completionRate: number | null;
      status: string;
    }>,
  ): Promise<string> {
    const total = rows.length;
    if (total === 0) return `${teamName} has no athletes with insight data yet.`;
    const onTrack = rows.filter((r) => r.status === "on-track").length;
    const quiet = rows.filter((r) => r.status === "quiet").map((r) => r.athleteName.split(" ")[0]);
    const attention = rows.filter((r) => r.status === "needs-attention").map((r) => r.athleteName.split(" ")[0]);
    const sessions = rows.reduce((s, r) => s + r.sessions, 0);

    let summary = `${teamName}: ${onTrack}/${total} athletes on track over the last ${periodDays} days, ${sessions} sessions logged in total.`;
    if (quiet.length > 0) {
      summary += ` Quiet: ${quiet.slice(0, 5).join(", ")}${quiet.length > 5 ? ` (+${quiet.length - 5} more)` : ""} — worth a check-in.`;
    }
    if (attention.length > 0) {
      summary += ` Needs attention: ${attention.slice(0, 5).join(", ")}${attention.length > 5 ? ` (+${attention.length - 5} more)` : ""}.`;
    }
    return summary;
  }

  async raceNarrative(input: RaceNarrativeInput) {
    const { athleteName, raceName, distanceLabel, analysis: a } = input;
    const first = athleteName.split(" ")[0];
    let narrative = `${first}'s ${distanceLabel} at ${raceName}: ${a.verdictDetail}`;
    if (a.fadeOrKick) narrative += ` They ${a.fadeOrKick}.`;
    if (a.vsPrevious) narrative += ` ${a.vsPrevious}.`;
    return { narrative, cues: a.coachingCues };
  }

  async weeklyRecap(input: WeeklyRecapInput) {
    const { teamName, weekLabel, totalMiles, runCount, races, highlights } = input;
    const lines: string[] = [];
    lines.push(`Hi ${teamName} families! Here's the week of ${weekLabel}:`);
    lines.push("");
    lines.push(
      `The team logged ${plural(runCount, "run", "runs")} totaling ${totalMiles.toFixed(1)} miles.`,
    );
    for (const r of races.slice(0, 8)) {
      const place = r.place ? ` (place ${r.place})` : "";
      lines.push(
        `- ${r.athleteFirstName} raced the ${r.distanceLabel} at ${r.raceName} in ${r.timeLabel}${place}.`,
      );
    }
    for (const h of highlights.slice(0, 8)) {
      lines.push(`- ${h.text}`);
    }
    lines.push("");
    lines.push("Thanks for cheering the team on — see you at practice!");
    return { draft: lines.join("\n") };
  }

  async alumniDigest(input: AlumniDigestInput) {
    const { teamName, days, highlights } = input;
    if (highlights.length === 0) {
      return {
        draft: `Hi ${teamName} alumni! Quiet ${days} days on the team front — no new milestones or shoutouts to report. Check back next time.`,
      };
    }
    const lines = highlights.map((h) => `- ${h.text}`);
    return {
      draft:
        `Hi ${teamName} alumni! Here's what the team has been up to over the last ${days} days:\n\n` +
        lines.join("\n") +
        `\n\nKeep cheering — the team appreciates you.`,
    };
  }
}
