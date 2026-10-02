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

export interface WorkoutStepDTO {
  id: string;
  order: number;
  kind: string;
  distanceM: number | null;
  durationS: number | null;
  targetPaceS: number | null;
  targetHrBpm: number | null;
  targetRpe: number | null;
  repetitions: number;
  notes: string | null;
}

export interface WorkoutDTO {
  id: string;
  teamId: string;
  title: string;
  description: string | null;
  kind: string;
  isTemplate: boolean;
  createdByName: string;
  steps: WorkoutStepDTO[];
  createdAt: string;
}

export interface TeamGroupDTO {
  id: string;
  teamId: string;
  name: string;
  memberCount: number;
  members?: Array<{ userId: string; displayName: string }>;
}

export interface AssignmentDTO {
  id: string;
  workoutId: string;
  workoutTitle: string;
  workoutKind: string;
  teamId: string;
  teamName: string;
  groupId: string | null;
  groupName: string | null;
  assignedToUserId: string | null;
  assignedToName: string | null;
  scheduledDate: string;
  notes: string | null;
  needsApproval: boolean;
  createdByName: string;
}

export interface ActivityDTO {
  id: string;
  userId: string;
  userName: string;
  teamId: string | null;
  teamName: string | null;
  assignmentId: string | null;
  kind: string;
  title: string | null;
  startedAt: string;
  distanceM: number | null;
  durationS: number | null;
  avgPaceS: number | null;
  avgHrBpm: number | null;
  maxHrBpm: number | null;
  effortRpe: number | null;
  calories: number | null;
  notes: string | null;
  source: string;
  visibility: string;
}

export interface ActivityStatsDTO {
  count: number;
  totalDistanceM: number;
  totalDurationS: number;
  avgPaceS: number | null;
}

export interface AthleteViewDTO {
  userId: string;
  displayName: string;
  role: string;
  stats: ActivityStatsDTO;
  recentActivities: ActivityDTO[];
  upcomingAssignments: AssignmentDTO[];
}

export interface ReactionSummaryDTO {
  emoji: string;
  count: number;
}

export interface PostDTO {
  id: string;
  teamId: string;
  kind: string;
  body: string | null;
  authorId: string;
  authorName: string;
  activity: ActivityDTO | null;
  commentCount: number;
  reactions: ReactionSummaryDTO[];
  myReactions: string[];
  createdAt: string;
}

export interface CommentDTO {
  id: string;
  postId: string;
  authorId: string;
  authorName: string;
  body: string;
  createdAt: string;
}

export interface ReportDTO {
  id: string;
  postId: string;
  postExcerpt: string;
  reporterId: string;
  reporterName: string;
  reason: string;
  status: string;
  createdAt: string;
}

export interface GuardianInviteDTO {
  id: string;
  teamId: string;
  teamName: string;
  athleteId: string;
  athleteName: string;
  email: string;
  relationship: string;
  status: string;
  expiresAt: string;
  token?: string;
}

export interface GuardianLinkDTO {
  id: string;
  guardianId: string;
  guardianName: string;
  guardianEmail: string;
  athleteId: string;
  athleteName: string;
  relationship: string;
  status: string;
  verifiedAt: string | null;
}

export interface ConsentDTO {
  type: string;
  status: string;
  grantedAt: string;
  guardianName: string;
}

export interface ChildSummaryDTO {
  athleteId: string;
  athleteName: string;
  teamId: string;
  teamName: string;
  role: string;
  consentRequired: boolean;
  consents: ConsentDTO[];
  upcomingAssignments: AssignmentDTO[];
  recentActivities: ActivityDTO[];
}
