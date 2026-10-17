import type { PolicyRevision } from "./types";

export function cn(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(" ");
}

export function revisionLabel(rev: PolicyRevision | number | null | undefined): string {
  if (rev === null || rev === undefined) return "r—";
  return `r${typeof rev === "number" ? rev : rev.revision}`;
}

/** "sha256:4f1c…" → "sha256:4f1c9a2e" */
export function shortHash(hash: string | null | undefined, length = 8): string {
  if (!hash) return "—";
  const [algo, digest] = hash.includes(":") ? hash.split(":", 2) : ["", hash];
  const short = digest.slice(0, length);
  return algo ? `${algo}:${short}` : short;
}

const timeFormat = new Intl.DateTimeFormat("en-GB", {
  day: "2-digit",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hour12: false,
});

const isoFormat = new Intl.DateTimeFormat("en-GB", {
  year: "numeric",
  month: "short",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  timeZoneName: "short",
  hour12: false,
});

export function formatTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return timeFormat.format(d);
}

export function formatTimeFull(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return isoFormat.format(d);
}

const rtf = new Intl.RelativeTimeFormat("en", { numeric: "auto", style: "short" });

export function relativeTime(iso: string | null | undefined, now = 0): string {
  if (!iso) return "—";
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return "—";
  const reference = now > 0 ? now : Date.now();
  const diff = Math.round((t - reference) / 1000);
  const abs = Math.abs(diff);
  if (abs < 45) return "just now";
  if (abs < 60 * 45) return rtf.format(Math.round(diff / 60), "minute");
  if (abs < 60 * 60 * 22) return rtf.format(Math.round(diff / 3600), "hour");
  return rtf.format(Math.round(diff / 86400), "day");
}

export function formatMs(ms: number | null | undefined): string {
  if (ms === null || ms === undefined || Number.isNaN(ms)) return "—";
  if (ms < 1) return "<1 ms";
  if (ms < 1000) return `${Math.round(ms)} ms`;
  return `${(ms / 1000).toFixed(ms < 10_000 ? 2 : 1)} s`;
}

export function durationBetween(startIso: string, endIso: string): number | null {
  const a = new Date(startIso).getTime();
  const b = new Date(endIso).getTime();
  if (Number.isNaN(a) || Number.isNaN(b)) return null;
  return Math.max(0, b - a);
}

export function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

/** Strip a leading HTTP verb if the backend already embedded it in `path`. */
export function endpointPath(path: string): string {
  return path.replace(/^(GET|POST|PUT|PATCH|DELETE)\s+/i, "");
}

export function joinNames(names: string[]): string {
  if (names.length <= 1) return names[0] ?? "";
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

export function lowerFirst(text: string): string {
  return text ? text.charAt(0).toLowerCase() + text.slice(1) : text;
}
