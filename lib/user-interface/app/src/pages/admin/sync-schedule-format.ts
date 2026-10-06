import { brand } from "../../common/brand";
import type { SyncSchedule } from "../../common/api-client/sync-client";

export const DAYS = [
  { value: "SUN", label: "Sunday" },
  { value: "MON", label: "Monday" },
  { value: "TUE", label: "Tuesday" },
  { value: "WED", label: "Wednesday" },
  { value: "THU", label: "Thursday" },
  { value: "FRI", label: "Friday" },
  { value: "SAT", label: "Saturday" },
];

/** Short name for an IANA zone right now, e.g. "EDT" or "GMT+1". */
export function zoneShortName(timeZone: string): string {
  try {
    const part = new Intl.DateTimeFormat("en-US", { timeZone, timeZoneName: "short" })
      .formatToParts(new Date())
      .find((p) => p.type === "timeZoneName");
    return part?.value ?? timeZone;
  } catch {
    return timeZone;
  }
}

/**
 * Zone the schedule's hour/minute are expressed in. Current schedules report
 * it as scheduleTimezone. Legacy UTC schedules report "UTC" there, but their
 * hour/minute are already converted to the deployment zone, so fall back to
 * brand.timezone (also used when the backend sends no zone at all).
 */
export function scheduleZone(schedule: SyncSchedule | null): string {
  if (schedule?.scheduleTimezone && !schedule.legacyUtc) return schedule.scheduleTimezone;
  return brand.timezone;
}

export function formatHourMinute(hour: number, minute: number): string {
  const ampm = hour < 12 ? "AM" : "PM";
  const h12 = hour % 12 || 12;
  return `${h12}:${String(minute).padStart(2, "0")} ${ampm}`;
}

/**
 * "Every Sunday at 1:00 AM (EST)", built client-side so the zone label
 * follows the schedule rather than the backend's humanReadable wording.
 */
export function describeSchedule(schedule: SyncSchedule | null): string {
  if (!schedule) return "Not configured";
  const day = DAYS.find((d) => d.value === schedule.dayOfWeek)?.label;
  if (schedule.legacyUtc || !day || schedule.hour === undefined) {
    return schedule.humanReadable ?? "Not configured";
  }
  const zone = scheduleZone(schedule);
  return `Every ${day} at ${formatHourMinute(schedule.hour, schedule.minute ?? 0)} (${zoneShortName(zone)})`;
}
