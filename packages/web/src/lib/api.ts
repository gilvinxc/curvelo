import type {
  AcceptGuardianInviteInput,
  ActivityDTO,
  ActivityTagDTO,
  AwardDTO,
  AwardType,
  ActivityStatsDTO,
  AssignmentDTO,
  AthleteDocumentStatus,
  AthleteInsight,
  AthleteViewDTO,
  ChatMessageDTO,
  ChildSummaryDTO,
  CommentDTO,
  DocumentDTO,
  PersonalPlanDayDTO,
  PersonalPlanDTO,
  DocumentRequirementDTO,
  AdminAuditDTO,
  AdminStatsDTO,
  AdminTeamDTO,
  AdminUserDTO,
  ConsentDTO,
  CheckInDTO,
  ConversationDTO,
  CreateTeamInput,
  GuardianInviteDTO,
  GoalDTO,
  GuardianLinkDTO,
  FeedbackDTO,
  InjuryDTO,
  InvitationDTO,
  InvitationPreviewDTO,
  InviteGuardianInput,
  JoinLinkDTO,
  JoinLinkPreviewDTO,
  JoinRequestDTO,
  LeaderboardDTO,
  LineupEntryDTO,
  NotificationDTO,
  PhotoDTO,
  AlbumDTO,
  PaceRecordDTO,
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
  TeamEventDTO,
  TeamHealthDTO,
  SeasonDTO,
  ActiveSeasonDTO,
  TeamRecordDTO,
  TeamGroupDTO,
  AttendanceDTO,
  TeamRole,
  TrainingPlanDTO,
  UpdateProfileInput,
  CreatePracticePlanInput,
  CreateTeamEventInput,
  CreateTrainingPlanInput,
  UpdateTeamEventInput,
  UpdateTrainingPlanInput,
  ApplyTrainingPlanInput,
  WorkoutDTO,
} from "@curvelo/shared";

/** Verified place from /places/search. */
export interface Place {
  label: string;
  name: string;
  state: string | null;
  country: string | null;
  lat: number;
  lon: number;
}

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
  return doRequest<T>(path, init, false);
}

/**
 * Core fetch wrapper. On a 401 the access token (15 min) has expired, so we
 * try the refresh endpoint once (30-day rotating refresh cookie) and retry
 * the original request. This is what keeps you signed in between visits.
 */
