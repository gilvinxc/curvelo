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
  hasAvatar: boolean;
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
  /** Present on single-team fetches; true when the viewer owns the team. */
  isOwner?: boolean;
  /** True when the team has a logo (fetch it from /teams/:id/logo). */
  hasLogo: boolean;
  createdAt: string;
}

/** Roster entry. Coaches see emails + contact info; runners see names only. */
export interface RosterMemberDTO {
  userId: string;
  displayName: string;
  email?: string;
  phone?: string | null;
  emergencyName?: string | null;
  emergencyPhone?: string | null;
  role: string;
  status: string;
  joinedAt: string;
}

/** Official race result — exact distance, exact time. */
export interface RaceResultDTO {
  id: string;
  raceName: string;
  distanceM: number;
  durationS: number;
  racedAt: string;
  activityId: string | null;
  splits: Array<{ distanceM: number; durationS: number }> | null;
  finishPlace: number | null;
  ageGroupPlace: number | null;
  fieldSize: number | null;
}

/** Deterministic + narrated analysis of one race result. */
export interface RaceSplitAnalysis {
  index: number;
  distanceM: number;
  durationS: number;
  /** Seconds per km for this split. */
  paceSecPerKm: number;
  /** Percent slower (+) / faster (-) than the race average pace. */
  vsAvgPct: number;
}
export interface RaceAnalysisDTO {
  hasSplits: boolean;
  pacingVerdict: "even" | "positive" | "negative" | "insufficient";
  verdictDetail: string;
  splits: RaceSplitAnalysis[];
  /** e.g. "faded 8% over the final mile" / "closed 5% faster" / null. */
  fadeOrKick: string | null;
  /** Comparison with the athlete's previous race at this distance. */
  vsPrevious: string | null;
  highlights: string[];
  coachingCues: string[];
  narrative: string;
  provider: "local" | "llm";
}
/** A personal best at one standard distance. */
export interface PersonalRecordDTO {
  distanceM: number;
  label: string;
  durationS: number;
  raceName: string;
  racedAt: string;
}

/** The team's best at one standard distance. */
export interface TeamRecordDTO extends PersonalRecordDTO {
  userId: string;
  displayName: string;
}

