import { useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { ApiError, api } from "../../lib/api";
import { useAuth } from "../../lib/auth";
import {
  Avatar,
  Button,
  Card,
  ErrorBanner,
  Field,
  FullScreenLoader,
  PageHeader,
  SegmentedControl,
  Select,
  TextArea,
  TextInput,
} from "../../components/ui";

const SHARE_LEVELS = [
  { value: "FULL", label: "Full details" },
  { value: "SUMMARY", label: "Summary only" },
  { value: "ACHIEVEMENT_ONLY", label: "Achievements" },
  { value: "NONE", label: "Keep private" },
] as const;

type ShareLevel = (typeof SHARE_LEVELS)[number]["value"];

export function SettingsPage() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const profileQuery = useQuery({
    queryKey: ["profile"],
    queryFn: () => api.getProfile(),
  });

  const [displayName, setDisplayName] = useState<string | null>(null);
  const [bio, setBio] = useState<string | null>(null);
  const [city, setCity] = useState<string | null>(null);
  const [phone, setPhone] = useState<string | null>(null);
  const [emergencyName, setEmergencyName] = useState<string | null>(null);
  const [emergencyPhone, setEmergencyPhone] = useState<string | null>(null);
  const [units, setUnits] = useState<"metric" | "imperial" | null>(null);
  const [shareLevel, setShareLevel] = useState<ShareLevel | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const save = useMutation({
    mutationFn: () =>
      api.updateProfile({
        displayName: displayName ?? undefined,
        bio: bio ?? undefined,
        city: city ?? undefined,
        phone: phone ?? undefined,
        emergencyName: emergencyName ?? undefined,
        emergencyPhone: emergencyPhone ?? undefined,
        units: units ?? undefined,
        defaultShareLevel: shareLevel ?? undefined,
      }),
    onSuccess: () => {
      setSaved(true);
      window.setTimeout(() => setSaved(false), 2500);
      void queryClient.invalidateQueries({ queryKey: ["profile"] });
    },
    onError: (err) => {
      setError(
        err instanceof ApiError ? err.message : "Couldn't save your profile.",
      );
    },
  });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    save.mutate();
  };

  const doLogout = async () => {
    await logout();
    queryClient.clear();
    navigate("/signin", { replace: true });
  };

  if (profileQuery.isLoading) return <FullScreenLoader />;

  if (profileQuery.isError || !profileQuery.data) {
    return (
      <div className="flex flex-col gap-4">
        <PageHeader title="Settings" backTo="/dashboard" />
        <ErrorBanner message="Couldn't load your profile." />
      </div>
    );
  }

  const profile = profileQuery.data.user;
  // Lazy-init form state from the loaded profile (only on first render).
  const name = displayName ?? profile.displayName;
  const bioVal = bio ?? profile.profile?.bio ?? "";
  const cityVal = city ?? profile.profile?.city ?? "";
  const phoneVal = phone ?? profile.profile?.phone ?? "";
  const emergencyNameVal = emergencyName ?? profile.profile?.emergencyName ?? "";
  const emergencyPhoneVal = emergencyPhone ?? profile.profile?.emergencyPhone ?? "";
  const unitsVal = units ?? profile.profile?.units ?? "imperial";
  const shareVal = shareLevel ?? ((profile.profile?.defaultShareLevel as ShareLevel | null) ?? "FULL");

  return (
    <div className="mx-auto w-full max-w-xl">
      <PageHeader title="Settings" backTo="/dashboard" />

      <Card className="mb-4">
        <div className="flex items-center gap-4">
          <Avatar name={profile.displayName} size="lg" />
          <div className="min-w-0">
            <h2 className="truncate text-xl font-extrabold tracking-tight">
              {profile.displayName}
            </h2>
            <p className="truncate text-[14px] text-mist">{profile.email}</p>
          </div>
        </div>
      </Card>

      <Card>
        <form onSubmit={submit} className="flex flex-col gap-5">
          {error && <ErrorBanner message={error} />}
          <Field label="Display name">
            <TextInput
              value={name}
              maxLength={80}
              onChange={(e) => setDisplayName(e.target.value)}
            />
          </Field>
          <Field label="Bio" hint="A line or two about you. (optional)">
            <TextArea
              maxLength={500}
              value={bioVal}
              onChange={(e) => setBio(e.target.value)}
              placeholder="Distance runner, coffee enthusiast."
            />
          </Field>
          <Field label="City">
            <TextInput
              maxLength={120}
              value={cityVal}
              onChange={(e) => setCity(e.target.value)}
              placeholder="Winchester, KY"
            />
          </Field>
          <Field label="Phone" hint="Visible to your coaches only. (optional)">
            <TextInput
              maxLength={30}
              value={phoneVal}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="(555) 123-4567"
              inputMode="tel"
            />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Emergency contact" hint="Name">
              <TextInput
                maxLength={80}
                value={emergencyNameVal}
                onChange={(e) => setEmergencyName(e.target.value)}
                placeholder="Jane Doe"
              />
            </Field>
            <Field label="Emergency phone" hint="Number">
              <TextInput
                maxLength={30}
                value={emergencyPhoneVal}
                onChange={(e) => setEmergencyPhone(e.target.value)}
                placeholder="(555) 987-6543"
                inputMode="tel"
              />
            </Field>
          </div>
          <Field label="Units">
            <SegmentedControl<"metric" | "imperial">
              ariaLabel="Distance units"
              value={unitsVal}
              onChange={setUnits}
              options={[
                { value: "imperial", label: "Miles" },
                { value: "metric", label: "Kilometers" },
              ]}
            />
          </Field>
          <Field
            label="Default sharing"
            hint="Controls how your activities appear to teammates."
          >
            <Select
              value={shareVal}
              onChange={(e) => setShareLevel(e.target.value as ShareLevel)}
            >
              {SHARE_LEVELS.map((s) => (
                <option key={s.value} value={s.value}>
                  {s.label}
                </option>
              ))}
            </Select>
          </Field>
          <Button type="submit" loading={save.isPending} className="w-full">
            {saved ? "Saved" : "Save changes"}
          </Button>
        </form>
      </Card>

      <Card className="mt-4">
        <h3 className="text-[15px] font-extrabold">Account</h3>
        <p className="mt-1 text-[14px] text-mist">
          Signed in as {user?.email ?? profile.email}
        </p>
        <Button variant="danger" onClick={() => void doLogout()} className="mt-4 w-full">
          Log out
        </Button>
      </Card>

      <p className="mt-6 text-center text-[12px] text-mist/60">
        Curvelo v0.1.0 — Empower Your Run
      </p>
    </div>
  );
}
