import type {
  CreateTeamInput,
  InvitationDTO,
  InvitationPreviewDTO,
  RegisterInput,
  RosterMemberDTO,
  SessionUser,
  TeamDTO,
  TeamRole,
  UpdateProfileInput,
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
  let res: Response;
  try {
    res = await fetch(`${BASE_URL}${path}`, {
      credentials: "include",
      headers: { "Content-Type": "application/json", ...(init.headers ?? {}) },
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
};
