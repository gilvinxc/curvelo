// Canonical domain constants. The API and web client both import from here.

export const TEAM_ROLES = ["COACH", "RUNNER", "PARENT", "TEAM_ADMIN", "ALUMNI"] as const;
export type TeamRole = (typeof TEAM_ROLES)[number];

export const MEMBERSHIP_STATUSES = ["ACTIVE", "INVITED", "REMOVED"] as const;
export type MembershipStatus = (typeof MEMBERSHIP_STATUSES)[number];

export const INVITATION_STATUSES = ["PENDING", "ACCEPTED", "EXPIRED", "REVOKED"] as const;
export type InvitationStatus = (typeof INVITATION_STATUSES)[number];

export const TEAM_VISIBILITIES = ["PRIVATE", "PUBLIC"] as const;
export type TeamVisibility = (typeof TEAM_VISIBILITIES)[number];

/** Roles a new account can self-select at registration (MVP). */
export const SELF_SIGNUP_ROLES = ["COACH", "RUNNER"] as const;
export type SelfSignupRole = (typeof SELF_SIGNUP_ROLES)[number];

/** Roles a coach/team admin may grant via invitation. */
export const INVITABLE_ROLES: TeamRole[] = ["COACH", "RUNNER", "PARENT", "TEAM_ADMIN", "ALUMNI"];

export const INVITATION_TTL_HOURS = 72;
