import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import type { ActivityDTO } from "@curvelo/shared";
import { api } from "../../lib/api";
import { Button, EmptyState, Spinner, TextInput } from "../../components/ui";
import { ActivityRow } from "./ActivityRow";

function monthKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function monthLabel(key: string): string {
  const [y, m] = key.split("-").map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString(undefined, {
    month: "long",
    year: "numeric",
  });
}

/** Full training history, newest first, grouped by month, with search. */
export function ActivitiesPage() {
  const [query, setQuery] = useState("");
  // Pull the last 2 years; the API takes a date range.
  const to = new Date();
  const from = new Date(to.getFullYear() - 2, to.getMonth(), 1);
  const fromStr = from.toISOString().slice(0, 10);
  const toStr = to.toISOString().slice(0, 10);

  const { data, isLoading } = useQuery({
    queryKey: ["activities", "all", fromStr, toStr],
    queryFn: () => api.listActivities(fromStr, toStr),
  });

  const groups = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = (data?.activities ?? []).filter((a: ActivityDTO) => {
      if (!q) return true;
      return (
        (a.title ?? "").toLowerCase().includes(q) ||
        (a.notes ?? "").toLowerCase().includes(q) ||
        a.kind.toLowerCase().includes(q)
      );
    });
    const map = new Map<string, ActivityDTO[]>();
    for (const a of list) {
      const key = monthKey(new Date(a.startedAt));
      const arr = map.get(key) ?? [];
      arr.push(a);
      map.set(key, arr);
    }
    return [...map.entries()].sort((x, y) => (x[0] < y[0] ? 1 : -1));
  }, [data, query]);

  const total = data?.activities.length ?? 0;

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold">My activities</h1>
        <Link to="/activities/new">
          <Button className="min-h-[44px] px-4 text-[14px]">Log activity</Button>
        </Link>
      </div>

      <TextInput
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search title, notes, or kind…"
        aria-label="Search activities"
      />

      {isLoading ? (
        <Spinner />
      ) : total === 0 ? (
        <EmptyState
          title="No activities yet"
          body="Log your first run and it'll show up here."
        />
      ) : groups.length === 0 ? (
        <EmptyState title="No matches" body="Try a different search." />
      ) : (
        groups.map(([key, items]) => (
          <section key={key}>
            <h2 className="mb-2 text-[13px] font-bold uppercase tracking-[0.18em] text-mist">
              {monthLabel(key)} · {items.length}
            </h2>
            <div className="space-y-2">
              {items.map((a) => (
                <Link key={a.id} to={`/activities/${a.id}`} className="block">
                  <ActivityRow activity={a} />
                </Link>
              ))}
            </div>
          </section>
        ))
      )}
    </div>
  );
}
