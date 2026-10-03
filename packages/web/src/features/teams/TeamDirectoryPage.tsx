import { useEffect, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { ApiError, api } from "../../lib/api";
import { Button, Card, ErrorBanner, Field, TextInput } from "../../components/ui";
import { TeamLogo } from "./TeamLogo";
import type { PublicTeamDTO } from "@curvelo/shared";

const PAGE_SIZE = 20;

/** Public team directory: browse/search public teams. Safe fields only. */
export function TeamDirectoryPage() {
  const [q, setQ] = useState("");
  const [city, setCity] = useState("");
  const [debounced, setDebounced] = useState({ q: "", city: "" });
  const [page, setPage] = useState(1);
  const [requestedIds, setRequestedIds] = useState<string[]>([]);
  const [requestError, setRequestError] = useState<string | null>(null);

  useEffect(() => {
    const t = setTimeout(
      () => {
        setDebounced({ q: q.trim(), city: city.trim() });
        setPage(1);
      },
      400,
    );
    return () => clearTimeout(t);
  }, [q, city]);

  const dirQuery = useQuery({
    queryKey: ["teamDirectory", debounced.q, debounced.city, page],
    queryFn: () =>
      api.listPublicTeams({
        q: debounced.q || undefined,
        city: debounced.city || undefined,
        page,
        pageSize: PAGE_SIZE,
      }),
    staleTime: 30_000,
  });

  const requestJoin = useMutation({
    mutationFn: (teamId: string) => api.requestJoinDirect(teamId),
    onSuccess: (_data, teamId) => {
      setRequestedIds((ids) => [...ids, teamId]);
      setRequestError(null);
    },
    onError: (err) => {
      setRequestError(
        err instanceof ApiError ? err.message : "Couldn't send the request.",
      );
    },
  });

  const teams = dirQuery.data?.teams ?? [];
  const total = dirQuery.data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div className="mx-auto w-full max-w-2xl">
      <h1 className="mb-1 text-[22px] font-black text-ink-50">Find a team</h1>
      <p className="mb-4 text-[13px] text-mist">
        Public teams across Stride Sense. Request to join — a coach approves
        every request.
      </p>

      <div className="mb-4 flex gap-2">
        <div className="flex-[2]">
          <Field label="Team name">
            <TextInput
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search teams…"
              maxLength={80}
            />
          </Field>
        </div>
        <div className="flex-1">
          <Field label="City">
            <TextInput
              value={city}
              onChange={(e) => setCity(e.target.value)}
              placeholder="City…"
              maxLength={80}
            />
          </Field>
        </div>
      </div>

      {requestError && <ErrorBanner message={requestError} />}

      {dirQuery.isLoading && (
        <p className="text-[13px] text-mist">Loading teams…</p>
      )}
      {dirQuery.isError && (
        <ErrorBanner message="Couldn't load the directory." />
      )}

      {dirQuery.data && teams.length === 0 && (
        <Card>
          <p className="text-[14px] text-mist">
            No public teams found. Try a different search — or start your own
            team.
          </p>
        </Card>
      )}

      <div className="flex flex-col gap-3">
        {teams.map((t) => (
          <TeamDirectoryRow
            key={t.id}
            team={t}
            requested={requestedIds.includes(t.id)}
            requesting={requestJoin.isPending}
            onRequest={() => requestJoin.mutate(t.id)}
          />
        ))}
      </div>

      {totalPages > 1 && (
        <div className="mt-4 flex items-center justify-between">
          <Button
            variant="secondary"
            disabled={page <= 1}
            onClick={() => setPage((p) => p - 1)}
            className="min-h-[44px] px-4 text-[14px]"
          >
            ← Prev
          </Button>
          <p className="text-[13px] text-mist">
            Page {page} of {totalPages} ({total} teams)
          </p>
          <Button
            variant="secondary"
            disabled={page >= totalPages}
            onClick={() => setPage((p) => p + 1)}
            className="min-h-[44px] px-4 text-[14px]"
          >
            Next →
          </Button>
        </div>
      )}
    </div>
  );
}

function TeamDirectoryRow({
  team,
  requested,
  requesting,
  onRequest,
}: {
  team: PublicTeamDTO;
  requested: boolean;
  requesting: boolean;
  onRequest: () => void;
}) {
  const location =
    team.city != null
      ? team.state != null
        ? `${team.city}, ${team.state}`
        : team.city
      : null;
  return (
    <Card>
      <div className="flex items-center gap-3">
        <TeamLogo
          teamId={team.id}
          teamName={team.name}
          hasLogo={team.hasLogo}
          size={48}
        />
        <div className="min-w-0 flex-1">
          <p className="truncate text-[15px] font-bold text-ink-50">
            {team.name}
          </p>
          {location && (
            <p className="text-[12px] text-mist">{location}</p>
          )}
          {team.description && (
            <p className="mt-0.5 line-clamp-2 text-[13px] text-mist">
              {team.description}
            </p>
          )}
        </div>
        {requested ? (
          <p className="shrink-0 text-[13px] font-bold text-volt-300">
            Requested ✓
          </p>
        ) : (
          <Button
            variant="secondary"
            className="shrink-0 min-h-[44px] px-4 text-[13px]"
            loading={requesting}
            onClick={onRequest}
          >
            Request to join
          </Button>
        )}
      </div>
    </Card>
  );
}
