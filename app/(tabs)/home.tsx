import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  RefreshControl,
  Pressable,
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useRouter } from 'expo-router';
import {
  getUserProfile,
  getMedications,
  getTodayDoseLogs,
  getDoseLogs,
} from '@/services/storage';
import {
  checkNextTaken,
  logsForSlotToday,
  markDoseTaken,
  undoDoseLog,
  pillsPerDoseOf,
  maxDailyPills,
  type DoseCheck,
} from '@/services/doseEngine';
import type { Medication, DoseSchedule, DoseLog, LifestyleReminder } from '@/types';
import { Colors, Spacing, BorderRadius, Typography } from '@/constants/theme';
import ChatbotFAB from '@/components/ChatbotFAB';

// ── Helpers ──────────────────────────────────────────────────────────────────

const WEEKDAY_SHORT = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
const MONTHS = [
  'January','February','March','April','May','June',
  'July','August','September','October','November','December',
];

function buildWeek(): { date: Date; isToday: boolean; weekday: string; day: number }[] {
  const today = new Date();
  const startOfWeek = new Date(today);
  startOfWeek.setDate(today.getDate() - today.getDay()); // Sunday as start
  const days = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(startOfWeek);
    d.setDate(startOfWeek.getDate() + i);
    days.push({
      date: d,
      isToday: d.toDateString() === today.toDateString(),
      weekday: WEEKDAY_SHORT[d.getDay()],
      day: d.getDate(),
    });
  }
  return days;
}

function hourOf(hhmm: string): number {
  if (!hhmm) return -1;
  const h = parseInt(hhmm.split(':')[0], 10);
  return Number.isNaN(h) ? -1 : h;
}

function formatClock(hhmm: string): string {
  if (!hhmm) return 'Any time';
  const [hStr, mStr] = hhmm.split(':');
  let h = parseInt(hStr, 10);
  const m = mStr ?? '00';
  const period = h >= 12 ? 'PM' : 'AM';
  h = h % 12;
  if (h === 0) h = 12;
  return `${h}:${m.padStart(2, '0')} ${period}`;
}

interface RoutineEntry {
  key: string;
  med: Medication;
  schedule: DoseSchedule;
}

function buildRoutineEntries(medications: Medication[]): RoutineEntry[] {
  const entries: RoutineEntry[] = [];
  for (const med of medications) {
    if (!med.schedule || med.schedule.length === 0) {
      entries.push({
        key: `${med.id}-asneeded`,
        med,
        schedule: {
          id: `${med.id}-asneeded`,
          time: '',
          mealRelation: 'any',
          timeOfDay: 'morning',
        },
      });
      continue;
    }
    for (const s of med.schedule) {
      entries.push({ key: `${med.id}-${s.id}`, med, schedule: s });
    }
  }
  return entries.sort((a, b) => {
    if (!a.schedule.time) return 1;
    if (!b.schedule.time) return -1;
    return a.schedule.time.localeCompare(b.schedule.time);
  });
}

