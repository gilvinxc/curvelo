import { useState, type FormEvent } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
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
