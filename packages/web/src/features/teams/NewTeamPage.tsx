import { useEffect, useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import type { TeamVisibility } from "@curvelo/shared";
import { ApiError, api } from "../../lib/api";
import {
  Button,
  Card,
  ErrorBanner,
  Field,
  PageHeader,
  SegmentedControl,
  TextArea,
  TextInput,
} from "../../components/ui";

function slugify(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

export function NewTeamPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [slugTouched, setSlugTouched] = useState(false);
  const [description, setDescription] = useState("");
  const [visibility, setVisibility] = useState<TeamVisibility>("PRIVATE");
  const [error, setError] = useState<string | null>(null);
  const [debouncedName, setDebouncedName] = useState("");
  const [requestedIds, setRequestedIds] = useState<string[]>([]);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedName(name.trim()), 400);
    return () => clearTimeout(t);
  }, [name]);

  const similarQuery = useQuery({
    queryKey: ["similarTeams", debouncedName],
    queryFn: () => api.findSimilarTeams(debouncedName),
    enabled: debouncedName.length >= 3,
    staleTime: 30_000,
  });
  const similarTeams =
    similarQuery.data?.teams.filter((t) => !requestedIds.includes(t.id)) ?? [];

  const requestJoin = useMutation({
    mutationFn: (teamId: string) => api.requestJoinDirect(teamId),
    onSuccess: (_data, teamId) => setRequestedIds((ids) => [...ids, teamId]),
  });

  const create = useMutation({
    mutationFn: () =>
      api.createTeam({
        name: name.trim(),
        ...(slug.trim() ? { slug: slug.trim() } : {}),
        ...(description.trim() ? { description: description.trim() } : {}),
        visibility,
      }),
    onSuccess: ({ team }) => {
      void queryClient.invalidateQueries({ queryKey: ["teams"] });
      navigate(`/teams/${team.id}`, { replace: true });
    },
    onError: (err) => {
      setError(
        err instanceof ApiError ? err.message : "Couldn't create the team.",
      );
    },
  });

  const onNameChange = (value: string) => {
    setName(value);
    if (!slugTouched) setSlug(slugify(value));
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    create.mutate();
  };

  return (
    <div className="mx-auto w-full max-w-xl">
      <PageHeader
        title="New team"
        subtitle="Set up your squad. You can tweak everything later."
        backTo="/dashboard"
      />
      <Card>
        <form onSubmit={submit} className="flex flex-col gap-5">
          {error && <ErrorBanner message={error} />}
          <Field label="Team name">
            <TextInput
              required
              minLength={2}
              maxLength={80}
              value={name}
              onChange={(e) => onNameChange(e.target.value)}
              placeholder="Winchester Track Club"
              autoFocus
            />
          </Field>
          {similarTeams.length > 0 && (
            <div className="rounded-xl border border-volt-400/30 bg-volt-400/5 p-4">
              <p className="text-[14px] font-bold text-ink-50">
                Already on Curvelo?
              </p>
              <p className="mt-0.5 text-[13px] text-mist">
                These teams have a similar name. You can request to join
                instead of creating a duplicate — a coach will review it.
              </p>
              <div className="mt-3 flex flex-col gap-2">
                {similarTeams.map((t) => (
                  <div
                    key={t.id}
                    className="flex items-center gap-3 rounded-lg bg-ink-900/40 p-3"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[14px] font-bold text-ink-50">
                        {t.name}
                      </p>
                      {t.description && (
                        <p className="truncate text-[12px] text-mist">
                          {t.description}
                        </p>
                      )}
                    </div>
                    <Button
                      variant="secondary"
                      className="shrink-0"
                      loading={requestJoin.isPending}
                      onClick={() => requestJoin.mutate(t.id)}
                    >
                      Request to join
                    </Button>
                  </div>
                ))}
              </div>
              {requestJoin.isError && (
                <p className="mt-2 text-[13px] text-red-400">
                  {requestJoin.error instanceof ApiError
                    ? requestJoin.error.message
                    : "Couldn't send the request."}
                </p>
              )}
            </div>
          )}
          {requestedIds.length > 0 && (
            <p className="rounded-xl border border-emerald-400/30 bg-emerald-400/5 p-3 text-[13px] text-emerald-300">
              Request sent — a coach will review it. You can still create a
              new team below if this isn't the right one.
            </p>
          )}
          <Field
            label="URL slug"
            hint="Letters, numbers, and hyphens. Leave blank to auto-generate."
          >
            <TextInput
              value={slug}
              onChange={(e) => {
                setSlug(e.target.value);
                setSlugTouched(true);
              }}
              placeholder="winchester-track-club"
              pattern="[a-z0-9]+(?:-[a-z0-9]+)*"
              title="Lowercase letters, numbers, and hyphens only"
            />
          </Field>
          <Field label="Description" hint="What is this team about? (optional)">
            <TextArea
              maxLength={2000}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Middle school distance squad — fall cross country season."
            />
          </Field>
          <Field
            label="Visibility"
            hint={
              visibility === "PRIVATE"
                ? "Only members and invited athletes can see this team."
                : "Anyone can discover this team."
            }
          >
            <SegmentedControl<TeamVisibility>
              ariaLabel="Team visibility"
              value={visibility}
              onChange={setVisibility}
              options={[
                { value: "PRIVATE", label: "Private" },
                { value: "PUBLIC", label: "Public" },
              ]}
            />
          </Field>
          <Button type="submit" loading={create.isPending} className="w-full">
            Create team
          </Button>
        </form>
      </Card>
    </div>
  );
}
