import { useEffect, useRef, useState } from "react";
import { api, type Place } from "../lib/api";
import { TextInput } from "./ui";
import { cn } from "./cx";

interface CityInputProps {
  value: string;
  onChange: (value: string, place: Place | null) => void;
  placeholder?: string;
  verified: boolean;
}

/**
 * City field with verified-place autocomplete. Typing searches Open-Meteo;
 * picking a suggestion fills the canonical "City, State" label and attaches
 * coordinates (used for exact weather). Free text is still allowed — the
 * user just doesn't get the verified checkmark.
 */
export function CityInput({ value, onChange, placeholder, verified }: CityInputProps) {
  const [open, setOpen] = useState(false);
  const [results, setResults] = useState<Place[]>([]);
  const [loading, setLoading] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const onDocClick = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, []);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    const q = value.trim();
    if (q.length < 2) {
      setResults([]);
      setOpen(false);
      setLoading(false);
      return;
    }
    setLoading(true);
    debounceRef.current = setTimeout(async () => {
      try {
        const { places } = await api.searchPlaces(q);
        setResults(places);
        setOpen(places.length > 0);
      } catch {
        setResults([]);
        setOpen(false);
      } finally {
        setLoading(false);
      }
    }, 350);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [value]);

  return (
    <div ref={wrapRef} className="relative">
      <div className="relative">
        <TextInput
          value={value}
          maxLength={120}
          placeholder={placeholder ?? "City"}
          autoComplete="off"
          onChange={(e) => onChange(e.target.value, null)}
          onFocus={() => {
            if (results.length > 0) setOpen(true);
          }}
          className={cn(verified && "pr-9")}
        />
        {verified && (
          <span
            title="Verified place"
            className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[16px] text-pine"
          >
            ✓
          </span>
        )}
      </div>
      {open && (
        <ul className="absolute z-30 mt-1 max-h-56 w-full overflow-auto rounded-xl border border-line bg-white shadow-lg">
          {loading && (
            <li className="px-3 py-2 text-[13px] text-mist">Searching places…</li>
          )}
          {results.map((p) => (
            <li key={`${p.lat},${p.lon}`}>
              <button
                type="button"
                className="flex w-full items-center gap-2 px-3 py-2 text-left text-[14px] hover:bg-cream"
                onClick={() => {
                  onChange(p.label, p);
                  setOpen(false);
                }}
              >
                <span className="text-pine">📍</span>
                <span className="truncate">{p.label}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