function buildLifestyleReminders(medications: Medication[]): LifestyleReminder[] {
  const reminders: LifestyleReminder[] = [];
  for (const med of medications) {
    if (med.foodGuidance.avoidGrapefruit) reminders.push({ id: `${med.id}-grapefruit`, type: 'avoid', category: 'food', text: 'Grapefruit', medicationId: med.id });
    if (med.foodGuidance.avoidDairy) reminders.push({ id: `${med.id}-dairy`, type: 'avoid', category: 'food', text: 'Dairy', medicationId: med.id });
    if (med.foodGuidance.avoidAlcohol) reminders.push({ id: `${med.id}-alcohol`, type: 'avoid', category: 'drink', text: 'Alcohol', medicationId: med.id });
    for (const r of med.foodGuidance.customRestrictions) {
      reminders.push({ id: `${med.id}-${r}`, type: 'avoid', category: 'food', text: r, medicationId: med.id });
    }
  }
  const seen = new Set<string>();
  return reminders.filter((r) => {
    const k = r.text.toLowerCase();
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

/**
 * A deliberately louder, safety-themed alert when the user tries to log a
 * dose that would exceed their prescribed daily cap. The framing is the
 * key here — it should not read like a polite limit message. It names the
 * specific risk (overdose), uses the strongest cautionary words iOS'
 * Alert API supports (no Continue/Override button), and ends with a
 * clear next step (call the prescriber). We intentionally do NOT offer
 * an "override" button: if the user genuinely took an extra pill, they
 * need to talk to a clinician — not quietly log through a safety check.
 */
function showOverdoseAlert(med: Medication, cap: DoseCheck) {
  const perDose = Math.max(1, med.pillsPerDose ?? 1);
  const maxPills = maxDailyPills(med);
  Alert.alert(
    '⚠️  STOP — Possible overdose',
    `You've already logged ${cap.takenToday} of ${cap.scheduled} dose${cap.scheduled === 1 ? '' : 's'} of ${med.name} today (that's ${cap.takenToday * perDose} of ${maxPills} pills).\n\nTaking more than the prescribed dose can be dangerous. Please do NOT take another pill before speaking with your prescriber, pharmacist, or calling Poison Control (1-800-222-1222, US).\n\nMedsMinder won't record an extra dose to protect you.`,
    [
      { text: 'OK' },
    ],
    { cancelable: false }
  );
}

// ── Screen ───────────────────────────────────────────────────────────────────

export default function HomeScreen() {
  const router = useRouter();
  const [userName, setUserName] = useState('');
  const [medications, setMedications] = useState<Medication[]>([]);
  const [doseLogs, setDoseLogs] = useState<DoseLog[]>([]);
  const [refreshing, setRefreshing] = useState(false);

  const loadData = useCallback(async () => {
    const [profile, meds, logs] = await Promise.all([
      getUserProfile(),
      getMedications(),
      getTodayDoseLogs(),
    ]);
    setUserName(profile?.name ?? '');
    setMedications(meds);
    setDoseLogs(logs);
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  // Reload whenever the tab regains focus — so pill counts + freshly added
  // meds show up immediately after navigating from the Medications tab.
  useFocusEffect(
    useCallback(() => {
      loadData();
    }, [loadData])
  );

  async function handleRefresh() {
    setRefreshing(true);
    await loadData();
    setRefreshing(false);
  }

  // ── Dose actions (delegates to the shared dose engine) ─────────────────
  //
  // All of the tricky counting + exclusivity rules live in
  // `services/doseEngine.ts` so this screen and the Detail screen stay in
  // sync. These handlers are just the UI-layer confirmation popups.

  function applyUpdatedMed(updated: Medication) {
    setMedications((prev) => prev.map((m) => (m.id === updated.id ? updated : m)));
  }

  async function performTaken(entry: RoutineEntry) {
    const current = medications.find((m) => m.id === entry.med.id) ?? entry.med;
    // Pass the user's chosen slot explicitly — they tapped a specific
    // row, so we log THAT slot (not whichever slot is "next open"). The
    // engine is idempotent: if the slot already has a Taken log, it's
    // a no-op, so rapid double-taps on the same row can't create dupes.
    const { medication, log } = await markDoseTaken(current, entry.schedule.id);
    applyUpdatedMed(medication);
    setDoseLogs((prev) => {
      const today = new Date().toISOString().split('T')[0];
      const withoutSlot = prev.filter(
        (l) =>
          !(l.medicationId === medication.id &&
            l.notes === entry.schedule.id &&
            l.scheduledTime.startsWith(today))
      );
      return [...withoutSlot, log];
    });
  }

  /**
   * Undo a taken dose for this slot — deletes the log and credits pills
   * back. Replaces the old "Skipped" concept: users no longer explicitly
   * say "I'm skipping this dose today" (the app will figure that out on
   * its own at end-of-day / next-day). Undo is only for mistakes.
   */
  async function performUndo(entry: RoutineEntry) {
    const current = medications.find((m) => m.id === entry.med.id) ?? entry.med;
    // Use fresh storage so we never delete the wrong log (for example
    // if a log was just written by another screen).
    const fresh = await getDoseLogs();
    const slotLogs = logsForSlotToday(fresh, current.id, entry.schedule.id);
    const takenLog = slotLogs.find((l) => l.taken);
    if (!takenLog) return;
    const updated = await undoDoseLog(current, takenLog.id);
    applyUpdatedMed(updated);
    setDoseLogs((prev) => prev.filter((l) => l.id !== takenLog.id));
  }

  /**
   * Tap the Take pill. Two branches (all decisions use FRESH storage
   * so we don't mis-trigger Undo or the overdose alert from stale
   * component state):
   *   1. Not taken yet + under cap → log + deduct (with soft interval check).
   *   2. Already taken              → "Undo this dose?" confirmation.
   *   3. At the daily cap          → SAFETY alert (see below).
   */
  async function toggleTaken(entry: RoutineEntry) {
    const current = medications.find((m) => m.id === entry.med.id) ?? entry.med;
    const pillsPerDose = pillsPerDoseOf(current);
    const freshLogs = await getDoseLogs();
    const slotLogs = logsForSlotToday(freshLogs, current.id, entry.schedule.id);
    const takenLog = slotLogs.find((l) => l.taken);
    const cap = checkNextTaken(current, freshLogs);

    // Already Taken → offer Undo (the only correction path now).
    if (takenLog) {
      Alert.alert(
        'Undo this dose?',
        `Mark this dose as not taken and add ${pillsPerDose} pill${pillsPerDose > 1 ? 's' : ''} back to your inventory.`,
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Undo',
            style: 'destructive',
            onPress: () => performUndo(entry),
          },
        ]
      );
      return;
    }

    // HARD CAP — distinct, safety-styled alert. This is the scary one.
    if (cap.wouldExceedDaily) {
      showOverdoseAlert(current, cap);
      return;
    }

    // Soft "too soon" warning (last dose < 2h ago).
    if (cap.tooSoon && cap.minutesSinceLast != null) {
      Alert.alert(
        'Too soon since last dose',
        `You took another dose of ${current.name} just ${cap.minutesSinceLast} minute${cap.minutesSinceLast === 1 ? '' : 's'} ago. Doses are usually spaced further apart. Continue?`,
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Continue', onPress: () => performTaken(entry) },
        ]
      );
      return;
    }

    await performTaken(entry);
  }

  const week = useMemo(buildWeek, []);
  const routineEntries = useMemo(() => buildRoutineEntries(medications), [medications]);
  const lifestyleReminders = useMemo(() => buildLifestyleReminders(medications), [medications]);

  const takenKeySet = useMemo(() => {
    const s = new Set<string>();
    for (const l of doseLogs) if (l.taken) s.add(`${l.medicationId}-${l.notes ?? ''}`);
    return s;
  }, [doseLogs]);

  // Meds that have already hit (or passed) their daily dose cap today. Used
  // to lock the Take button on ALL of that med's remaining slots — you
  // can't log any more pills today once the prescription ceiling is
  // reached. This is the "hard cap" behavior we agreed on (no overrides).
  const capReachedMedIds = useMemo(() => {
    const s = new Set<string>();
    const today = new Date().toISOString().split('T')[0];
    for (const m of medications) {
      const scheduled = Math.max(1, m.schedule.length || 1);
      const takenToday = doseLogs.filter(
        (l) => l.taken && l.medicationId === m.id && l.scheduledTime.startsWith(today)
      ).length;
      if (takenToday >= scheduled) s.add(m.id);
    }
    return s;
  }, [medications, doseLogs]);

  // Group entries by time of day. IG-style lists get their hierarchy from
  // short ALL-CAPS section labels rather than visual chrome.
  const grouped = useMemo(() => {
    const morning: RoutineEntry[] = [];
    const afternoon: RoutineEntry[] = [];
    const evening: RoutineEntry[] = [];
    const anytime: RoutineEntry[] = [];
    for (const e of routineEntries) {
      const h = hourOf(e.schedule.time);
      if (h < 0) anytime.push(e);
      else if (h < 12) morning.push(e);
      else if (h < 17) afternoon.push(e);
      else evening.push(e);
    }
    return { morning, afternoon, evening, anytime };
  }, [routineEntries]);

  const today = new Date();
  const totalScheduled = routineEntries.filter((e) => e.schedule.time).length;
  const takenCount = routineEntries.filter(
    (e) => e.schedule.time && takenKeySet.has(`${e.med.id}-${e.schedule.id}`)
  ).length;

  return (
    <SafeAreaView style={styles.safeArea} edges={['top']}>
      {/* Minimal top bar — just the brand wordmark, no social icons */}
      <View style={styles.topBar}>
        <Text style={styles.logo}>MedsMinder</Text>
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={handleRefresh}
            tintColor={Colors.inkMuted}
          />
        }
      >
        {/* Greeting + summary */}
        <View style={styles.dateBlock}>
          <Text style={styles.dateMain}>
            {MONTHS[today.getMonth()]} {today.getDate()}
          </Text>
          <Text style={styles.dateSummary}>
            {userName ? `Hi ${userName}, ` : ''}
            {totalScheduled === 0
              ? 'no doses scheduled today'
              : takenCount === totalScheduled
              ? 'all doses taken today'
              : `${takenCount} of ${totalScheduled} doses taken`}
          </Text>
        </View>

        {/* Week strip */}
        <View style={styles.weekRow}>
          {week.map((d, i) => (
            <View key={i} style={styles.dayCol}>
              <Text style={[styles.dayWeekday, d.isToday && styles.dayWeekdayActive]}>
                {d.weekday}
              </Text>
              <View style={[styles.dayCircle, d.isToday && styles.dayCircleActive]}>
                <Text style={[styles.dayNum, d.isToday && styles.dayNumActive]}>
                  {d.day}
                </Text>
              </View>
            </View>
          ))}
        </View>

        <View style={styles.divider} />

        {medications.length === 0 ? (
          <View style={styles.empty}>
            <Ionicons name="calendar-outline" size={40} color={Colors.inkLight} />
            <Text style={styles.emptyTitle}>No medications yet</Text>
            <Text style={styles.emptyText}>
              Add your first medication in the Meds tab and it'll show up here.
            </Text>
          </View>
        ) : (
          <>
            <AgendaSection
              label="Morning"
              entries={grouped.morning}
              takenKeySet={takenKeySet}
              capReachedMedIds={capReachedMedIds}
              onToggleTaken={toggleTaken}
              onOpenMed={(m) => router.push(`/(tabs)/medications/${m.id}?from=home`)}
            />
            <AgendaSection
              label="Afternoon"
              entries={grouped.afternoon}
              takenKeySet={takenKeySet}
              capReachedMedIds={capReachedMedIds}
              onToggleTaken={toggleTaken}
              onOpenMed={(m) => router.push(`/(tabs)/medications/${m.id}?from=home`)}
            />
            <AgendaSection
              label="Evening"
              entries={grouped.evening}
              takenKeySet={takenKeySet}
              capReachedMedIds={capReachedMedIds}
              onToggleTaken={toggleTaken}
              onOpenMed={(m) => router.push(`/(tabs)/medications/${m.id}?from=home`)}
            />
            <AgendaSection
              label="As needed"
              entries={grouped.anytime}
              takenKeySet={takenKeySet}
              capReachedMedIds={capReachedMedIds}
              onToggleTaken={toggleTaken}
              onOpenMed={(m) => router.push(`/(tabs)/medications/${m.id}?from=home`)}
            />
          </>
        )}

        {/* Avoid-today reminders */}
        {lifestyleReminders.length > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionLabel}>Avoid today</Text>
            <View style={styles.avoidList}>
              {lifestyleReminders.map((r) => (
                <View key={r.id} style={styles.avoidRow}>
                  <View style={styles.avoidDot} />
                  <Text style={styles.avoidText}>{r.text}</Text>
                </View>
              ))}
            </View>
          </View>
        )}

        {/* Refill alerts */}
        {medications.filter((m) => m.refillInfo.currentCount <= 7).length > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionLabel}>Refills needed</Text>
            {medications
              .filter((m) => m.refillInfo.currentCount <= 7)
              .map((m) => (
                <Pressable
                  key={`refill-${m.id}`}
                  style={styles.refillRow}
                  onPress={() => router.push(`/(tabs)/medications/${m.id}?from=home`)}
                >
                  <Ionicons name="alert-circle" size={16} color={Colors.warning} />
                  <Text style={styles.refillText}>
                    <Text style={{ fontWeight: '600' }}>{m.name}</Text>
                    {' — '}
                    {m.refillInfo.currentCount} left
                  </Text>
                </Pressable>
              ))}
          </View>
        )}

        <View style={styles.bottomPad} />
      </ScrollView>

      <ChatbotFAB />
    </SafeAreaView>
  );
}

