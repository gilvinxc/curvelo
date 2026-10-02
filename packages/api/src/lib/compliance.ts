import { db } from "../db.js";
import { audit } from "./audit.js";

export interface ComplianceDecision {
  blocked: boolean;
  needsApproval: boolean;
  matchedRules: Array<{ id: string; name: string; action: string }>;
}

/**
 * Rules engine (MVP scope).
 *
 * Evaluates active ComplianceRules against a proposed action. Currently
 * supports date-range rules (e.g. organizational dead periods) scoped to
 * a team or an entire organization, optionally bounded by athlete age.
 *
 * Later: season scoping, communication-type rules, per-rule metadata.
 */
export async function evaluateWorkoutAssignment(input: {
  teamId: string;
  scheduledDate: Date;
  athleteAge?: number | null;
  actorId?: string;
}): Promise<ComplianceDecision> {
  const team = await db.team.findUnique({
    where: { id: input.teamId },
    select: { organizationId: true },
  });

  const rules = await db.complianceRule.findMany({
    where: {
      isActive: true,
      appliesTo: "WORKOUT_ASSIGNMENT",
      OR: [
        { teamId: input.teamId },
        ...(team?.organizationId
          ? [{ organizationId: team.organizationId, teamId: null }]
          : []),
      ],
    },
  });

  const matched = rules.filter((rule) => {
    // Date-range match: the scheduled date falls inside the rule window.
    // A rule with no window applies always.
    if (rule.startsAt && input.scheduledDate < rule.startsAt) return false;
    if (rule.endsAt && input.scheduledDate > rule.endsAt) return false;
    // Age bounds: match when the athlete is in range, or when the age is
    // unknown (conservative default — youth safety errs toward restriction).
    if (input.athleteAge != null) {
      if (rule.minAge != null && input.athleteAge < rule.minAge) return false;
      if (rule.maxAge != null && input.athleteAge > rule.maxAge) return false;
    }
    return true;
  });

  const decision: ComplianceDecision = {
    blocked: matched.some((r) => r.action === "BLOCK"),
    needsApproval:
      !matched.some((r) => r.action === "BLOCK") &&
      matched.some((r) => r.action === "REQUIRE_APPROVAL"),
    matchedRules: matched.map((r) => ({ id: r.id, name: r.name, action: r.action })),
  };

  if (matched.length > 0) {
    await audit({
      actorId: input.actorId,
      action: decision.blocked
        ? "COMPLIANCE_BLOCKED"
        : "COMPLIANCE_EVALUATED",
      entityType: "ComplianceRule",
      metadata: {
        teamId: input.teamId,
        scheduledDate: input.scheduledDate.toISOString(),
        matched: decision.matchedRules,
        needsApproval: decision.needsApproval,
      },
    });
  }

  return decision;
}

/** Whole years old today from a date of birth. */
export function ageToday(dateOfBirth: Date | null | undefined): number | null {
  if (!dateOfBirth) return null;
  const now = new Date();
  let age = now.getFullYear() - dateOfBirth.getFullYear();
  const m = now.getMonth() - dateOfBirth.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < dateOfBirth.getDate())) age--;
  return age;
}
