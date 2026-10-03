/**
 * Builds an .ics calendar file client-side and triggers a download.
 * On iPhone, opening the downloaded .ics offers "Add to Calendar".
 */

export interface IcsEvent {
  title: string;
  description?: string | null;
  /** ISO datetime for the event start. */
  startAt: string;
  /** ISO datetime for the event end; defaults to start + 1 hour. */
  endAt?: string | null;
  location?: string | null;
  url?: string | null;
}

function icsEscape(text: string): string {
  return text
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r?\n/g, "\\n");
}

function toIcsDate(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}` +
    `T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`
  );
}

export function buildIcs(event: IcsEvent): string {
  const start = new Date(event.startAt);
  const end = event.endAt ? new Date(event.endAt) : new Date(start.getTime() + 60 * 60 * 1000);
  const uid = `${Date.now()}-${Math.random().toString(36).slice(2)}@curvelo`;
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Curvelo//Training//EN",
    "BEGIN:VEVENT",
    `UID:${uid}`,
    `DTSTAMP:${toIcsDate(new Date().toISOString())}`,
    `DTSTART:${toIcsDate(event.startAt)}`,
    `DTEND:${toIcsDate(end.toISOString())}`,
    `SUMMARY:${icsEscape(event.title)}`,
  ];
  if (event.description) lines.push(`DESCRIPTION:${icsEscape(event.description)}`);
  if (event.location) lines.push(`LOCATION:${icsEscape(event.location)}`);
  if (event.url) lines.push(`URL:${icsEscape(event.url)}`);
  lines.push("END:VEVENT", "END:VCALENDAR");
  return lines.join("\r\n");
}

/** Downloads an .ics file so the phone's calendar app can import it. */
export function downloadIcs(event: IcsEvent): void {
  const blob = new Blob([buildIcs(event)], { type: "text/calendar;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${event.title.replace(/[^a-z0-9]+/gi, "-").slice(0, 40) || "event"}.ics`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}
