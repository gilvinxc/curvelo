import type {
  AcceptGuardianInviteInput,
  ActivityDTO,
  ActivityStatsDTO,
  AssignmentDTO,
  AthleteInsight,
  AthleteViewDTO,
  ChatMessageDTO,
  ChildSummaryDTO,
  CommentDTO,
  ConsentDTO,
  ConversationDTO,
  CreateTeamInput,
  GuardianInviteDTO,
  GoalDTO,
  GuardianLinkDTO,
  InvitationDTO,
  InvitationPreviewDTO,
  InviteGuardianInput,
  JoinLinkDTO,
  JoinLinkPreviewDTO,
  JoinRequestDTO,
  LeaderboardDTO,
  PersonalRecordDTO,
  PostDTO,
  ProgressDTO,
  RaceAnalysisDTO,
  RaceResultDTO,
  RegisterInput,
  ReportDTO,
  RosterMemberDTO,
  SessionUser,
  ShoeDTO,
  TeamDigest,
  TeamDTO,
  TeamRecordDTO,
  TeamGroupDTO,
  TeamRole,
  UpdateProfileInput,
  WorkoutDTO,
} from "@curvelo/shared";

export const BASE_URL =
  import.meta.env.VITE_API_URL ?? "http://localhost:4000/api/v1";

export class ApiError extends Error {
  readonly code: string;
  readonly status: number;
  readonly details?: unknown;

  constructor(message: string, code: string, status: number, details?: unknown) {
    super(message);
    this.name = "ApiError";
    this.code = code;
    this.status = status;
    this.details = details;
  }

  get isUnauthorized(): boolean {
    return this.status === 401;
  }
}

interface ErrorBody {
  error?: { code?: string; message?: string; details?: unknown };
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const hasBody = init.body !== undefined && init.body !== null;
  const headers: Record<string, string> = {
    ...(init.headers as Record<string, string> | undefined),
  };
  if (hasBody && !headers["Content-Type"]) {
    headers["Content-Type"] = "application/json";
  }
  let res: Response;
  try {
    res = await fetch(`${BASE_URL}${path}`, {
      credentials: "include",
      headers,
      ...init,
    });
  } catch {
    throw new ApiError(
      "Couldn't reach the Curvelo API. Make sure it's running on port 4000.",
      "NETWORK_ERROR",
      0,
    );
  }

  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    // non-JSON body — handled below via status
  }

  if (!res.ok) {
    const err = (body as ErrorBody | null)?.error;
    throw new ApiError(
      err?.message ?? `Request failed (${res.status})`,
      err?.code ?? "UNKNOWN",
      res.status,
      err?.details,
    );
  }
  return body as T;
}

const post = <T>(path: string, payload?: unknown): Promise<T> =>
  request<T>(path, {
    method: "POST",
    body: payload === undefined ? undefined : JSON.stringify(payload),
  });

const patch = <T>(path: string, payload: unknown): Promise<T> =>
  request<T>(path, { method: "PATCH", body: JSON.stringify(payload) });

const del = <T>(path: string): Promise<T> =>
  request<T>(path, { method: "DELETE" });

const put = <T>(path: string, payload: unknown): Promise<T> =>
  request<T>(path, { method: "PUT", body: JSON.stringify(payload) });

/** Full user + profile shape returned by GET/PATCH /users/me. */
export interface FullUser {
  id: string;
  email: string;
  displayName: string;
  systemRole: string | null;
  dateOfBirth: string | null;
  profile: {
    id: string;
    avatarUrl: string | null;
    bio: string | null;
    city: string | null;
    units: "metric" | "imperial";
    defaultShareLevel: string | null;
    phone: string | null;
    emergencyName: string | null;
    emergencyPhone: string | null;
  } | null;
}

/** Payload for creating/updating a workout. Units are canonical (meters, seconds). */
export interface WorkoutStepPayload {
  kind: string;
  distanceM?: number;
  durationS?: number;
  targetPaceS?: number;
  targetHrBpm?: number;
  targetRpe?: number;
  repetitions?: number;
  notes?: string;
}

export interface CreateWorkoutPayload {
  title: string;
  description?: string;
  kind?: string;
  isTemplate?: boolean;
  steps: WorkoutStepPayload[];
}