/** A shoe with accumulated mileage (canonical meters). */
export interface ShoeDTO {
  id: string;
  name: string;
  brand: string | null;
  model: string | null;
  retired: boolean;
  retiredAt: string | null;
  isDefault: boolean;
  mileageM: number;
  lifespanM: number;
  createdAt: string;
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

/** Shareable team invite link. */
export interface JoinLinkDTO {
  id: string;
  teamId: string;
  teamName: string;
  state: "ACTIVE" | "EXPIRED" | "REVOKED" | "FULL";
  expiresAt: string;
  maxUses: number | null;
  useCount: number;
  createdAt: string;
  token?: string; // included when listing/creating for managers
}

/** Public join-link preview (no auth required). */
export interface JoinLinkPreviewDTO {
  teamName: string;
  teamDescription: string | null;
  expiresAt: string;
  usesLeft: number | null;
}

/** Pending join request awaiting coach approval. */
export interface JoinRequestDTO {
  id: string;
  teamId: string;
  status: string;
  createdAt: string;
  user: { id: string; displayName: string; email: string };
}

/** A personal or team goal with computed progress. */
export interface GoalDTO {
  id: string;
  kind: "DISTANCE" | "SESSIONS" | "STREAK";
  period: "WEEK" | "MONTH" | "CUSTOM";
  title: string | null;
  /** Canonical target: meters for DISTANCE, count for SESSIONS/STREAK. */
  targetMeters: number | null;
  targetCount: number | null;
  startAt: string;
  endAt: string;
  recurring: boolean;
  status: "ACTIVE" | "COMPLETED" | "ARCHIVED";
  shareOnComplete: boolean;
  completedAt: string | null;
  /** Current progress in the same units as the target. */
  progress: number;
  progressLabel: string;
  teamId: string | null;
  teamName: string | null;
}

/** Within-team leaderboard. Values are meters (distance) or counts (sessions). */
export interface LeaderboardEntryDTO {
  userId: string;
  displayName: string;
  value: number;
  rank: number;
}

export interface LeaderboardDTO {
  metric: "distance" | "sessions";
  days: number;
  entries: LeaderboardEntryDTO[];
  /** The viewer's rank (null when they have no activity in the window). */
  myRank: number | null;
}

/** Personal progress analytics: weekly buckets plus streaks. */
export interface ProgressWeekDTO {
  weekStart: string;
  distanceM: number;
  sessions: number;
  durationS: number;
}

export interface ProgressDTO {
  weeks: ProgressWeekDTO[];
  currentStreakDays: number;
  totalDistanceM: number;
  totalSessions: number;
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
  leaderId: string | null;
  leaderName: string | null;
  members?: Array<{ userId: string; displayName: string }>;
}

export interface AttendanceDTO {
  id: string;
  teamId: string;
  date: string;
  eventId: string | null;
  eventTitle: string | null;
  presentCount: number;
  absentCount: number;
  presentPct: number;
  records?: Record<string, boolean>;
  members?: Array<{ userId: string; displayName: string; present: boolean }>;
  createdByName: string;
  createdAt: string;
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

export interface TrainingPlanDayDTO {
  id: string;
  dayOfWeek: number;
  workoutId: string;
  workoutTitle: string;
  groupId: string | null;
  groupName: string | null;
  assignedToUserId: string | null;
  assignedToName: string | null;
  notes: string | null;
}

export interface TrainingPlanDTO {
  id: string;
  teamId: string;
  name: string;
  description: string | null;
  createdByName: string;
  days: TrainingPlanDayDTO[];
  createdAt: string;
}

export interface TeamEventRecurrence {
  freq: "WEEKLY";
  days: number[];
  until: string;
}

export interface TeamEventDTO {
  id: string;
  teamId: string;
  /** Present on the unified personal calendar. */
  teamName?: string;
  title: string;
  description: string | null;
  eventType: string;
  startAt: string;
  endAt: string | null;
  location: string | null;
  itinerary: string | null;
  recurrence: TeamEventRecurrence | null;
  recurring: boolean;
  createdByName: string;
}

export interface MentionRef {
  userId: string;
  displayName: string;
}

export interface PhotoDTO {
  id: string;
  teamId: string;
  albumId: string | null;
  postId: string | null;
  uploaderId: string;
  uploaderName: string;
  mimeType: string;
  caption: string | null;
  status: string;
  picturedAthleteIds: string[];
  createdAt: string;
}

export interface AlbumDTO {
  id: string;
  teamId: string;
  title: string;
  description: string | null;
  photoCount: number;
  coverPhotoId: string | null;
  createdAt: string;
}

export interface NotificationDTO {
  id: string;
  type: string;
  title: string;
  body: string | null;
  link: string | null;
  readAt: string | null;
  createdAt: string;
}

export interface ActivitySplitDTO {
  id: string;
  position: number;
  distanceM: number | null;
  durationS: number | null;
}

export interface ActivityDTO {  id: string;
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
  steps: number | null;
  elevationGainM: number | null;
  avgCadenceSpm: number | null;
  splits: ActivitySplitDTO[];
  city: string | null;
  cityLat: number | null;
  cityLon: number | null;
  terrain: string | null;
  weatherTempC: number | null;
  weatherCondition: string | null;
  notes: string | null;
  mentions: MentionRef[];
  source: string;
  visibility: string;
  shoeId: string | null;
  shoeName: string | null;
  loggedByUserId: string | null;
  loggedByName: string | null;
  /** GPS track, owner + verified guardians only. Absent otherwise. */
  route?: Array<[number, number]> | null;
  /** True when a GPS route is stored. Not location data — safe for all viewers. */
  hasGpsRoute: boolean;
}

export interface ActivityTagDTO {
  id: string;
  status: string; // PENDING | ACCEPTED | DECLINED | INVALIDATED
  taggerId: string;
  taggerName: string;
  teamId: string | null;
  teamName: string | null;
  createdAt: string;
  // Prefilled values from the tagged run (editable before saving).
  prefill: {
    title: string | null;
    startedAt: string;
    distanceM: number | null;
    durationS: number | null;
    avgHrBpm: number | null;
    maxHrBpm: number | null;
    effortRpe: number | null;
    calories: number | null;
    steps: number | null;
    elevationGainM: number | null;
    avgCadenceSpm: number | null;
    city: string | null;
    terrain: string | null;
    notes: string | null;
  };
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
  mentions: MentionRef[];
  photos: PhotoDTO[];
  createdAt: string;
}

export interface CommentDTO {
  id: string;
  postId: string;
  authorId: string;
  authorName: string;
  body: string;
  mentions: MentionRef[];
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

export interface TrainingStats {
  sessions: number;
  activeDays: number;
  totalDistanceM: number;
  totalDurationS: number;
  avgPaceSecPerKm: number | null;
  streakDays: number;
  longestRunM: number;
  avgRpe: number | null;
  assignmentsTotal: number;
  assignmentsCompleted: number;
  completionRate: number | null; // 0..1
  paceTrend: "improving" | "stable" | "declining" | "insufficient";
}

export interface AthleteInsight {
  athleteId: string;
  athleteName: string;
  periodDays: number;
  stats: TrainingStats;
  highlights: string[];
  watchOuts: string[];
  narrative: string;
  provider: "local" | "llm";
  generatedAt: string;
}

export interface TeamDigestAthlete {
  athleteId: string;
  athleteName: string;
  sessions: number;
  activeDays: number;
  completionRate: number | null;
  status: "on-track" | "quiet" | "needs-attention";
  /** True when the athlete hasn't opened the app in 21+ days. */
  dormant: boolean;
  lastLoginAt: string | null;
}

export interface ImportedActivitySummary {
  fileName: string;
  fileHash: string;
  format: "FIT" | "GPX" | "TCX";
  kind: string;
  title: string;
  startedAt: string;
  distanceM: number | null;
  durationS: number | null;
  avgHrBpm: number | null;
  maxHrBpm: number | null;
  calories: number | null;
  steps: number | null;
  elevationGainM: number | null;
  avgCadenceSpm: number | null;
  splitCount: number;
  alreadyImported: boolean;
}

export interface TeamDigest {
  teamId: string;
  teamName: string;
  periodDays: number;
  athletes: TeamDigestAthlete[];
  summary: string;
  provider: "local" | "llm";
  generatedAt: string;
  /** Leadership health: are any coaches/admins still active? */
  coachHealth: {
    coachCount: number;
    activeCoachCount: number;
    /** True when no coach/admin has logged in within 30 days. */
    noActiveCoach: boolean;
  };
}

export interface CheckInDTO {
  id: string;
  title: string;
  coachId: string;
  coachName: string;
  runnerId: string;
  runnerName: string;
  guardianNames: string[];
  lastMessageAt: string | null;
  canPost: boolean;
}

export interface ConversationDTO {
  id: string;
  kind: string;
  title: string;
  groupId: string | null;
  groupName: string | null;
  canPost: boolean;
  lastMessageAt: string | null;
}

export interface ChatMessageDTO {
  id: string;
  conversationId: string;
  authorId: string;
  authorName: string;
  authorRole: string;
  body: string | null; // null when moderated away
  mentions: MentionRef[];
  deleted: boolean;
  createdAt: string;
  editedAt: string | null;
}

export interface ChildSummaryDTO {
  athleteId: string;
  athleteName: string;
  teamId: string;
  teamName: string;
  teamActive: boolean;
  role: string;
  consentRequired: boolean;
  consents: ConsentDTO[];
  upcomingAssignments: AssignmentDTO[];
  recentActivities: ActivityDTO[];
}

/** One item in a guardian's merged family calendar. */
export interface FamilyCalendarItemDTO {
  kind: "assignment" | "event" | "plan";
  date: string; // YYYY-MM-DD
  title: string;
  detail: string | null;
  teamId: string | null;
  teamName: string | null;
  athleteId: string;
  athleteName: string;
}

export interface DocumentDTO {
  id: string;
  teamId: string | null;
  ownerId: string | null;
  ownerName: string | null;
  kind: string;
  label: string;
  requirementId: string | null;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  issuedAt: string | null;
  expiresAt: string | null;
  verifiedAt: string | null;
  verifiedByName: string | null;
  signedByName: string | null;
  signedAt: string | null;
  checkResult: string | null;
  checkProvider: string | null;
  visibility: string;
  version: number;
  uploadedByName: string;
  createdAt: string;
}

export interface DocumentRequirementDTO {
  id: string;
  teamId: string;
  kind: string;
  label: string;
  validDays: number | null;
  required: boolean;
}

export type DocumentCheckStatus = "current" | "expiring" | "expired" | "missing";

export interface AthleteDocumentStatus {
  userId: string;
  displayName: string;
  requirements: Array<{
    requirementId: string;
    kind: string;
    label: string;
    status: DocumentCheckStatus;
    documentId: string | null;
    expiresAt: string | null;
  }>;
  cleared: boolean;
}

export interface AdminUserDTO {
  id: string;
  email: string;
  displayName: string;
  status: string;
  systemRole: string | null;
  teamCount: number;
  createdAt: string;
}

export interface AdminTeamDTO {
  id: string;
  name: string;
  slug: string;
  visibility: string;
  memberCount: number;
  ownerName: string;
  createdAt: string;
}

export interface AdminAuditDTO {
  id: string;
  actorId: string | null;
  actorName: string | null;
  action: string;
  entityType: string | null;
  entityId: string | null;
  ipAddress: string | null;
  createdAt: string;
}

export interface AdminStatsDTO {
  users: number;
  teams: number;
  activities: number;
  raceResults: number;
  documents: number;
  posts: number;
  auditEvents24h: number;
}

/** One day in a personal training plan (plain-text workout). */
export interface PersonalPlanDayDTO {
  id: string;
  date: string; // YYYY-MM-DD
  title: string;
  notes: string | null;
  position: number;
}

/** An individual's own training plan: a dated list of plain-text workouts. */
export interface PersonalPlanDTO {
  id: string;
  name: string;
  description: string | null;
  applied: boolean;
  days: PersonalPlanDayDTO[];
  createdAt: string;
  updatedAt: string;
}

export interface InjuryDTO {
  id: string;
  athleteId: string;
  athleteName: string;
  reportedByName: string;
  title: string;
  detail: string | null;
  status: "ACTIVE" | "RECOVERED";
  expectedReturn: string | null;
  resolvedAt: string | null;
  createdAt: string;
}

export interface FeedbackDTO {
  id: string;
  userId?: string;
  userName: string;
  teamId: string | null;
  teamName: string | null;
  category: "BUG" | "FEATURE" | "OTHER";
  body: string;
  status: "OPEN" | "REVIEWED" | "RESOLVED";
  createdAt: string;
}

export interface TeamHealthRaceGroup {
  raceName: string;
  /** YYYY-MM-DD */
  racedAt: string;
  resultsCount: number;
  prCount: number;
}

export interface TeamHealthPaceByDistance {
  distanceM: number;
  /** Seconds per km, averaged across the group's results. */
  avgPaceS: number;
  resultsCount: number;
}

/**
 * Team Health rollup: headline tiles with drill-downs instead of a million
 * reports. Race health is PRs + pace-by-distance, not raw race counts.
 */
export interface TeamHealthDTO {
  teamId: string;
  /** Meters logged in TEAM-visible activities, last 7 days. */
  milesWeekM: number;
  /** Same for the 7 days before that (trend). */
  milesPrevWeekM: number;
  /** 28d average pace (sec/km); only runs with distance AND time count. */
  avgPaceS: number | null;
  /** 28d average RPE; null when nobody logged one. */
  avgRpe: number | null;
  /** Active injuries — COACH only, null for everyone else. */
  activeInjuries: number | null;
  /** % of ACTIVE RUNNER members with >=1 TEAM-visible activity in 7d. */
  participationPct: number | null;
  runnerCount: number;
  activeRunnerCount: number;
  races: {
    /** New personal records set in the last 30d (fastest pace per runner per distance, all-time comparison). */
    prs30d: number;
    /** Distinct races (name+day) with team results in the last 30d. */
    races30d: number;
    /** Team race results in the last 30d. */
    results30d: number;
    /** Last 90d, grouped by distance, ordered by distance asc. */
    paceByDistance: TeamHealthPaceByDistance[];
    /** Most recent races (name+day), up to 5. Deep link: team coaching tab race section. */
    recent: TeamHealthRaceGroup[];
  };
}

export interface PaceRecordDTO {
  /** Canonical distance in meters (1609.344, 5000, 10000, 21097.5, 42195). */
  distanceM: number;
  /** Display label: "1 mi", "5K", "10K", "Half", "Marathon". */
  label: string;
  /** Best pace in seconds per km. */
  bestPaceS: number;
  activityId: string;
  achievedAt: string;
}

export interface SeasonDTO {
  id: string;
  teamId: string;
  name: string;
  startsAt: string;
  endsAt: string;
  isActive: boolean;
  championshipName: string | null;
  championshipDate: string | null;
}

export interface SeasonWeekDTO {
  /** YYYY-MM-DD of the week's Monday. */
  weekStart: string;
  /** Team miles logged that week (meters, TEAM-visible activities). */
  milesM: number;
  /** Races (team calendar RACE events) in that week. */
  races: { id: string; title: string; date: string }[];
  /** Injuries reported that week — coach only, null for others. */
  injuryCount: number | null;
}

export interface ActiveSeasonDTO {
  season: SeasonDTO;
  /** Whole days until the championship (negative = past). Null when no championship set. */
  daysToChampionship: number | null;
  weeks: SeasonWeekDTO[];
}
