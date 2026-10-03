import { useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { api } from "../lib/api";

interface GuideEntry {
  title: string;
  body: string;
  /** Static link, or a team-tab suffix expanded per team. */
  to?: string;
  teamTab?: string;
  roles: Array<"runner" | "coach" | "parent">;
}

const ENTRIES: GuideEntry[] = [
  // Runner
  { title: "Log a run", body: "Record a workout manually — distance, time, effort.", to: "/activities/new", roles: ["runner"] },
  { title: "Import a workout file", body: "Upload a FIT, GPX, or TCX file from your watch.", to: "/activities/import", roles: ["runner"] },
  { title: "My calendar", body: "Your plans, workouts, assignments, and team events in one place.", to: "/calendar", roles: ["runner", "coach", "parent"] },
  { title: "Activity history", body: "Every workout you've logged, searchable.", to: "/activities", roles: ["runner"] },
  { title: "My progress", body: "Stats, streaks, shoes, and pacing trends.", to: "/progress", roles: ["runner"] },
  { title: "Training plans", body: "Create a personal plan for the off-season — it lands on your calendar.", to: "/calendar", roles: ["runner"] },
  { title: "Connect a tracker", body: "Link COROS to sync workouts automatically.", to: "/settings", roles: ["runner"] },
  { title: "Find a team", body: "Browse public teams in the directory and request to join — a coach approves every request.", to: "/teams/directory", roles: ["runner"] },
  { title: "Personal records", body: "Your fastest pace at standard distances, from all your logged runs.", to: "/dashboard", roles: ["runner"] },
  { title: "Today's workout", body: "If your coach assigned something for today, it nudges you on the dashboard with a Log it button.", to: "/dashboard", roles: ["runner"] },
  { title: "Elevation, cadence & splits", body: "Optional fields on every run — log them by hand or let your watch file fill them in.", to: "/activities/new", roles: ["runner"] },
  { title: "Tag teammates", body: "Ran with friends? Tag them and they can add it to their own log with one tap.", to: "/activities/new", roles: ["runner"] },
  { title: "Your route maps", body: "Imported runs show your GPS route — visible only to you and your verified guardians.", to: "/activities", roles: ["runner"] },
  // Coach
  { title: "Coach a team", body: "Insights, quiet/dormant athletes, and the team digest.", teamTab: "coaching", roles: ["coach"] },
  { title: "Create a workout", body: "Build and assign workouts to runners.", teamTab: "workouts", roles: ["coach"] },
  { title: "Team calendar", body: "Schedule practices, races, and events.", teamTab: "calendar", roles: ["coach"] },
  { title: "Team feed", body: "Posts, milestones, and shoutouts.", teamTab: "feed", roles: ["coach", "runner", "parent"] },
  { title: "Messages", body: "Announcements and the team huddle. No private DMs, by design.", teamTab: "messages", roles: ["coach", "runner"] },
  { title: "Manage team", body: "Invite links, join requests, roles, and ownership.", teamTab: "manage", roles: ["coach"] },
  { title: "Team logo", body: "Upload a logo in team settings — it shows on the dashboard, team page, and directory.", teamTab: "manage", roles: ["coach"] },
  { title: "Team visibility", body: "Make your team public to appear in the directory (name, logo, description, location only) or keep it private.", teamTab: "manage", roles: ["coach"] },
  { title: "Review reports", body: "Moderation queue for reported posts.", teamTab: "reports", roles: ["coach"] },
  { title: "Draft alumni update", body: "AI draft of recent highlights to publish as an announcement.", teamTab: "coaching", roles: ["coach"] },
  { title: "Invite a guardian", body: "Link a parent to their athlete for consent and visibility.", teamTab: "manage", roles: ["coach"] },
  { title: "Training groups & leaders", body: "Split the roster into subgroups and assign an assistant coach to lead each one.", teamTab: "manage", roles: ["coach"] },
  { title: "Assign to many athletes", body: "Pick a workout, tick the athletes, assign once — with per-group filters.", teamTab: "workouts", roles: ["coach"] },
  { title: "Message many at once", body: "One message to several groups or athletes — athletes get it in their check-in thread.", teamTab: "messages", roles: ["coach"] },
  { title: "Take attendance", body: "Tap present/absent at practice; history and percentages build up automatically.", teamTab: "manage", roles: ["coach"] },
  { title: "Awards", body: "Log medals and trophies on the athlete page — the team's trophy count shows on the Season tab.", teamTab: "season", roles: ["coach"] },
  { title: "Eligibility nudges", body: "Athletes with expired or missing paperwork surface on the Coaching tab.", teamTab: "coaching", roles: ["coach"] },
  { title: "Weekly parent recap", body: "AI-drafted from the week's stats — you review and publish as an announcement.", teamTab: "coaching", roles: ["coach"] },
  { title: "Lineup helper", body: "Rank runners by their best official time at any distance.", teamTab: "coaching", roles: ["coach"] },
  { title: "Team health", body: "Miles, pace, effort, races, participation, and injuries — six tiles, all drill-down.", teamTab: "health", roles: ["coach"] },
  { title: "Season timeline", body: "Seasons, championship countdown, weekly mileage, and race markers.", teamTab: "season", roles: ["coach"] },
  { title: "GPS badge", body: "A GPS badge on a run means it was actually tracked — not hand-typed.", teamTab: "coaching", roles: ["coach"] },
  { title: "Check-ins", body: "Private coach-runner conversations — guardians are always included for minors.", teamTab: "messages", roles: ["coach"] },
  // Parent
  { title: "Family dashboard", body: "Your athletes' schedules, runs, and consent status.", to: "/family", roles: ["parent"] },
  { title: "Team conversations", body: "Read-only view of your athlete's team huddle.", to: "/family", roles: ["parent"] },
  { title: "Route maps", body: "Your athlete's GPS route maps are visible to you as a verified guardian.", to: "/family", roles: ["parent"] },
  { title: "Log for your kid", body: "Pick your athlete on the log form — the run is theirs, and they get a note to review it.", to: "/activities/new", roles: ["parent"] },
  { title: "Family calendar", body: "All your kids' assignments, events, and plans in one rollup, color-coded per kid.", to: "/family", roles: ["parent"] },
  { title: "Share photos", body: "Post team photos — every minor pictured needs verified guardian photo consent, checked each time.", to: "/family", roles: ["parent"] },
  { title: "Profile photo", body: "Upload a picture in Settings — it shows on your posts, comments, and roster entries.", to: "/settings", roles: ["runner", "coach", "parent"] },
  { title: "Privacy", body: "Password reset and delete-my-data live in Settings.", to: "/settings", roles: ["runner", "coach", "parent"] },
];

const ROLE_LABEL: Record<string, string> = {
  all: "For me",
  runner: "Runner",
  coach: "Coach",
  parent: "Parent",
};

export function HelpGuide({ onClose }: { onClose: () => void }) {
  const [query, setQuery] = useState("");
  const [role, setRole] = useState("all");
  const teamsQuery = useQuery({
    queryKey: ["myTeams"],
    queryFn: () => api.listTeams(),
  });
  const teams = teamsQuery.data?.teams ?? [];

  const q = query.trim().toLowerCase();
  const entries = ENTRIES.filter((e) => {
    if (role !== "all" && !e.roles.includes(role as "runner" | "coach" | "parent"))
      return false;
    if (!q) return true;
    return (
      e.title.toLowerCase().includes(q) || e.body.toLowerCase().includes(q)
    );
  });

  return (
    <div className="fixed inset-0 z-50" onClick={onClose}>
      <div className="absolute inset-0 bg-black/60" />
      <div
        className="absolute right-0 top-0 flex h-full w-[320px] flex-col bg-ink-950 p-4 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-center justify-between">
          <span className="text-[15px] font-extrabold tracking-tight">
            What do you want to do?
          </span>
          <button
            onClick={onClose}
            aria-label="Close help"
            className="rounded-full p-2 text-mist hover:text-ink-50"
          >
            ✕
          </button>
        </div>
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search… (e.g. log a run)"
          autoFocus
          className="mb-3 min-h-[44px] rounded-xl border border-white/10 bg-ink-900 px-3 text-[14px]"
        />
        <div className="mb-3 flex gap-1.5">
          {Object.entries(ROLE_LABEL).map(([key, label]) => (
            <button
              key={key}
              onClick={() => setRole(key)}
              className={`rounded-full px-3 py-1.5 text-[13px] font-semibold transition ${
                role === key
                  ? "bg-volt-400 text-ink-950"
                  : "bg-white/5 text-mist hover:bg-white/10"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="flex-1 overflow-y-auto pb-4">
          {entries.length === 0 && (
            <p className="mt-4 text-center text-[14px] text-mist">
              Nothing matches. Try a different search.
            </p>
          )}
          {entries.map((e) =>
            e.teamTab ? (
              <div key={e.title} className="mb-2 rounded-xl bg-white/[0.04] p-3">
                <p className="text-[14px] font-bold">{e.title}</p>
                <p className="mt-0.5 text-[13px] text-mist">{e.body}</p>
                {teams.length === 0 ? (
                  <p className="mt-1.5 text-[13px] text-mist">
                    Join or create a team first.
                  </p>
                ) : (
                  <div className="mt-1.5 flex flex-col gap-1">
                    {teams.map((t) => (
                      <Link
                        key={t.id}
                        to={`/teams/${t.id}/${e.teamTab}`}
                        onClick={onClose}
                        className="text-[13px] font-semibold text-volt-300 hover:underline"
                      >
                        {t.name} →
                      </Link>
                    ))}
                  </div>
                )}
              </div>
            ) : (
              <Link
                key={e.title}
                to={e.to!}
                onClick={onClose}
                className="mb-2 block rounded-xl bg-white/[0.04] p-3 transition hover:bg-white/[0.08]"
              >
                <p className="text-[14px] font-bold">
                  {e.title} <span className="text-volt-300">→</span>
                </p>
                <p className="mt-0.5 text-[13px] text-mist">{e.body}</p>
              </Link>
            ),
          )}
        </div>
      </div>
    </div>
  );
}
