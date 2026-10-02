import type {
  ActivityDTO,
  ActivityStatsDTO,
  AssignmentDTO,
  AthleteViewDTO,
  CreateTeamInput,
  InvitationDTO,
  InvitationPreviewDTO,
  RegisterInput,
  RosterMemberDTO,
  SessionUser,
  TeamDTO,
  TeamGroupDTO,
  TeamRole,
  UpdateProfileInput,
  WorkoutDTO,
} from "@curvelo/shared";

const BASE_URL =
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

  // coach athlete view
  getAthlete: (teamId: string, userId: string) =>
    request<{ athlete: AthleteViewDTO }>(
      `/teams/${teamId}/athletes/${userId}`,
    ),
};
