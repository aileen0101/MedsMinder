/**
 * MedsMinder — Dose Engine (shared)
 * ────────────────────────────────────────────────────────────────────────────
 * Central source of truth for the "safety engine" behind every dose action.
 * Both the Home agenda and the Medication detail page call into these
 * helpers so the counting, warnings, and pill-inventory math stay in sync
 * no matter where the user taps.
 *
 * Design rules (captured from user requirements):
 *
 *   1. Every medication has a `max_daily_dosage = schedule.length` doses/day.
 *      One "dose" can be multiple physical pills (`pillsPerDose`), so the
 *      physical daily pill cap is `schedule.length * pillsPerDose`.
 *
 *   2. A dose is tied to a slot (morning / noon / evening …) identified by
 *      `schedule.id`. Logs carry the `scheduleId` in their `notes` field so
 *      Home and Detail agree on what's "taken" for each slot.
 *
 *   3. Taken and Skipped are EXCLUSIVE states per slot:
 *        - Mark slot Skipped → any existing Taken log for that slot today
 *          is removed AND the pills it consumed are credited back to
 *          inventory.
 *        - Mark slot Taken  → any existing Skipped log for that slot today
 *          is removed, then a Taken log is written and pills are deducted.
 *
 *   4. Pill inventory is a calculated field. We never touch it blindly —
 *      every mutation is `recomputePillCount(med, logs)` against the log
 *      set, so the count can never silently drift out of sync.
 */

import type { Medication, DoseLog, DoseSchedule } from '@/types';
import {
  getDoseLogs,
  logDose,
  deleteDoseLog,
  saveMedication,
} from './storage';

// ── Small helpers ─────────────────────────────────────────────────────────

/**
 * Local-date helpers.
 *
 * Previously we compared `scheduledTime.startsWith(today())` where both
 * sides were UTC-based. This failed for users west of UTC: taking an
 * 8 PM PDT dose generates an ISO timestamp on the NEXT UTC day, which
 * then wasn't counted in "today's" logs. Home showed the slot as taken
 * (its set has no date filter) while Detail's `takenTodayLogs` missed
 * it, producing the "Home says 2/2, Detail says 1/2" contradiction.
 *
 * All date checks now operate on LOCAL calendar dates, and
 * `buildScheduledTimestamp` produces a local-prefixed ISO string so
 * the raw startsWith path (used by external callers) stays consistent
 * with `isSameLocalDay`.
 */