async function doRequest<T>(
  path: string,
  init: RequestInit,
  retried: boolean,
): Promise<T> {
  const hasBody = init.body !== undefined && init.body !== null;
  const headers: Record<string, string> = {
    ...(init.headers as Record<string, string> | undefined),
  };
  if (hasBody && !headers["Content-Type"] && !(init.body instanceof FormData)) {
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
      "Couldn't reach the Stride Sense API. Make sure it's running on port 4000.",
      "NETWORK_ERROR",
      0,
    );
  }

  // Access token expired: try a silent refresh once, then retry.
  if (res.status === 401 && !retried && path !== "/auth/refresh") {
    try {
      const refreshRes = await fetch(`${BASE_URL}/auth/refresh`, {
        method: "POST",
        credentials: "include",
      });
      if (refreshRes.ok) {
        return doRequest<T>(path, init, true);
      }
    } catch {
      // Refresh failed — fall through to the 401 handling below.
    }
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
    heightCm: number | null;
    weightKg: number | null;
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
  weightKg?: number;
  steps?: number;
  elevationGainM?: number;
  avgCadenceSpm?: number;
  splits?: { distanceM?: number; durationS?: number }[];
  shareToFeed?: boolean;
  taggedUserIds?: string[];
  fromTagId?: string;
  city?: string;
  cityLat?: number;
  cityLon?: number;
  terrain?: string;
  weatherTempC?: number;
  weatherCondition?: string;
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
  weightKg?: number;
  steps?: number;
  elevationGainM?: number;
  avgCadenceSpm?: number;
  splits?: { distanceM?: number; durationS?: number }[];
  shareToFeed?: boolean;
  city?: string;
  cityLat?: number | null;
  cityLon?: number | null;
  terrain?: string;
  weatherTempC?: number;
  weatherCondition?: string;
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
  forgotPassword: (email: string) =>
    post<{ ok: boolean }>("/auth/forgot-password", { email }),
  resetPassword: (token: string, password: string) =>
    post<{ ok: boolean }>("/auth/reset-password", { token, password }),
  // admin
  adminStats: () => request<{ stats: AdminStatsDTO }>("/admin/stats"),  adminUsers: (search?: string) =>
    request<{ users: AdminUserDTO[]; total: number }>(
      `/admin/users${search ? `?search=${encodeURIComponent(search)}` : ""}`,
    ),
  adminUpdateUser: (
    userId: string,
    input: { status?: "ACTIVE" | "SUSPENDED"; systemRole?: "SYSTEM_ADMIN" | null },
  ) => patch<{ user: AdminUserDTO }>(`/admin/users/${userId}`, input),
  /** "View as": switch cookies to an impersonated session of the target user. */
  adminImpersonate: (userId: string) =>
    post<{ user: SessionUser; impersonated: boolean }>(
      `/admin/users/${userId}/impersonate`,
    ),
  /** Exit impersonation: cookies are switched back to the admin's session. */
  adminExitImpersonation: () =>
    post<{ user: SessionUser; impersonated: boolean }>(
      "/admin/impersonate/exit",
    ),
  adminTeams: () => request<{ teams: AdminTeamDTO[] }>("/admin/teams"),
  adminAudit: (action?: string) =>
    request<{ events: AdminAuditDTO[]; total: number }>(
      `/admin/audit${action ? `?action=${encodeURIComponent(action)}` : ""}`,
    ),

  // documents
  documentRequirements: (teamId: string) =>
    request<{ requirements: DocumentRequirementDTO[] }>(
      `/teams/${teamId}/document-requirements`,
    ),
  upsertRequirement: (
    teamId: string,
    input: { kind: string; label: string; validDays?: number; required: boolean },
  ) =>
    post<{ requirement: DocumentRequirementDTO }>(
      `/teams/${teamId}/document-requirements`,
      input,
    ),
  deleteRequirement: (teamId: string, requirementId: string) =>
    del<{ ok: boolean }>(`/teams/${teamId}/document-requirements/${requirementId}`),
  documentStatus: (teamId: string) =>
    request<{ athletes: AthleteDocumentStatus[] }>(
      `/teams/${teamId}/document-status`,
    ),
  uploadDocument: (form: FormData) =>
    request<{ document: DocumentDTO }>("/documents/upload", {
      method: "POST",
      body: form,
    }),
  documentFileUrl: (id: string) => `${BASE_URL}/documents/${id}/file`,
  myDocuments: (teamId: string) =>
    request<{ documents: DocumentDTO[] }>(`/teams/${teamId}/documents/mine`),
  athleteDocuments: (teamId: string, userId: string) =>
    request<{ documents: DocumentDTO[] }>(
      `/teams/${teamId}/documents/athlete/${userId}`,
    ),
  teamDocuments: (teamId: string) =>
    request<{ documents: DocumentDTO[] }>(`/teams/${teamId}/documents/team`),
  myCertifications: () =>
    request<{ documents: DocumentDTO[] }>("/users/me/certifications"),
  recordBackgroundCheck: (input: {
    checkResult: "PASS" | "FAIL";
    checkProvider: string;
    checkedAt?: string;
  }) => post<{ document: DocumentDTO }>("/documents/background-check", input),
  verifyDocument: (id: string) =>
    post<{ document: DocumentDTO }>(`/documents/${id}/verify`, {}),
  signDocument: (id: string, signedByName: string) =>
    post<{ document: DocumentDTO }>(`/documents/${id}/sign`, {
      signedByName,
      intentConfirmed: true,
    }),
  deleteDocument: (id: string, reason: string) =>
    request<{ ok: boolean }>(`/documents/${id}`, {
      method: "DELETE",
      body: JSON.stringify({ reason }),
    }),
  register: (input: RegisterInput) =>
    post<{ user: SessionUser }>("/auth/register", input),
  login: (input: { email: string; password: string }) =>
    post<{ user: SessionUser }>("/auth/login", input),
  logout: () => post<{ ok: boolean }>("/auth/logout"),
  me: () => request<{ user: SessionUser; impersonated: boolean }>("/auth/me"),

  // users
  getProfile: () => request<{ user: FullUser }>("/users/me"),
  updateProfile: (input: UpdateProfileInput) =>
    patch<{ user: FullUser }>("/users/me", input),

  // places
  searchPlaces: (q: string) =>
    request<{ places: Place[] }>(`/places/search?q=${encodeURIComponent(q)}`),

  // trackers
  trackerStatus: () =>
    request<{ trackers: Array<{ provider: string; connected: boolean; lastSyncAt: string | null }> }>("/trackers/status"),
  syncCoros: () =>
    post<{ result: { checked: number; imported: number; skipped: number; errors: string[] } }>("/trackers/coros/sync"),
  disconnectCoros: () => del<{ ok: boolean }>("/trackers/coros"),

  // teams
  listTeams: () => request<{ teams: TeamDTO[] }>("/teams"),
  getTeam: (id: string) => request<{ team: TeamDTO }>(`/teams/${id}`),
  getTeamHealth: (id: string) =>
    request<{ health: TeamHealthDTO }>(`/teams/${id}/health`),
  getActiveSeason: (id: string) =>
    request<{ active: ActiveSeasonDTO | null }>(`/teams/${id}/seasons/active`),
  listSeasons: (id: string) =>
    request<{ seasons: SeasonDTO[] }>(`/teams/${id}/seasons`),
  createSeason: (id: string, input: object) =>
    post<{ season: SeasonDTO }>(`/teams/${id}/seasons`, input),
  updateSeason: (id: string, seasonId: string, input: object) =>
    patch<{ season: SeasonDTO }>(`/teams/${id}/seasons/${seasonId}`, input),
  deleteSeason: (id: string, seasonId: string) =>
    del<{ ok: boolean }>(`/teams/${id}/seasons/${seasonId}`),
  createTeam: (input: CreateTeamInput) =>
    post<{ team: TeamDTO }>("/teams", input),
  discoverTeams: (q: string) =>
    request<{ teams: { id: string; name: string; description: string | null }[] }>(
      `/teams/discover?q=${encodeURIComponent(q)}`,
    ),
  findSimilarTeams: (name: string) =>
    request<{ teams: { id: string; name: string; description: string | null }[] }>(
      `/teams/similar?name=${encodeURIComponent(name)}`,
    ),
  requestJoinDirect: (teamId: string) =>
    post<{ requestId: string; teamId: string; teamName: string }>(
      `/teams/${teamId}/join-requests`,
      {},
    ),
  updateTeam: (id: string, input: { name?: string; description?: string }) =>
    patch<{ team: TeamDTO }>(`/teams/${id}`, input),
  listNotifications: (cursor?: string) =>
    request<{ notifications: NotificationDTO[]; nextCursor: string | null }>(
      `/notifications${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ""}`,
    ),
  unreadCount: () => request<{ unread: number }>("/notifications/unread-count"),
  markNotificationRead: (id: string) =>
    post<{ ok: boolean }>(`/notifications/${id}/read`, {}),
  markAllNotificationsRead: () => post<{ ok: boolean }>("/notifications/read-all", {}),

  listAlbums: (teamId: string) =>
    request<{ albums: AlbumDTO[] }>(`/teams/${teamId}/albums`),
  createAlbum: (teamId: string, input: { title: string; description?: string }) =>
    post<{ album: AlbumDTO }>(`/teams/${teamId}/albums`, input),
  listPhotos: (teamId: string, opts?: { albumId?: string; includePending?: boolean }) => {
    const q = new URLSearchParams();
    if (opts?.albumId) q.set("albumId", opts.albumId);
    if (opts?.includePending) q.set("includePending", "true");
    const qs = q.toString();
    return request<{ photos: PhotoDTO[] }>(`/teams/${teamId}/photos${qs ? `?${qs}` : ""}`);
  },
  pendingPhotos: (teamId: string) =>
    request<{ photos: PhotoDTO[] }>(`/teams/${teamId}/photos/pending`),
  reviewPhoto: (photoId: string, approve: boolean) =>
    post<{ photo: PhotoDTO }>(`/photos/${photoId}/review`, { approve }),
  deletePhoto: (photoId: string) => del<{ ok: boolean }>(`/photos/${photoId}`),
  uploadPhoto: (teamId: string, form: FormData) =>
    request<{ photo: PhotoDTO }>(`/teams/${teamId}/photos`, {
      method: "POST",
      body: form,
    }),
  photoFileUrl: (photoId: string) => `${BASE_URL}/photos/${photoId}/file`,

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
  leaveTeam: (teamId: string, content: "keep" | "remove" = "keep") =>
    post<{ ok: boolean }>(`/teams/${teamId}/leave`, { content }),
  transferActivities: (fromTeamId: string, toTeamId: string) =>
    post<{ transferred: number }>(`/activities/transfer`, {
      fromTeamId,
      toTeamId,
    }),
  deleteAccount: () => del<{ ok: boolean }>(`/users/me`),
  deleteUser: (userId: string) => del<{ ok: boolean }>(`/users/${userId}`),
  submitFeedback: (input: { category: "BUG" | "FEATURE" | "OTHER"; body: string; teamId?: string }) =>
    post<{ feedback: FeedbackDTO }>(`/feedback`, input),
  myFeedback: () => request<{ feedback: FeedbackDTO[] }>(`/feedback/mine`),
  adminFeedback: (status?: string) =>
    request<{ feedback: FeedbackDTO[] }>(
      `/admin/feedback${status ? `?status=${status}` : ""}`,
    ),
  adminUpdateFeedback: (id: string, status: "OPEN" | "REVIEWED" | "RESOLVED") =>
    patch<{ ok: boolean }>(`/admin/feedback/${id}`, { status }),
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
  setGroupLeader: (groupId: string, leaderId: string | null) =>
    put<{ group: TeamGroupDTO }>(`/groups/${groupId}/leader`, { leaderId }),
  postGroupAnnouncement: (groupId: string, body: string) =>
    post<{ message: unknown }>(`/groups/${groupId}/announcements`, { body }),
  getGroupDigest: (groupId: string, days = 28) =>
    request<{ digest: TeamDigest }>(`/groups/${groupId}/digest?days=${days}`),

  // assignments + calendars
  createAssignment: (teamId: string, input: CreateAssignmentPayload) =>
    post<{ assignment: AssignmentDTO }>(`/teams/${teamId}/assignments`, input),
  bulkAssign: (
    teamId: string,
    input: { workoutId: string; athleteIds: string[]; scheduledDate: string; notes?: string },
  ) =>
    post<{ created: number; skipped: Array<{ athleteId: string; reason: string }> }>(
      `/teams/${teamId}/assignments/bulk`,
      input,
    ),
  bulkMessage: (
    teamId: string,
    input: { groupIds?: string[]; athleteIds?: string[]; body: string },
  ) =>
    post<{
      sentToGroups: string[];
      sentToAthletes: string[];
      skipped: Array<{ targetId: string; reason: string }>;
    }>(`/teams/${teamId}/messages/bulk`, input),
  deleteAssignment: (assignmentId: string) =>
    del<{ ok: boolean }>(`/assignments/${assignmentId}`),
  createPracticePlan: (teamId: string, input: CreatePracticePlanInput) =>
    post<{ assignment: AssignmentDTO; postId: string | null }>(
      `/teams/${teamId}/practice-plans`,
      input,
    ),
  saveAttendance: (
    teamId: string,
    input: { date: string; eventId?: string; records: Record<string, boolean> },
  ) => post<{ attendance: AttendanceDTO }>(`/teams/${teamId}/attendance`, input),
  listAttendance: (teamId: string) =>
    request<{ attendance: AttendanceDTO[] }>(`/teams/${teamId}/attendance`),
  getAttendance: (teamId: string, attendanceId: string) =>
    request<{ attendance: AttendanceDTO }>(
      `/teams/${teamId}/attendance/${attendanceId}`,
    ),
  listTrainingPlans: (teamId: string) =>
    request<{ plans: TrainingPlanDTO[] }>(`/teams/${teamId}/training-plans`),
  createTrainingPlan: (teamId: string, input: CreateTrainingPlanInput) =>
    post<{ plan: TrainingPlanDTO }>(`/teams/${teamId}/training-plans`, input),
  updateTrainingPlan: (
    teamId: string,
    planId: string,
    input: UpdateTrainingPlanInput,
  ) =>
    patch<{ plan: TrainingPlanDTO }>(
      `/teams/${teamId}/training-plans/${planId}`,
      input,
    ),
  deleteTrainingPlan: (teamId: string, planId: string) =>
    del<{ ok: boolean }>(`/teams/${teamId}/training-plans/${planId}`),
  applyTrainingPlan: (
    teamId: string,
    planId: string,
    input: ApplyTrainingPlanInput,
  ) =>
    post<{ assignments: AssignmentDTO[]; postId: string | null }>(
      `/teams/${teamId}/training-plans/${planId}/apply`,
      input,
    ),
  teamCalendar: (teamId: string, from: string, to: string) =>
    request<{ assignments: AssignmentDTO[]; activities: ActivityDTO[]; events: TeamEventDTO[] }>(
      `/teams/${teamId}/calendar?from=${from}&to=${to}`,
    ),
  myCalendar: (from: string, to: string) =>
    request<{ assignments: AssignmentDTO[]; activities: ActivityDTO[]; events: TeamEventDTO[] }>(
      `/users/me/calendar?from=${from}&to=${to}`,
    ),
  listTeamEvents: (teamId: string, from: string, to: string) =>
    request<{ events: TeamEventDTO[] }>(
      `/teams/${teamId}/events?from=${from}&to=${to}`,
    ),
  createTeamEvent: (teamId: string, input: CreateTeamEventInput) =>
    post<{ event: TeamEventDTO }>(`/teams/${teamId}/events`, input),
  updateTeamEvent: (teamId: string, eventId: string, input: UpdateTeamEventInput) =>
    patch<{ event: TeamEventDTO }>(`/teams/${teamId}/events/${eventId}`, input),
  deleteTeamEvent: (teamId: string, eventId: string) =>
    del<{ ok: boolean }>(`/teams/${teamId}/events/${eventId}`),

  // activities
  createActivity: (input: CreateActivityPayload) =>
    post<{ activity: ActivityDTO }>("/activities", input),
  listActivities: (from: string, to: string, teamId?: string) =>
    request<{ activities: ActivityDTO[] }>(
      `/activities?from=${from}&to=${to}${teamId ? `&teamId=${teamId}` : ""}`,
    ),
  getActivity: (id: string) =>
    request<{ activity: ActivityDTO }>(`/activities/${id}`),
  getActivityTag: (id: string) =>
    request<{ tag: ActivityTagDTO }>(`/activity-tags/${id}`),
  declineActivityTag: (id: string) =>
    post<{ ok: boolean }>(`/activity-tags/${id}/decline`, {}),
  updateActivity: (id: string, input: UpdateActivityPayload) =>
    patch<{ activity: ActivityDTO }>(`/activities/${id}`, input),
  deleteActivity: (id: string) => del<{ ok: boolean }>(`/activities/${id}`),
  myStats: (from: string, to: string) =>
    request<{ stats: ActivityStatsDTO }>(
      `/users/me/stats?from=${from}&to=${to}`,
    ),
  myRecords: () =>
    request<{ records: PersonalRecordDTO[] }>(`/users/me/records`),

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
  myPersonalRecords: () =>
    request<{ records: PaceRecordDTO[] }>(`/users/me/pace-records`),
  teamRecords: (teamId: string) =>
    request<{ records: TeamRecordDTO[] }>(`/teams/${teamId}/records`),
  // shoes
  createShoe: (input: { name: string; brand?: string; model?: string; lifespanM?: number }) =>
    post<{ shoe: ShoeDTO }>("/shoes", input),
  myShoes: () => request<{ shoes: ShoeDTO[] }>("/shoes"),
  updateShoe: (id: string, input: { name?: string; brand?: string | null; model?: string | null; retired?: boolean; lifespanM?: number }) =>
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

  // personal training plans
  listPersonalPlans: () =>
    request<{ plans: PersonalPlanDTO[] }>("/personal-plans"),
  createPersonalPlan: (input: {
    name: string;
    description?: string;
    days: Array<{ date: string; title: string; notes?: string }>;
  }) => post<{ plan: PersonalPlanDTO }>("/personal-plans", input),
  updatePersonalPlan: (
    planId: string,
    input: {
      name?: string;
      description?: string | null;
      days?: Array<{ date: string; title: string; notes?: string }>;
    },
  ) => patch<{ plan: PersonalPlanDTO }>(`/personal-plans/${planId}`, input),
  deletePersonalPlan: (planId: string) =>
    del<{ ok: boolean }>(`/personal-plans/${planId}`),
  applyPersonalPlan: (planId: string) =>
    post<{ plan: PersonalPlanDTO }>(`/personal-plans/${planId}/apply`, {}),
  unapplyPersonalPlan: (planId: string) =>
    post<{ plan: PersonalPlanDTO }>(`/personal-plans/${planId}/unapply`, {}),
  personalPlanDays: (from: string, to: string) =>
    request<{
      days: Array<PersonalPlanDayDTO & { planId: string; planName: string }>;
    }>(`/personal-plans/days?from=${from}&to=${to}`),
  athletePlannedDays: (teamId: string, userId: string, from: string, to: string) =>
    request<{
      days: Array<PersonalPlanDayDTO & { planId: string; planName: string }>;
    }>(`/teams/${teamId}/athletes/${userId}/planned?from=${from}&to=${to}`),
  setAvatar: (image: string) =>
    put<{ ok: boolean; hasAvatar: boolean }>("/users/me/avatar", { image }),
  removeAvatar: () => del<{ ok: boolean; hasAvatar: boolean }>("/users/me/avatar"),
  avatarUrl: (userId: string) => `${BASE_URL}/users/${userId}/avatar`,

  // coach athlete view
  getAthlete: (teamId: string, userId: string) =>
    request<{ athlete: AthleteViewDTO }>(
      `/teams/${teamId}/athletes/${userId}`,
    ),

  // team feed
  createPost: (
    teamId: string,
    input: { body?: string; activityId?: string; photoIds?: string[]; kind?: "TEXT" | "SHOUTOUT" },
  ) => post<{ post: PostDTO }>(`/teams/${teamId}/feed`, input),
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
  listCheckIns: (teamId: string) =>
    request<{ checkIns: CheckInDTO[] }>(`/teams/${teamId}/check-ins`),
  createCheckIn: (teamId: string, input: { coachId: string; runnerId: string }) =>
    post<{ checkIn: CheckInDTO }>(`/teams/${teamId}/check-ins`, input),
  checkInStatus: (teamId: string) =>
    request<{
      status: { isMinor: boolean; hasVerifiedGuardian: boolean; guardianRequired: boolean };
    }>(`/teams/${teamId}/check-ins/status`),
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
  draftAlumniDigest: (teamId: string, days = 14) =>
    post<{ draft: string; highlights: number }>(
      `/teams/${teamId}/alumni-digest/draft?days=${days}`,
      {},
    ),
  draftWeeklyRecap: (teamId: string) =>
    post<{ draft: string; races: number; highlights: number }>(
      `/teams/${teamId}/weekly-recap/draft`,
      {},
    ),
  listTeamAwards: (teamId: string) =>
    request<{ awards: AwardDTO[] }>(`/teams/${teamId}/awards`),
  listAthleteAwards: (teamId: string, athleteId: string) =>
    request<{ awards: AwardDTO[] }>(
      `/teams/${teamId}/athletes/${athleteId}/awards`,
    ),
  awardCount: (teamId: string, from?: string, to?: string) => {
    const qs = new URLSearchParams();
    if (from) qs.set("from", from);
    if (to) qs.set("to", to);
    const q = qs.toString();
    return request<{ total: number }>(
      `/teams/${teamId}/awards/count${q ? `?${q}` : ""}`,
    );
  },
  createAward: (
    teamId: string,
    input: {
      athleteId: string;
      type: AwardType;
      place?: number;
      eventName: string;
      eventDate: string;
      notes?: string;
      postToFeed?: boolean;
    },
  ) => post<{ award: AwardDTO }>(`/teams/${teamId}/awards`, input),
  updateAward: (
    awardId: string,
    input: Partial<{
      type: AwardType;
      place: number | null;
      eventName: string;
      eventDate: string;
      notes: string | null;
    }>,
  ) => patch<{ award: AwardDTO }>(`/awards/${awardId}`, input),
  deleteAward: (awardId: string) =>
    del<void>(`/awards/${awardId}`),
  getLineup: (teamId: string, distanceM: number) =>
    request<{ lineup: LineupEntryDTO[] }>(
      `/teams/${teamId}/lineup?distanceM=${distanceM}`,
    ),
  myTeamEvents: (from: string, to: string) =>
    request<{ events: TeamEventDTO[] }>(
      `/team-events/mine?from=${from}&to=${to}`,
    ),
  listInjuries: (teamId: string) =>
    request<{ injuries: InjuryDTO[] }>(`/teams/${teamId}/injuries`),
  reportInjury: (
    teamId: string,
    input: { athleteId: string; title: string; detail?: string; expectedReturn?: string },
  ) => post<{ injury: InjuryDTO }>(`/teams/${teamId}/injuries`, input),
  updateInjury: (
    teamId: string,
    injuryId: string,
    input: { title?: string; detail?: string | null; status?: "ACTIVE" | "RECOVERED"; expectedReturn?: string | null },
  ) => patch<{ injury: InjuryDTO }>(`/teams/${teamId}/injuries/${injuryId}`, input),
  deleteInjury: (teamId: string, injuryId: string) =>
    del<{ ok: boolean }>(`/teams/${teamId}/injuries/${injuryId}`),
  /** Download the meet-entry CSV (coach only). Uses cookie auth like the rest. */
  exportEntries: async (teamId: string, eventIds: string[]): Promise<void> => {
    const qs =
      eventIds.length > 0 ? `?eventIds=${eventIds.join(",")}` : "";
    const doFetch = () =>
      fetch(`${BASE_URL}/teams/${teamId}/entries/export${qs}`, {
        credentials: "include",
      });
    let res = await doFetch();
    if (res.status === 401) {
      // Mirror the JSON client's silent refresh once.
      try {
        const refreshRes = await fetch(`${BASE_URL}/auth/refresh`, {
          method: "POST",
          credentials: "include",
        });
        if (refreshRes.ok) res = await doFetch();
      } catch {
        // fall through to the error below
      }
    }
    if (!res.ok) {
      throw new ApiError(
        `Couldn't export entries (${res.status})`,
        "EXPORT_FAILED",
        res.status,
      );
    }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "meet-entries.csv";
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
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