export interface UpdateWorkoutPayload {
  title?: string;
  description?: string | null;
  kind?: string;
  isTemplate?: boolean;
  steps?: WorkoutStepPayload[];
}

export interface CreateAssignmentPayload {
  workoutId: string;
  groupId?: string;
  assignedToUserId?: string;
  scheduledDate: string; // YYYY-MM-DD
  notes?: string;
}

export interface CreateActivityPayload {
  kind?: string;
  title?: string;
  startedAt: string; // ISO datetime
  distanceM?: number;
  durationS?: number;
  avgHrBpm?: number;
  maxHrBpm?: number;
  effortRpe?: number;
  calories?: number;
  notes?: string;
  teamId?: string;
  assignmentId?: string;
  visibility?: "PRIVATE" | "TEAM";
  shoeId?: string | null;
}

export interface UpdateActivityPayload {
  kind?: string;
  title?: string | null;
  startedAt?: string;
  distanceM?: number;
  durationS?: number;
  avgHrBpm?: number;
  maxHrBpm?: number;
  effortRpe?: number;
  calories?: number;
  notes?: string | null;
  teamId?: string | null;
  assignmentId?: string | null;
  visibility?: "PRIVATE" | "TEAM";
  shoeId?: string | null;
}

/** Public preview of a guardian invite — no email or token included. */
export interface GuardianInvitePreviewDTO {
  teamName: string;
  athleteName: string;
  relationship: string;
  status: string;
  expiresAt: string;
}