function localDateStr(d: Date = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function isSameLocalDay(iso: string, ref: Date = new Date()): boolean {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return false;
  return (
    d.getFullYear() === ref.getFullYear() &&
    d.getMonth() === ref.getMonth() &&
    d.getDate() === ref.getDate()
  );
}

function today(): string {
  return localDateStr();
}

function buildScheduledTimestamp(hhmm: string): string {
  const [h, m] = hhmm.split(':').map((n) => parseInt(n, 10));
  const d = new Date();
  if (!Number.isNaN(h)) d.setHours(h);
  if (!Number.isNaN(m)) d.setMinutes(m);
  d.setSeconds(0);
  d.setMilliseconds(0);
  // Build a local-date-prefixed ISO string (no Z) so startsWith-based
  // filters match the user's wall clock day. new Date(<this string>)
  // round-trips correctly because JS parses ISO strings without tz
  // offset as local time.
  const y = d.getFullYear();
  const mo = String(d.getMonth() + 1).padStart(2, '0');
  const da = String(d.getDate()).padStart(2, '0');
  const hh = String(d.getHours()).padStart(2, '0');
  const mi = String(d.getMinutes()).padStart(2, '0');
  return `${y}-${mo}-${da}T${hh}:${mi}:00.000`;
}

export function pillsPerDoseOf(med: Medication): number {
  return Math.max(1, med.pillsPerDose ?? 1);
}

export function maxDailyDoses(med: Medication): number {
  return Math.max(1, med.schedule.length || 1);
}

export function maxDailyPills(med: Medication): number {
  return maxDailyDoses(med) * pillsPerDoseOf(med);
}

// Returns all of *today's* logs for a single med, most-recent last.
// Uses `isSameLocalDay` so both legacy UTC-ISO timestamps and the new
// local-prefixed format get matched against the user's wall clock day.
export function todaysLogs(logs: DoseLog[], medId: string): DoseLog[] {
  const now = new Date();
  return logs
    .filter((l) => l.medicationId === medId && isSameLocalDay(l.scheduledTime, now))
    .sort((a, b) => a.scheduledTime.localeCompare(b.scheduledTime));
}

export function takenTodayLogs(logs: DoseLog[], medId: string): DoseLog[] {
  return todaysLogs(logs, medId).filter((l) => l.taken);
}

export function logsForSlotToday(
  logs: DoseLog[],
  medId: string,
  slotId: string
): DoseLog[] {
  return todaysLogs(logs, medId).filter((l) => l.notes === slotId);
}

// The next schedule slot that hasn't been taken today, if any. Used when
// a "Taken" is recorded from somewhere that isn't a slot-bound UI (e.g. the
// "Mark as taken" button on the detail page).
export function nextOpenSlot(
  med: Medication,
  logs: DoseLog[]
): DoseSchedule | undefined {
  const taken = new Set(
    takenTodayLogs(logs, med.id).map((l) => l.notes ?? '')
  );
  return med.schedule.find((s) => !taken.has(s.id));
}

// ── Pill inventory (calculated field) ─────────────────────────────────────

/**
 * Rebuild `currentCount` from: starting inventory, all taken logs across
 * all time (each costs `pillsPerDose` pills), and any manual refills
 * recorded via `refillInfo.totalCount` resets.
 *
 * We don't persist a full "inventory history" today, so we reconstruct by
 * taking `totalCount` (the last known full bottle) and deducting every
 * taken log since the med was last refilled. This keeps the count as a
 * derived value and eliminates the sync drift the user hit earlier.
 */
export function recomputePillCount(
  med: Medication,
  allLogs: DoseLog[]
): number {
  const pillsPerDose = pillsPerDoseOf(med);
  const total = med.refillInfo.totalCount || med.refillInfo.currentCount;
  // Any taken log for this med since refillDate (or beginning of time).
  const cutoff = med.refillInfo.refillDate
    ? new Date(med.refillInfo.refillDate).getTime()
    : 0;
  const takenSince = allLogs.filter(
    (l) =>
      l.medicationId === med.id &&
      l.taken &&
      new Date(l.scheduledTime).getTime() >= cutoff
  );
  const pillsConsumed = takenSince.length * pillsPerDose;
  return Math.max(0, total - pillsConsumed);
}

// ── Check helpers exposed to the UI (for rendering warnings) ──────────────

export interface DoseCheck {
  /** How many doses they've recorded today (taken, not skipped). */
  takenToday: number;
  /** How many doses they're scheduled for today. */
  scheduled: number;
  /** True if logging ONE more taken dose would exceed their daily cap. */
  wouldExceedDaily: boolean;
  /** True if they took another dose within 2 hours of the most recent one. */
  tooSoon: boolean;
  /** Minutes since the most recent taken dose, or null if none today. */
  minutesSinceLast: number | null;
}

export function checkNextTaken(
  med: Medication,
  logs: DoseLog[]
): DoseCheck {
  const taken = takenTodayLogs(logs, med.id);
  const scheduled = maxDailyDoses(med);
  const last = taken[taken.length - 1];
  const minutesSinceLast = last?.takenAt
    ? Math.floor((Date.now() - new Date(last.takenAt).getTime()) / 60000)
    : null;
  return {
    takenToday: taken.length,
    scheduled,
    wouldExceedDaily: taken.length + 1 > scheduled,
    tooSoon: minutesSinceLast !== null && minutesSinceLast < 120,
    minutesSinceLast,
  };
}

// ── Write operations ──────────────────────────────────────────────────────

interface WriteCtx {
  allLogs: DoseLog[];
}

async function withLogsContext(): Promise<WriteCtx> {
  return { allLogs: await getDoseLogs() };
}

/**
 * Mark `slot` (or the next open slot, if none given) for `med` as Taken
 * today. Removes any Skipped log that existed for the same slot today
 * (exclusive states) and recomputes the pill count.
 *
 * Returns the updated medication so callers can update their local state
 * without re-reading storage.
 */
export async function markDoseTaken(
  med: Medication,
  slotIdOrNull: string | null
): Promise<{ medication: Medication; log: DoseLog }> {
  const { allLogs } = await withLogsContext();

  // Resolve slot against FRESH storage state. The caller either knows
  // exactly which slot they want (Home: user tapped a specific row) or
  // asks for "next open" by passing null (Detail: "Take next dose").
  // When null, we pick the next truly-open slot from fresh storage so
  // rapid double-taps resolve to distinct slots (slot 1 then slot 2),
  // not the same one twice.
  const resolvedNextOpen =
    nextOpenSlot(med, allLogs)?.id ?? med.schedule[0]?.id ?? 'dose';
  const slotId = slotIdOrNull ?? resolvedNextOpen;
  const scheduleEntry = med.schedule.find((s) => s.id === slotId);

  // Idempotency: if this specific slot already has a Taken log today,
  // short-circuit. We do NOT auto-advance to another slot — that was
  // the bug that made "tap slot 1 twice" silently log slot 2, and made
  // Undo look like it erased everything. If the user genuinely wants a
  // different slot logged, they tap that slot (Home) or the Take-next
  // button (Detail, which passes null and we compute above).
  const existingForSlot = logsForSlotToday(allLogs, med.id, slotId);
  const existingTaken = existingForSlot.find((l) => l.taken);
  if (existingTaken) {
    return { medication: med, log: existingTaken };
  }

  // Remove any Skipped log for this slot today — Taken wins.
  const existingSkipped = existingForSlot.filter((l) => !l.taken);
  for (const l of existingSkipped) await deleteDoseLog(l.id);

  // Write the new Taken log. Random suffix guards against rapid-fire
  // id collisions within the same millisecond.
  const rand = Math.random().toString(36).slice(2, 8);
  const log: DoseLog = {
    id: `log-${med.id}-${slotId}-${Date.now()}-${rand}`,
    medicationId: med.id,
    medicationName: med.name,
    scheduledTime: scheduleEntry?.time
      ? buildScheduledTimestamp(scheduleEntry.time)
      : new Date().toISOString(),
    takenAt: new Date().toISOString(),
    taken: true,
    notes: slotId,
  };
  await logDose(log);

  // Rebuild the pill count against the new log set.
  const prunedIds = new Set(existingSkipped.map((l) => l.id));
  const updatedLogs = [
    ...allLogs.filter((l) => !prunedIds.has(l.id)),
    log,
  ];
  const nextCount = recomputePillCount(med, updatedLogs);
  const updated: Medication = {
    ...med,
    refillInfo: { ...med.refillInfo, currentCount: nextCount },
    updatedAt: new Date().toISOString(),
  };
  await saveMedication(updated);
  return { medication: updated, log };
}

/**
 * Mark a slot as Skipped today. If there was already a Taken log for the
 * same slot today we remove it (so taken & skipped stay exclusive) and
 * the pills it consumed are credited back to inventory via recompute.
 */
export async function markDoseSkipped(
  med: Medication,
  slotId: string
): Promise<{ medication: Medication; log: DoseLog }> {
  const { allLogs } = await withLogsContext();

  // 1. Remove any Taken log for this slot today — Skipped overrides it.
  const existingForSlot = logsForSlotToday(allLogs, med.id, slotId);
  const existingTaken = existingForSlot.filter((l) => l.taken);
  for (const l of existingTaken) await deleteDoseLog(l.id);
  // Also remove any prior Skipped log for the same slot to avoid dupes.
  const existingSkipped = existingForSlot.filter((l) => !l.taken);
  for (const l of existingSkipped) await deleteDoseLog(l.id);

  // 2. Write the Skipped log.
  const scheduleEntry = med.schedule.find((s) => s.id === slotId);
  const log: DoseLog = {
    id: `log-${med.id}-${slotId}-${Date.now()}-skip`,
    medicationId: med.id,
    medicationName: med.name,
    scheduledTime: scheduleEntry?.time
      ? buildScheduledTimestamp(scheduleEntry.time)
      : new Date().toISOString(),
    taken: false,
    notes: slotId,
  };
  await logDose(log);

  // 3. Rebuild pill count (the taken log we just removed credits pills back).
  const updatedLogs = [
    ...allLogs.filter(
      (l) =>
        !existingTaken.some((t) => t.id === l.id) &&
        !existingSkipped.some((s) => s.id === l.id)
    ),
    log,
  ];
  const nextCount = recomputePillCount(med, updatedLogs);
  const updated: Medication = {
    ...med,
    refillInfo: { ...med.refillInfo, currentCount: nextCount },
    updatedAt: new Date().toISOString(),
  };
  await saveMedication(updated);
  return { medication: updated, log };
}

/**
 * Undo a previously-taken dose. Deletes the log and credits the pills
 * back. Used by both Home ("Undo taken") and Detail ("tap Taken again").
 */
export async function undoDoseLog(
  med: Medication,
  logId: string
): Promise<Medication> {
  await deleteDoseLog(logId);
  const { allLogs } = await withLogsContext();
  const nextCount = recomputePillCount(med, allLogs);
  const updated: Medication = {
    ...med,
    refillInfo: { ...med.refillInfo, currentCount: nextCount },
    updatedAt: new Date().toISOString(),
  };
  await saveMedication(updated);
  return updated;
}
