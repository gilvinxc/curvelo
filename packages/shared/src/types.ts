export * from "./constants.js";
export * from "./schemas/auth.js";
export * from "./schemas/teams.js";
export * from "./schemas/invitations.js";

/** Shape of the authenticated session returned by /auth/me. */
export interface SessionUser {
  id: string;
  email: string;
  displayName: string;
  systemRole: string | null;
  memberships: Array<{
    teamId: string;
    teamName: string;
    teamSlug: string;
    role: string;
    status: string;
  }>;
}

/** Public team shape returned by team endpoints. */
export interface TeamDTO {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  visibility: string;
  memberCount: number;
  myRole: string | null;
  createdAt: string;
}

/** Roster entry. Coaches see emails; runners see names only (privacy). */
export interface RosterMemberDTO {
  userId: string;
  displayName: string;
  email?: string;
  role: string;
  status: string;
  joinedAt: string;
}

/** Invitation as returned to the inviting coach (includes the token once). */
export interface InvitationDTO {
  id: string;
  teamId: string;
  teamName: string;
  email: string;
  role: string;
  status: string;
  expiresAt: string;
  token?: string; // only on creation
}

/** Public invitation preview (no auth required). */
export interface InvitationPreviewDTO {
  teamName: string;
  teamSlug: string;
  role: string;
  expiresAt: string;
  invitedEmail: string;
  status: string;
}
