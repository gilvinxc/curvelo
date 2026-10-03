import { useRef, useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { ApiError, api } from "../../lib/api";
import { useAuth } from "../../lib/auth";
import { resizeImageFile } from "../teams/TeamLogo";
import {
  formatHeight,
  formatWeight,
  fromKg,
  parseHeightInput,
  toCm,
  toKg,
  weightUnitLabel,
} from "../../lib/units";
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
import { CityInput } from "../../components/CityInput";
import { TrackerSection } from "./TrackerSection";

const SHARE_LEVELS = [
  { value: "FULL", label: "Full details" },
  { value: "SUMMARY", label: "Summary only" },
  { value: "ACHIEVEMENT_ONLY", label: "Achievements" },
  { value: "NONE", label: "Keep private" },
] as const;

type ShareLevel = (typeof SHARE_LEVELS)[number]["value"];

/** Profile picture upload with preview. */
function AvatarCard() {
  const { user, refresh } = useAuth();
  const queryClient = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const onPick = async (file: File | undefined) => {
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      const dataUrl = await resizeImageFile(file, 256);
      await api.setAvatar(dataUrl);
      await refresh();
      queryClient.invalidateQueries({ queryKey: ["profile"] });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't upload the photo.");
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const remove = async () => {
    setBusy(true);
    setError(null);
    try {
      await api.removeAvatar();
      await refresh();
      queryClient.invalidateQueries({ queryKey: ["profile"] });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't remove the photo.");
    } finally {
      setBusy(false);
    }
  };

  if (!user) return null;
  return (
    <Card className="mb-4">
      <div className="flex items-center gap-4">
        <Avatar
          name={user.displayName}
          size="lg"
          imageUrl={user.hasAvatar ? api.avatarUrl(user.id) : undefined}
        />
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-xl font-extrabold tracking-tight">
            {user.displayName}
          </h2>
          <p className="truncate text-[14px] text-mist">{user.email}</p>
        </div>
      </div>
      {error && (
        <div className="mt-3">
          <ErrorBanner message={error} />
        </div>
      )}
      <div className="mt-4 flex flex-wrap gap-2">
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => void onPick(e.target.files?.[0])}
        />
        <Button
          variant="secondary"
          className="min-h-[44px] px-4 text-[14px]"
          disabled={busy}
          onClick={() => fileRef.current?.click()}
        >
          {busy ? "Uploading…" : user.hasAvatar ? "Change photo" : "Add profile photo"}
        </Button>
        {user.hasAvatar && (
          <Button
            variant="secondary"
            className="min-h-[44px] px-4 text-[14px]"
            disabled={busy}
            onClick={() => void remove()}
          >
            Remove
          </Button>
        )}
      </div>
    </Card>
  );
}

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
  const [heightInput, setHeightInput] = useState<string | null>(null);
  const [weightInput, setWeightInput] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const save = useMutation({
    mutationFn: () => {
      const u = units ?? profileQuery.data?.user.profile?.units ?? "imperial";
      const parsedHeight =
        heightInput === null
          ? undefined
          : (() => {
              const v = parseHeightInput(heightInput, u);
              return v === undefined ? undefined : toCm(v, u);
            })();
      const parsedWeight =
        weightInput === null || weightInput.trim() === ""
          ? undefined
          : (() => {
              const v = Number(weightInput);
              return Number.isFinite(v) && v > 0 ? toKg(v, u) : undefined;
            })();
      return api.updateProfile({
        displayName: displayName ?? undefined,
        bio: bio ?? undefined,
        city: city ?? undefined,
        phone: phone ?? undefined,
        emergencyName: emergencyName ?? undefined,
        emergencyPhone: emergencyPhone ?? undefined,
        units: units ?? undefined,
        defaultShareLevel: shareLevel ?? undefined,
        heightCm: parsedHeight,
        weightKg: parsedWeight,
      });
    },
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
    const u = units ?? profileQuery.data?.user.profile?.units ?? "imperial";
    if (heightInput !== null && heightInput.trim() !== "") {
      const v = parseHeightInput(heightInput, u);
      if (v === undefined || toCm(v, u) < 100 || toCm(v, u) > 250) {
        setError(
          u === "metric"
            ? "Enter a height between 100 and 250 cm."
            : "Enter a height like 5'10\".",
        );
        return;
      }
    }
    if (weightInput !== null && weightInput.trim() !== "") {
      const v = Number(weightInput);
      if (!Number.isFinite(v) || toKg(v, u) < 25 || toKg(v, u) > 350) {
        setError(
          `Enter a weight between ${Math.round(fromKg(25, u))} and ${Math.round(fromKg(350, u))} ${weightUnitLabel(u)}.`,
        );
        return;
      }
    }
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
  const heightVal =
    heightInput ??
    (profile.profile?.heightCm != null
      ? unitsVal === "metric"
        ? String(Math.round(profile.profile.heightCm))
        : formatHeight(profile.profile.heightCm, "imperial")
      : "");
  const weightVal =
    weightInput ??
    (profile.profile?.weightKg != null
      ? String(Math.round(fromKg(profile.profile.weightKg, unitsVal)))
      : "");

  return (
    <div className="mx-auto w-full max-w-xl">
      <PageHeader title="Settings" backTo="/dashboard" />

      <AvatarCard />

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
          <Field label="City" hint="Pick your verified city — it pre-fills on every run you log">
            <CityInput
              value={cityVal}
              verified={false}
              placeholder="Winchester, KY"
              onChange={(value) => setCity(value)}
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
          <div className="grid grid-cols-2 gap-3">
            <Field
              label={`Height (${unitsVal === "metric" ? "cm" : "ft/in"})`}
              hint={unitsVal === "imperial" ? "e.g. 5'10\"" : undefined}
            >
              <TextInput
                value={heightVal}
                onChange={(e) => setHeightInput(e.target.value)}
                placeholder={unitsVal === "metric" ? "178" : "5'10\""}
                inputMode={unitsVal === "metric" ? "decimal" : "text"}
              />
            </Field>
            <Field label={`Weight (${weightUnitLabel(unitsVal)})`}>
              <TextInput
                value={weightVal}
                onChange={(e) => setWeightInput(e.target.value)}
                placeholder={unitsVal === "metric" ? "70" : "154"}
                inputMode="decimal"
              />
            </Field>
          </div>
          {(profile.profile?.heightCm != null ||
            profile.profile?.weightKg != null) && (
            <p className="-mt-2 text-[13px] text-mist">
              {[
                profile.profile?.heightCm != null &&
                  formatHeight(profile.profile.heightCm, unitsVal),
                profile.profile?.weightKg != null &&
                  formatWeight(profile.profile.weightKg, unitsVal),
              ]
                .filter(Boolean)
                .join(" · ")}
            </p>
          )}
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

      <TrackerSection />

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
