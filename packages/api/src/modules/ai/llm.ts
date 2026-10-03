import type { TrainingStats } from "@curvelo/shared";
import { formatDistance, formatPace } from "./stats.js";
import { LocalAnalyst, type AlumniDigestInput, type InsightProvider, type NarrativeInput, type RaceNarrativeInput } from "./providers.js";
import { config } from "../../config.js";

/**
 * LLM-backed insight provider (Anthropic Messages API). Activated only when
 * AI_API_KEY is set; otherwise the local analyst is used. The model receives
 * the computed stats as JSON and is instructed to stay grounded in them —
 * it writes narrative, never data.
 */
export class LlmProvider implements InsightProvider {
  readonly name = "llm" as const;

  private async complete(system: string, user: string): Promise<string> {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": config.aiApiKey!,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: config.aiModel,
        max_tokens: 600,
        system,
        messages: [{ role: "user", content: user }],
      }),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`AI provider error ${res.status}: ${text.slice(0, 200)}`);
    }
    const data = (await res.json()) as {
      content: Array<{ type: string; text?: string }>;
    };
    const text = data.content
      .filter((b) => b.type === "text" && b.text)
      .map((b) => b.text!)
      .join("\n");
    if (!text) throw new Error("AI provider returned no text");
    return text;
  }

  private statsContext(input: NarrativeInput): string {
    const s: TrainingStats = input.stats;
    return JSON.stringify({
      athlete: input.athleteName,
      period_days: input.periodDays,
      sessions: s.sessions,
      active_days: s.activeDays,
      total_distance: formatDistance(s.totalDistanceM),
      total_duration_min: Math.round(s.totalDurationS / 60),
      avg_pace: formatPace(s.avgPaceSecPerKm),
      streak_days: s.streakDays,
      longest_run: formatDistance(s.longestRunM),
      avg_rpe: s.avgRpe,
      assignments_completed: `${s.assignmentsCompleted}/${s.assignmentsTotal}`,
      pace_trend: s.paceTrend,
    });
  }

  async athleteNarrative(input: NarrativeInput) {
    const system =
      "You are an assistant running coach. You receive verified training stats as JSON. " +
      "Write concise, encouraging, coach-useful observations. Never invent numbers — only use the stats given. " +
      "Keep each bullet under 20 words. Respond in exactly three sections: HIGHLIGHTS (bullets), WATCH OUTS (bullets), NARRATIVE (2-3 sentences).";
    const raw = await this.complete(system, this.statsContext(input));

    const highlights: string[] = [];
    const watchOuts: string[] = [];
    let narrative = "";
    let section: "h" | "w" | "n" | null = null;
    for (const line of raw.split("\n")) {
      const t = line.trim();
      if (/^highlights/i.test(t)) { section = "h"; continue; }
      if (/^watch/i.test(t)) { section = "w"; continue; }
      if (/^narrative/i.test(t)) { section = "n"; continue; }
      const clean = t.replace(/^[-*•\d.)\s]+/, "").trim();
      if (!clean) continue;
      if (section === "h") highlights.push(clean);
      else if (section === "w") watchOuts.push(clean);
      else if (section === "n") narrative += (narrative ? " " : "") + clean;
    }
    if (!narrative) narrative = raw.slice(0, 400);
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
    const system =
      "You are an assistant running coach writing a short weekly team digest for a head coach. " +
      "Use only the data given. Two to four sentences, plain language, name athletes who need check-ins.";
    return this.complete(
      system,
      JSON.stringify({ team: teamName, period_days: periodDays, athletes: rows }),
    );
  }

  async raceNarrative(input: RaceNarrativeInput) {
    const system =
      "You are an assistant running coach. You receive a deterministic analysis of one race as JSON — " +
      "pacing verdict, splits, place, and history comparison are all verified numbers. " +
      "Write a 2-3 sentence race recap plus 1-3 coaching cues. Never invent numbers — only use the data given. " +
      "Respond in exactly two sections: NARRATIVE (2-3 sentences), CUES (bullets, each under 20 words).";
    const raw = await this.complete(
      system,
      JSON.stringify({
        athlete: input.athleteName,
        race: input.raceName,
        distance: input.distanceLabel,
        pacing_verdict: input.analysis.pacingVerdict,
        verdict_detail: input.analysis.verdictDetail,
        fade_or_kick: input.analysis.fadeOrKick,
        vs_previous: input.analysis.vsPrevious,
        highlights: input.analysis.highlights,
        coaching_cues: input.analysis.coachingCues,
      }),
    );
    const cues: string[] = [];
    let narrative = "";
    let section: "n" | "c" | null = null;
    for (const line of raw.split("\n")) {
      const t = line.trim();
      if (/^narrative/i.test(t)) { section = "n"; continue; }
      if (/^cues/i.test(t)) { section = "c"; continue; }
      const clean = t.replace(/^[-*•\d.)\s]+/, "").trim();
      if (!clean) continue;
      if (section === "n") narrative += (narrative ? " " : "") + clean;
      else if (section === "c") cues.push(clean);
    }
    if (!narrative) narrative = raw.slice(0, 400);
    return { narrative, cues: cues.length > 0 ? cues : input.analysis.coachingCues };
  }

  async alumniDigest(input: AlumniDigestInput) {
    const system =
      "You write alumni updates for a youth running team. You receive verified team highlights as JSON — " +
      "milestones, shoutouts, welcomes, and announcements. Write a warm, upbeat update for former team members " +
      "(alumni). Text only, no photos. Keep it under 200 words. Never invent names, achievements, or events — " +
      "only use the highlights given. Do not include training details like paces or workout specifics.";
    const raw = await this.complete(
      system,
      JSON.stringify({
        team: input.teamName,
        days: input.days,
        highlights: input.highlights,
      }),
    );
    return { draft: raw.slice(0, 2000) };
  }
}

export function selectProvider(): InsightProvider {
  if (config.aiApiKey && config.aiModel) return new LlmProvider();
  return new LocalAnalyst();
}