export const api = {
  // auth
  register: (input: RegisterInput) =>
    post<{ user: SessionUser }>("/auth/register", input),
  login: (input: { email: string; password: string }) =>
    post<{ user: SessionUser }>("/auth/login", input),
  logout: () => post<{ ok: boolean }>("/auth/logout"),
  me: () => request<{ user: SessionUser }>("/auth/me"),

  // users
  getProfile: () => request<{ user: FullUser }>("/users/me"),
  updateProfile: (input: UpdateProfileInput) =>
    patch<{ user: FullUser }>("/users/me", input),

  // teams
  listTeams: () => request<{ teams: TeamDTO[] }>("/teams"),
  getTeam: (id: string) => request<{ team: TeamDTO }>(`/teams/${id}`),
  createTeam: (input: CreateTeamInput) =>
    post<{ team: TeamDTO }>("/teams", input),
  getRoster: (id: string) =>
    request<{ roster: RosterMemberDTO[] }>(`/teams/${id}/roster`),

  // invitations
  createInvitation: (teamId: string, input: { email: string; role: TeamRole }) =>
    post<{ invitation: InvitationDTO }>(`/teams/${teamId}/invitations`, input),
  previewInvitation: (token: string) =>
    request<{ invitation: InvitationPreviewDTO }>(`/invitations/${token}`),
  acceptInvitation: (token: string) =>
    post<{ teamId: string; role: string }>(`/invitations/${token}/accept`),

  // shareable join links
  createJoinLink: (teamId: string, input: { expiresInDays: number; maxUses?: number }) =>
    post<{ link: JoinLinkDTO }>(`/teams/${teamId}/join-links`, input),
  listJoinLinks: (teamId: string) =>
    request<{ links: JoinLinkDTO[] }>(`/teams/${teamId}/join-links`),
  revokeJoinLink: (teamId: string, linkId: string) =>
    post<{ ok: boolean }>(`/teams/${teamId}/join-links/${linkId}/revoke`),
  previewJoinLink: (token: string) =>
    request<{ link: JoinLinkPreviewDTO }>(`/join/${token}`),
  requestJoin: (token: string) =>
    post<{ requestId: string; teamId: string; teamName: string }>(
      `/join/${token}/request`,
    ),
  listJoinRequests: (teamId: string) =>
    request<{ requests: JoinRequestDTO[] }>(`/teams/${teamId}/join-requests`),
  approveJoinRequest: (teamId: string, requestId: string, role: TeamRole) =>
    post<{ ok: boolean; role: string }>(
      `/teams/${teamId}/join-requests/${requestId}/approve`,
      { role },
    ),
  denyJoinRequest: (teamId: string, requestId: string) =>
    post<{ ok: boolean }>(`/teams/${teamId}/join-requests/${requestId}/deny`),

  // member management
  updateMemberRole: (teamId: string, userId: string, role: TeamRole) =>
    patch<{ ok: boolean; role: string }>(`/teams/${teamId}/members/${userId}`, {
      role,
    }),
  removeMember: (teamId: string, userId: string) =>
    del<{ ok: boolean }>(`/teams/${teamId}/members/${userId}`),
  transferTeam: (teamId: string, newOwnerId: string) =>
    post<{ ok: boolean; newOwnerId: string }>(`/teams/${teamId}/transfer`, {
      newOwnerId,
    }),

  // workouts
  listWorkouts: (teamId: string, templatesOnly = false) =>
    request<{ workouts: WorkoutDTO[] }>(
      `/teams/${teamId}/workouts${templatesOnly ? "?templatesOnly=true" : ""}`,
    ),
  createWorkout: (teamId: string, input: CreateWorkoutPayload) =>
    post<{ workout: WorkoutDTO }>(`/teams/${teamId}/workouts`, input),
  getWorkout: (id: string) => request<{ workout: WorkoutDTO }>(`/workouts/${id}`),
  updateWorkout: (id: string, input: UpdateWorkoutPayload) =>
    patch<{ workout: WorkoutDTO }>(`/workouts/${id}`, input),
  deleteWorkout: (id: string) => del<{ ok: boolean }>(`/workouts/${id}`),

  // groups
  listGroups: (teamId: string) =>
    request<{ groups: TeamGroupDTO[] }>(`/teams/${teamId}/groups`),
  createGroup: (teamId: string, input: { name: string; memberIds: string[] }) =>
    post<{ group: TeamGroupDTO }>(`/teams/${teamId}/groups`, input),
  getGroup: (groupId: string) =>
    request<{ group: TeamGroupDTO }>(`/groups/${groupId}`),
  addGroupMembers: (groupId: string, memberIds: string[]) =>
    post<{ group: TeamGroupDTO }>(`/groups/${groupId}/members`, { memberIds }),
  removeGroupMember: (groupId: string, userId: string) =>
    del<{ group: TeamGroupDTO }>(`/groups/${groupId}/members/${userId}`),
  deleteGroup: (groupId: string) => del<{ ok: boolean }>(`/groups/${groupId}`),

  // assignments + calendars
  createAssignment: (teamId: string, input: CreateAssignmentPayload) =>
    post<{ assignment: AssignmentDTO }>(`/teams/${teamId}/assignments`, input),
  deleteAssignment: (assignmentId: string) =>
    del<{ ok: boolean }>(`/assignments/${assignmentId}`),
  teamCalendar: (teamId: string, from: string, to: string) =>
    request<{ assignments: AssignmentDTO[]; activities: ActivityDTO[] }>(
      `/teams/${teamId}/calendar?from=${from}&to=${to}`,
    ),
  myCalendar: (from: string, to: string) =>
    request<{ assignments: AssignmentDTO[]; activities: ActivityDTO[] }>(
      `/users/me/calendar?from=${from}&to=${to}`,
    ),

  // activities
  createActivity: (input: CreateActivityPayload) =>
    post<{ activity: ActivityDTO }>("/activities", input),
  listActivities: (from: string, to: string, teamId?: string) =>
    request<{ activities: ActivityDTO[] }>(
      `/activities?from=${from}&to=${to}${teamId ? `&teamId=${teamId}` : ""}`,
    ),
  getActivity: (id: string) =>
    request<{ activity: ActivityDTO }>(`/activities/${id}`),
  updateActivity: (id: string, input: UpdateActivityPayload) =>
    patch<{ activity: ActivityDTO }>(`/activities/${id}`, input),
  deleteActivity: (id: string) => del<{ ok: boolean }>(`/activities/${id}`),
  myStats: (from: string, to: string) =>
    request<{ stats: ActivityStatsDTO }>(
      `/users/me/stats?from=${from}&to=${to}`,
    ),

  // goals + leaderboard + analytics
  createGoal: (input: {
    kind: "DISTANCE" | "SESSIONS" | "STREAK";
    period: "WEEK" | "MONTH" | "CUSTOM";
    target: number;
    title?: string;
    recurring?: boolean;
    shareOnComplete?: boolean;
    feedTeamId?: string;
    startAt?: string;
    endAt?: string;
  }) => post<{ goal: GoalDTO }>("/goals", input),
  myGoals: () => request<{ goals: GoalDTO[] }>("/goals"),
  archiveGoal: (goalId: string) => del<{ ok: boolean }>(`/goals/${goalId}`),
  createTeamGoal: (
    teamId: string,
    input: { kind: "DISTANCE" | "SESSIONS"; title: string; target: number; startAt: string; endAt: string },
  ) => post<{ goal: GoalDTO }>(`/teams/${teamId}/goals`, input),
  teamGoals: (teamId: string) =>
    request<{ goals: GoalDTO[] }>(`/teams/${teamId}/goals`),
  archiveTeamGoal: (teamId: string, goalId: string) =>
    del<{ ok: boolean }>(`/teams/${teamId}/goals/${goalId}`),
  leaderboard: (teamId: string, metric: "distance" | "sessions", days = 7) =>
    request<{ leaderboard: LeaderboardDTO }>(
      `/teams/${teamId}/leaderboard?metric=${metric}&days=${days}`,
    ),
  myProgress: (weeks = 12) =>
    request<{ progress: ProgressDTO }>(`/users/me/progress?weeks=${weeks}`),
  myInsights: () => request<{ insight: AthleteInsight }>(`/users/me/insights`),
  // race results + records
  createRaceResult: (input: {
    raceName: string;
    distanceM: number;
    durationS: number;
    racedAt: string;
    activityId?: string;
    splits?: Array<{ distanceM: number; durationS: number }>;
    finishPlace?: number;
    ageGroupPlace?: number;
    fieldSize?: number;
  }) => post<{ raceResult: RaceResultDTO }>("/race-results", input),
  myRaceResults: () => request<{ raceResults: RaceResultDTO[] }>("/race-results"),
  deleteRaceResult: (id: string) => del<{ ok: boolean }>(`/race-results/${id}`),
  raceAnalysis: (id: string) =>
    request<{ analysis: RaceAnalysisDTO }>(`/race-results/${id}/analysis`),
  logTeamRace: (input: {
    teamId: string;
    raceName: string;
    distanceM: number;
    racedAt: string;
    fieldSize?: number;
    entries: Array<{
      userId: string;
      durationS: number;
      finishPlace?: number;
      ageGroupPlace?: number;
      splits?: Array<{ distanceM: number; durationS: number }>;
    }>;
  }) =>
    post<{ count: number; raceResultIds: string[] }>(
      "/race-results/team-log",
      input,
    ),
  myRecords: () => request<{ records: PersonalRecordDTO[] }>("/users/me/records"),
  teamRecords: (teamId: string) =>
    request<{ records: TeamRecordDTO[] }>(`/teams/${teamId}/records`),
  // shoes
  createShoe: (input: { name: string; brand?: string; model?: string }) =>
    post<{ shoe: ShoeDTO }>("/shoes", input),
  myShoes: () => request<{ shoes: ShoeDTO[] }>("/shoes"),
  updateShoe: (id: string, input: { name?: string; brand?: string | null; model?: string | null; retired?: boolean }) =>
    patch<{ shoe: ShoeDTO }>(`/shoes/${id}`, input),
  deleteShoe: (id: string) => del<{ ok: boolean }>(`/shoes/${id}`),
  setDefaultShoe: (id: string) =>
    post<{ shoe: ShoeDTO }>(`/shoes/${id}/default`, {}),
  logTeamRun: (input: {
    teamId: string;
    groupId?: string;
    userIds?: string[];
    kind?: string;
    title?: string;
    startedAt: string;
    distanceM?: number;
    durationS?: number;
    notes?: string;
    visibility?: "TEAM" | "PRIVATE";
    overrides?: Array<{
      userId: string;
      distanceM?: number;
      durationS?: number;
    }>;
  }) =>
    post<{ count: number; activityIds: string[] }>(
      "/activities/team-log",
      input,
    ),
  setTeamLogo: (teamId: string, image: string) =>
    put<{ ok: boolean }>(`/teams/${teamId}/logo`, { image }),
  removeTeamLogo: (teamId: string) => del<{ ok: boolean }>(`/teams/${teamId}/logo`),
  teamLogoUrl: (teamId: string) => `${BASE_URL}/teams/${teamId}/logo`,

  // coach athlete view
  getAthlete: (teamId: string, userId: string) =>
    request<{ athlete: AthleteViewDTO }>(
      `/teams/${teamId}/athletes/${userId}`,
    ),

  // team feed
  createPost: (teamId: string, input: { body?: string; activityId?: string }) =>
    post<{ post: PostDTO }>(`/teams/${teamId}/feed`, input),
  listFeed: (teamId: string, before?: string, limit = 20) =>
    request<{ posts: PostDTO[] }>(
      `/teams/${teamId}/feed?limit=${limit}${before ? `&before=${encodeURIComponent(before)}` : ""}`,
    ),
  deletePost: (postId: string) => del<{ ok: boolean }>(`/posts/${postId}`),

  // comments
  createComment: (postId: string, body: string) =>
    post<{ comment: CommentDTO }>(`/posts/${postId}/comments`, { body }),
  listComments: (postId: string) =>
    request<{ comments: CommentDTO[] }>(`/posts/${postId}/comments`),
  deleteComment: (commentId: string) =>
    del<{ ok: boolean }>(`/comments/${commentId}`),

  // reactions (toggle)
  toggleReaction: (postId: string, emoji: string) =>
    post<{ reactions: { emoji: string; count: number }[]; myReactions: string[] }>(
      `/posts/${postId}/reactions`,
      { emoji },
    ),

  // reports / moderation
  reportPost: (postId: string, reason: string) =>
    post<{ report: ReportDTO }>(`/posts/${postId}/report`, { reason }),
  listReports: (teamId: string, status?: string) =>
    request<{ reports: ReportDTO[] }>(
      `/teams/${teamId}/reports${status ? `?status=${status}` : ""}`,
    ),
  resolveReport: (reportId: string, status: "RESOLVED" | "DISMISSED") =>
    post<{ report: ReportDTO }>(`/reports/${reportId}/resolve`, { status }),

  // guardians
  inviteGuardian: (
    teamId: string,
    athleteId: string,
    input: InviteGuardianInput,
  ) =>
    post<{ invite: GuardianInviteDTO }>(
      `/teams/${teamId}/athletes/${athleteId}/guardians/invite`,
      input,
    ),
  getAthleteGuardians: (teamId: string, athleteId: string) =>
    request<{ guardians: GuardianLinkDTO[]; consents: ConsentDTO[] }>(
      `/teams/${teamId}/athletes/${athleteId}/guardians`,
    ),
  previewGuardianInvite: (token: string) =>
    request<{ invite: GuardianInvitePreviewDTO }>(
      `/guardian-invites/${token}/preview`,
    ),
  acceptGuardianInvite: (token: string, input: AcceptGuardianInviteInput) =>
    post<{ link: GuardianLinkDTO }>(`/guardian-invites/${token}/accept`, input),
  revokeGuardianLink: (id: string) => del<{ ok: boolean }>(`/guardian-links/${id}`),
  myChildren: () => request<{ children: ChildSummaryDTO[] }>("/users/me/children"),

  // team messaging
  listConversations: (teamId: string) =>
    request<{ conversations: ConversationDTO[] }>(
      `/teams/${teamId}/conversations`,
    ),
  listMessages: (
    teamId: string,
    conversationId: string,
    opts?: { before?: string; limit?: number },
  ) => {
    const params = new URLSearchParams();
    if (opts?.before) params.set("before", opts.before);
    if (opts?.limit) params.set("limit", String(opts.limit));
    const qs = params.toString();
    return request<{ messages: ChatMessageDTO[]; hasMore: boolean }>(
      `/teams/${teamId}/conversations/${conversationId}/messages${qs ? `?${qs}` : ""}`,
    );
  },
  postMessage: (teamId: string, conversationId: string, body: string) =>
    post<{ message: ChatMessageDTO }>(
      `/teams/${teamId}/conversations/${conversationId}/messages`,
      { body },
    ),
  editMessage: (messageId: string, body: string) =>
    patch<{ message: ChatMessageDTO }>(`/messages/${messageId}`, { body }),
  deleteMessage: (messageId: string) =>
    del<{ ok: boolean }>(`/messages/${messageId}`),

  // AI coaching assistance (coach/admin only)
  getAthleteInsight: (teamId: string, athleteId: string) =>
    request<{ insight: AthleteInsight }>(
      `/teams/${teamId}/athletes/${athleteId}/insights`,
    ),
  getTeamDigest: (teamId: string, days = 28) =>
    request<{ digest: TeamDigest }>(`/teams/${teamId}/digest?days=${days}`),
};