// ── Agenda section (time-of-day) ─────────────────────────────────────────────

function AgendaSection({
  label,
  entries,
  takenKeySet,
  capReachedMedIds,
  onToggleTaken,
  onOpenMed,
}: {
  label: string;
  entries: RoutineEntry[];
  takenKeySet: Set<string>;
  capReachedMedIds: Set<string>;
  onToggleTaken: (e: RoutineEntry) => void;
  onOpenMed: (m: Medication) => void;
}) {
  if (entries.length === 0) return null;
  return (
    <View style={styles.section}>
      <Text style={styles.sectionLabel}>{label}</Text>
      {entries.map((e) => {
        const taken = takenKeySet.has(`${e.med.id}-${e.schedule.id}`);
        const capReached = !taken && capReachedMedIds.has(e.med.id);
        return (
          <AgendaRow
            key={e.key}
            entry={e}
            taken={taken}
            capReached={capReached}
            onToggleTaken={() => onToggleTaken(e)}
            onOpenMed={() => onOpenMed(e.med)}
          />
        );
      })}
    </View>
  );
}

function AgendaRow({
  entry,
  taken,
  capReached,
  onToggleTaken,
  onOpenMed,
}: {
  entry: RoutineEntry;
  taken: boolean;
  capReached: boolean;
  onToggleTaken: () => void;
  onOpenMed: () => void;
}) {
  const { med, schedule } = entry;
  const mealSuffix =
    schedule.mealRelation === 'with-meal'
      ? ' · with meal'
      : schedule.mealRelation === 'empty-stomach'
      ? ' · empty stomach'
      : '';

  // The only affordance is the Take pill. States:
  //   untouched → "Take" (primary blue)
  //   taken     → "Taken ✓" (green); tapping opens Undo confirmation
  //   at cap    → "Max today" (greyed); tapping triggers the overdose
  //               safety alert (logic lives in toggleTaken above)
  const label = taken ? 'Taken' : capReached ? 'Max today' : 'Take';

  return (
    <View style={styles.agendaRow}>
      <Pressable onPress={onOpenMed} style={styles.agendaLeft} hitSlop={4}>
        <Text style={styles.agendaTime}>{formatClock(schedule.time)}</Text>
        <View style={styles.agendaMedLine}>
          <View style={[styles.agendaDot, { backgroundColor: med.color }]} />
          <Text style={styles.agendaMedName} numberOfLines={1}>
            {med.name}
          </Text>
        </View>
        <Text style={styles.agendaMedSub} numberOfLines={1}>
          {med.dose}
          {mealSuffix}
        </Text>
      </Pressable>

      <Pressable
        onPress={onToggleTaken}
        hitSlop={10}
        style={({ pressed }) => [
          styles.doneBtn,
          taken && styles.doneBtnTaken,
          capReached && styles.doneBtnDisabled,
          pressed && { opacity: 0.7 },
        ]}
        accessibilityRole="button"
        accessibilityLabel={
          taken
            ? 'Taken — tap to undo'
            : capReached
              ? 'Daily dose limit reached'
              : 'Mark as taken'
        }
      >
        {taken ? (
          <>
            <Ionicons name="checkmark" size={16} color={Colors.textOnPrimary} />
            <Text style={styles.doneBtnLabelTaken}>{label}</Text>
          </>
        ) : (
          <Text
            style={[
              styles.doneBtnLabel,
              capReached && styles.doneBtnLabelDisabled,
            ]}
          >
            {label}
          </Text>
        )}
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: Colors.background },
  scroll: { flex: 1 },
  content: { paddingBottom: Spacing.lg },

  topBar: {
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Colors.border,
  },
  logo: { ...Typography.h1, color: Colors.ink },

  dateBlock: {
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.lg,
    paddingBottom: Spacing.sm,
  },
  dateMain: { ...Typography.display, color: Colors.ink },
  dateSummary: { ...Typography.body, color: Colors.inkMuted, marginTop: 4 },

  weekRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.md,
  },
  dayCol: { alignItems: 'center', gap: 6, flex: 1 },
  dayWeekday: { ...Typography.caption, color: Colors.inkMuted, fontWeight: '600' },
  dayWeekdayActive: { color: Colors.primary },
  dayCircle: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dayCircleActive: {
    backgroundColor: Colors.primary,
  },
  dayNum: { ...Typography.h4, color: Colors.ink, fontWeight: '600' },
  dayNumActive: { color: Colors.textOnPrimary, fontWeight: '700' },

  divider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: Colors.border,
  },

  section: {
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.lg,
    paddingBottom: Spacing.sm,
  },
  sectionLabel: {
    ...Typography.label,
    color: Colors.inkMuted,
    marginBottom: Spacing.sm,
  },

  agendaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Colors.divider,
  },
  agendaLeft: { flex: 1, gap: 2 },
  agendaTime: {
    ...Typography.bodySmall,
    color: Colors.inkMuted,
    fontWeight: '600',
  },
  agendaMedLine: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
  },
  agendaDot: { width: 8, height: 8, borderRadius: 4 },
  agendaMedName: { ...Typography.h4, color: Colors.ink, flex: 1 },
  agendaMedSub: { ...Typography.bodySmall, color: Colors.inkMuted, marginLeft: 16 },

  // IG "Follow" button pattern — primary blue CTA when untouched, outlined
  // confirmation state once tapped.
  doneBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    minWidth: 72,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: BorderRadius.md,
    backgroundColor: Colors.primary,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Colors.primary,
  },
  doneBtnTaken: {
    backgroundColor: Colors.success,
    borderColor: Colors.success,
  },
  doneBtnDisabled: {
    backgroundColor: Colors.surface,
    borderColor: Colors.border,
  },
  doneBtnLabel: {
    ...Typography.bodySmall,
    color: Colors.textOnPrimary,
    fontWeight: '700',
  },
  doneBtnLabelTaken: {
    ...Typography.bodySmall,
    color: Colors.textOnPrimary,
    fontWeight: '700',
  },
  doneBtnLabelDisabled: {
    color: Colors.inkLight,
    fontWeight: '700',
  },

  avoidList: { gap: 6 },
  avoidRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, paddingVertical: 4 },
  avoidDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: Colors.accent },
  avoidText: { ...Typography.body, color: Colors.inkSoft },

  refillRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    paddingVertical: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Colors.divider,
  },
  refillText: { ...Typography.body, color: Colors.inkSoft },

  empty: {
    alignItems: 'center',
    gap: Spacing.sm,
    paddingHorizontal: Spacing.lg,
    paddingVertical: 60,
  },
  emptyTitle: { ...Typography.h3, color: Colors.inkMuted },
  emptyText: { ...Typography.body, color: Colors.inkLight, textAlign: 'center' },

  bottomPad: { height: 80 },
});
