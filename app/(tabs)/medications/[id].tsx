import React, { useCallback, useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  Linking,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useLocalSearchParams, useNavigation, useRouter } from 'expo-router';
import { CommonActions } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { getMedications, saveMedication, getDoseLogs } from '@/services/storage';
// getDoseLogs is also used below to refetch fresh logs right before
// mutating — component state can be stale on rapid double-taps.
import { generateMedicationInfo } from '@/services/claude';
import { enrichMedicationFromLabel } from '@/hooks/useMedications';
import {
  checkNextTaken,
  markDoseTaken,
  undoDoseLog,
  nextOpenSlot,
  pillsPerDoseOf,
  takenTodayLogs,
  maxDailyPills,
  type DoseCheck,
} from '@/services/doseEngine';
import type { Medication, DoseLog } from '@/types';
import { Colors, Spacing, BorderRadius, Typography, Shadow } from '@/constants/theme';
import { Privacy } from '@/constants/privacy';
import Badge from '@/components/ui/Badge';
import Button from '@/components/ui/Button';
import PrivacyNotice from '@/components/ui/PrivacyNotice';

/**
 * Safety-themed alert shown when the user tries to log a dose that
 * would exceed their prescribed daily maximum. Unlike a normal "limit
 * reached" message, this one names the risk explicitly (overdose),
 * points to Poison Control / their prescriber, and — importantly —
 * offers NO override button. The user can't accidentally tap through.
 */
function showOverdoseAlert(med: Medication, cap: DoseCheck) {
  const perDose = Math.max(1, med.pillsPerDose ?? 1);
  const maxPills = maxDailyPills(med);
  Alert.alert(
    '⚠️  STOP — Possible overdose',
    `You've already logged ${cap.takenToday} of ${cap.scheduled} dose${cap.scheduled === 1 ? '' : 's'} of ${med.name} today (that's ${cap.takenToday * perDose} of ${maxPills} pills).\n\nTaking more than the prescribed dose can be dangerous. Please do NOT take another pill before speaking with your prescriber, pharmacist, or calling Poison Control (1-800-222-1222, US).\n\nMedsMinder won't record an extra dose to protect you.`,
    [{ text: 'OK' }],
    { cancelable: false }
  );
}

export default function MedicationDetailScreen() {
  const { id, from } = useLocalSearchParams<{ id: string; from?: string }>();
  const router = useRouter();
  const navigation = useNavigation();

  const [med, setMed] = useState<Medication | null>(null);
  const [logs, setLogs] = useState<DoseLog[]>([]);
  const [loadingAI, setLoadingAI] = useState(false);
  const [aiExpanded, setAiExpanded] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  // Reload whenever the screen regains focus so that pill counts and
  // just-added logs stay in sync with changes made elsewhere (home tab,
  // another detail open, etc.).
  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      async function load() {
        const meds = await getMedications();
        const found = meds.find((m) => m.id === id);
        if (cancelled) return;
        setMed(found ?? null);
        if (found) {
          const l = await getDoseLogs(found.id);
          if (!cancelled) setLogs(l.slice(-30));
        }
      }
      load();
      return () => {
        cancelled = true;
      };
    }, [id])
  );

  // ── Dose actions (delegates to the shared dose engine) ────────────────
  //
  // The detail page lets the user log against the NEXT open slot for
  // today. All of the exclusivity / warning / pill-math rules live in
  // `services/doseEngine.ts` so this screen and home.tsx stay consistent.

  async function performTaken(target: Medication) {
    // Always pass null so the engine resolves the next open slot from
    // FRESH storage. Two rapid "Take next dose" taps will resolve to
    // slot 1 then slot 2, not slot 1 twice.
    const { medication, log } = await markDoseTaken(target, null);
    setMed(medication);
    setLogs((prev) => {
      // Drop any existing log for the same slot today, then append the
      // newly written log. This keeps optimistic state in sync with
      // the engine's idempotency guarantee (one Taken log per slot).
      const today = new Date().toISOString().split('T')[0];
      const withoutSlot = prev.filter(
        (l) =>
          !(l.notes === log.notes &&
            l.medicationId === medication.id &&
            l.scheduledTime.startsWith(today))
      );
      return [...withoutSlot, log];
    });
  }

  async function performUndoLast(target: Medication) {
    // Re-read from storage so we're undoing the actual latest log, not
    // whatever stale copy the component has in memory.
    const fresh = await getDoseLogs();
    const taken = takenTodayLogs(fresh, target.id);
    const last = taken[taken.length - 1];
    if (!last) {
      Alert.alert('Nothing to undo', 'No doses have been logged today.');
      return;
    }
    const updated = await undoDoseLog(target, last.id);
    setMed(updated);
    setLogs((prev) => prev.filter((l) => l.id !== last.id));
  }

  /**
   * Log the next dose. Flow (evaluated against FRESH storage):
   *   • Daily cap reached          → safety-styled overdose alert (NO
   *                                   override button).
   *   • Last dose < 2h ago         → soft "too soon" confirmation.
   *   • Otherwise                  → log + deduct, no prompt.
   *
   * No "Skip" button anymore — MedsMinder infers missed doses from the
   * absence of a Taken log at end-of-day. The only correction path is
   * Undo, which removes the most-recent Taken log and credits pills
   * back.
   */
  async function handleLogTaken() {
    if (!med) return;
    // Refetch logs every tap so stale component state can't cause us
    // to mis-trigger the overdose alert or the "too soon" warning.
    const freshLogs = await getDoseLogs();
    const check = checkNextTaken(med, freshLogs);

    if (check.wouldExceedDaily) {
      showOverdoseAlert(med, check);
      return;
    }

    if (check.tooSoon && check.minutesSinceLast != null) {
      Alert.alert(
        'Too soon since last dose',
        `You took ${med.name} just ${check.minutesSinceLast} minute${check.minutesSinceLast === 1 ? '' : 's'} ago. Doses are usually spaced further apart. Continue?`,
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Continue', onPress: () => performTaken(med) },
        ]
      );
      return;
    }

    await performTaken(med);
  }

  /**
   * Undo the most-recent Taken dose for today (correction path only).
   */
  async function handleUndoLast() {
    if (!med) return;
    const fresh = await getDoseLogs();
    const taken = takenTodayLogs(fresh, med.id);
    const last = taken[taken.length - 1];
    const pillsPerDose = pillsPerDoseOf(med);
    if (!last) {
      Alert.alert('Nothing to undo', 'No doses have been logged today.');
      return;
    }
    Alert.alert(
      'Undo the last dose?',
      `This removes the latest Taken log and adds ${pillsPerDose} pill${pillsPerDose > 1 ? 's' : ''} back to your inventory.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Undo',
          style: 'destructive',
          onPress: () => performUndoLast(med),
        },
      ]
    );
  }

  async function handleGenerateAI() {
    if (!med) return;

    Alert.alert(
      '⚠️ AI Info Request',
      Privacy.MED_AI_NOTICE + '\n\nContinue?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Generate',
          onPress: async () => {
            setLoadingAI(true);
            setAiExpanded(true);
            try {
              const aiInfo = await generateMedicationInfo(med.name, med.dose);
              const updated = { ...med, aiInfo, updatedAt: new Date().toISOString() };
              await saveMedication(updated);
              setMed(updated);
            } catch (err: unknown) {
              const message = err instanceof Error ? err.message : 'Unknown error';
              Alert.alert('Error', `Failed to generate AI info: ${message}`);
            }
            setLoadingAI(false);
          },
        },
      ]
    );
  }

  async function handleRefreshInfo() {
    if (!med || refreshing) return;
    setRefreshing(true);
    try {
      const status = await enrichMedicationFromLabel(med.id);
      if (status.ok) {
        setMed(status.med);
        if (!status.inDatabase) {
          Alert.alert(
            'Drug not in our database',
            `"${med.name}" isn't in our local FDA label database yet. Try a common generic name (e.g. "ibuprofen" instead of a brand like "Advil").`
          );
        }
        // If inDatabase but lists are empty, we leave the UI empty-state in
        // place — no alert, because we DID reach the DB, the label just
        // didn't surface anything new.
      } else if (status.reason === 'unreachable') {
        Alert.alert(
          'Backend not reachable',
          'Make sure the backend is running (python3 main.py) and the IP in your .env matches your Mac.'
        );
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      Alert.alert('Refresh failed', message);
    }
    setRefreshing(false);
  }

  function handleUpdateRefill() {
    if (!med) return;
    Alert.prompt(
      'Update Refill Count',
      'Enter current number of pills remaining:',
      async (val) => {
        if (!val) return;
        const count = parseInt(val, 10);
        if (isNaN(count)) return;
        const updated = {
          ...med,
          refillInfo: { ...med.refillInfo, currentCount: count },
          updatedAt: new Date().toISOString(),
        };
        await saveMedication(updated);
        setMed(updated);
      },
      'plain-text',
      String(med.refillInfo.currentCount)
    );
  }

  if (!med) {
    return (
      <SafeAreaView style={styles.safeArea} edges={['top']}>
        <ActivityIndicator color={Colors.primary} style={styles.loader} />
      </SafeAreaView>
    );
  }

  const refillPercent = (med.refillInfo.currentCount / (med.refillInfo.totalCount || 30)) * 100;
  const refillLow = med.refillInfo.currentCount <= 7;

  return (
    <SafeAreaView style={styles.safeArea} edges={['top']}>
      {/* IG-style nav: back chevron + page title (medication handle) + more */}
      <View style={styles.headerRow}>
        <TouchableOpacity
          onPress={() => {
            // Origin-aware back navigation. Tapping a med from Home
            // crosses tabs (the detail lives in the medications stack),
            // so a plain `router.back()` lands on the medications LIST
            // instead of Home. We thread a `?from=home` query param on
            // the outgoing push and honor it here.
            //
            // Important: we FIRST pop ourselves off the medications
            // stack via `navigation.goBack()` so the meds stack lands
            // back on the list — otherwise the detail stays parked at
            // the top and tapping the Meds tab later shows detail
            // again instead of the all-medications list. Then we
            // switch to the Home tab via the parent tab navigator.
            if (from === 'home') {
              if (navigation.canGoBack()) navigation.goBack();
              const parent = navigation.getParent();
              if (parent) {
                parent.dispatch(CommonActions.navigate({ name: 'home' }));
              } else {
                router.replace('/(tabs)/home');
              }
            } else if (router.canGoBack()) {
              router.back();
            } else {
              router.replace('/(tabs)/medications');
            }
          }}
          style={styles.backBtn}
          activeOpacity={0.6}
          hitSlop={10}
        >
          <Ionicons name="chevron-back" size={26} color={Colors.ink} />
        </TouchableOpacity>
        <Text style={styles.headerTitle} numberOfLines={1}>
          {med.name.toLowerCase().replace(/\s+/g, '_')}
        </Text>
        <TouchableOpacity
          onPress={handleRefreshInfo}
          disabled={refreshing}
          hitSlop={10}
        >
          {refreshing ? (
            <ActivityIndicator color={Colors.inkMuted} size="small" />
          ) : (
            <Ionicons name="refresh-outline" size={22} color={Colors.ink} />
          )}
        </TouchableOpacity>
      </View>

      <ScrollView style={styles.scroll} contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>

        {/* IG profile-header: avatar + stats */}
        <View style={styles.profileHeader}>
          <View style={[styles.profileAvatar, { backgroundColor: med.color }]}>
            <Text style={styles.profileAvatarText}>
              {med.name.split(' ').map((s) => s[0]).join('').slice(0, 2).toUpperCase()}
            </Text>
          </View>
          <View style={styles.profileStats}>
            {/* Today-scoped count to match the Home agenda's "N of M
                doses taken" header (the all-time count would diverge
                as soon as the user has more than one day of history). */}
            <Stat
              label="Today"
              value={`${takenTodayLogs(logs, med.id).length}/${Math.max(1, med.schedule.length || 1)}`}
            />
            <Stat label="Per day" value={String(med.schedule.length || '—')} />
            <Stat label="Left" value={String(med.refillInfo.currentCount)} />
          </View>
        </View>

        {/* Bio-style text */}
        <View style={styles.profileBio}>
          <Text style={styles.profileName}>{med.name}</Text>
          <Text style={styles.profileDose}>{med.dose}</Text>
          {med.purpose ? <Text style={styles.profilePurpose}>{med.purpose}</Text> : null}
        </View>

        {/* Primary action row. No "Skipped" button anymore — the app
            infers missed doses from the absence of a Taken log. The
            only correction path is Undo, which only appears when there
            IS something to undo (a Taken log recorded today). */}
        {(() => {
          const cap = checkNextTaken(med, logs);
          const atCap = cap.wouldExceedDaily;
          const taken = takenTodayLogs(logs, med.id);
          const hasUndo = taken.length > 0;
          const open = nextOpenSlot(med, logs);
          const takenLabel = atCap
            ? `Max today (${cap.takenToday}/${cap.scheduled})`
            : open
              ? `Take next dose`
              : 'Take dose';
          return (
            <View style={styles.actionRow}>
              <Button
                label={takenLabel}
                onPress={handleLogTaken}
                variant="primary"
                size="sm"
                disabled={atCap}
                style={styles.logBtn}
              />
              {hasUndo && (
                <Button
                  label="Undo last"
                  onPress={handleUndoLast}
                  variant="secondary"
                  size="sm"
                  style={styles.logBtn}
                />
              )}
            </View>
          );
        })()}

        {/* Schedule */}
        {med.schedule.length > 0 && (
          <Section title="Schedule">
            {med.schedule.map((s) => (
              <View key={s.id} style={styles.scheduleRow}>
                <View style={[styles.scheduleIconWrap, { backgroundColor: withAlpha(med.color, 0.18) }]}>
                  <Ionicons name="time-outline" size={14} color={Colors.ink} />
                </View>
                <Text style={styles.scheduleText}>
                  <Text style={styles.scheduleTime}>{s.time}</Text>
                  {' · '}
                  {s.mealRelation === 'with-meal' ? 'With meal' : s.mealRelation === 'empty-stomach' ? 'Empty stomach' : 'Any time'}
                </Text>
              </View>
            ))}
          </Section>
        )}

        {/* Auto-filled info note */}
        <View style={styles.autoInfoHeader}>
          <Ionicons name="sparkles-outline" size={14} color={Colors.primary} />
          <Text style={styles.autoInfoText}>
            Auto-filled from FDA label — tap <Text style={{ fontWeight: '700' }}>refresh</Text> above to reload
          </Text>
        </View>

        {/* Food guidance chips */}
        <Section title="Food & Drug Guidance">
          <View style={styles.chipRow}>
            {med.foodGuidance.takeWithFood && <Badge label="🍽 Take with food" variant="primary" />}
            {med.foodGuidance.avoidAlcohol && <Badge label="🚫 Avoid alcohol" variant="danger" />}
            {med.foodGuidance.avoidGrapefruit && <Badge label="🚫 Avoid grapefruit" variant="danger" />}
            {med.foodGuidance.avoidDairy && <Badge label="🚫 Avoid dairy" variant="warning" />}
            {med.foodGuidance.customRestrictions.map((r) => (
              <Badge key={r} label={`🚫 Avoid ${r}`} variant="warning" />
            ))}
            {!med.foodGuidance.takeWithFood &&
              !med.foodGuidance.avoidAlcohol &&
              !med.foodGuidance.avoidGrapefruit &&
              !med.foodGuidance.avoidDairy &&
              med.foodGuidance.customRestrictions.length === 0 && (
              <Text style={styles.noRestrictions}>
                No specific restrictions found. Tap refresh ↑ to try again.
              </Text>
            )}
          </View>
        </Section>

        {/* Side effects */}
        <Section title="Side Effects">
          {med.sideEffects.length > 0 ? (
            med.sideEffects.map((se, i) => (
              <Text key={i} style={styles.listItem}>• {se}</Text>
            ))
          ) : (
            <Text style={styles.noRestrictions}>
              {refreshing
                ? 'Loading from FDA label…'
                : 'Not loaded yet. Tap refresh ↑ to pull from the FDA label.'}
            </Text>
          )}
        </Section>

        {/* Contraindications */}
        <Section title="Contraindications & Warnings">
          {med.contraindications.length > 0 ? (
            med.contraindications.map((c, i) => (
              <Text key={i} style={styles.listItemDanger}>⚠️ {c}</Text>
            ))
          ) : (
            <Text style={styles.noRestrictions}>
              {refreshing
                ? 'Loading from FDA label…'
                : 'Not loaded yet. Tap refresh ↑ to pull from the FDA label.'}
            </Text>
          )}
        </Section>

        {/* Refill tracker */}
        <Section title="Refill Tracker">
          <View style={styles.refillInfo}>
            {/* Number and label are SEPARATE Text nodes. Previously the number
                was nested inside a body-sized Text, which clipped its 28pt
                glyphs to the parent's 20pt lineHeight. */}
            <Text style={[styles.refillNumber, refillLow && { color: Colors.danger }]}>
              {med.refillInfo.currentCount}
            </Text>
            <Text style={styles.refillCount}>pills remaining</Text>
            {refillLow && <Badge label="⚠️ Refill soon" variant="warning" />}
          </View>
          <View style={styles.progressBg}>
            <View
              style={[
                styles.progressFill,
                {
                  width: `${Math.min(100, Math.max(0, refillPercent))}%`,
                  backgroundColor: refillLow ? Colors.danger : Colors.primary,
                },
              ]}
            />
          </View>
          <Button label="Update count" onPress={handleUpdateRefill} variant="ghost" size="sm" style={styles.refillBtn} />
        </Section>

        {/* Dose log history */}
        {logs.length > 0 && (
          <Section title="Recent Logs">
            {logs.slice(-5).reverse().map((log) => (
              <View key={log.id} style={styles.logEntry}>
                <Ionicons
                  name={log.taken ? 'checkmark-circle' : 'close-circle'}
                  size={18}
                  color={log.taken ? Colors.success : Colors.danger}
                />
                <Text style={styles.logDate}>
                  {new Date(log.scheduledTime).toLocaleDateString()} — {log.taken ? 'Taken' : 'Skipped'}
                </Text>
              </View>
            ))}
          </Section>
        )}

        {/* More Information — lives inside a standard Section so text
            wraps with the same horizontal padding as everything else.
            Previously this was inside a Card with custom padding, which
            made long FDA summaries visually "cut off". */}
        <View style={styles.section}>
          <TouchableOpacity
            style={styles.aiSectionHeader}
            onPress={() => setAiExpanded(!aiExpanded)}
            activeOpacity={0.6}
          >
            <View style={styles.aiTitleRow}>
              <Ionicons name="information-circle-outline" size={18} color={Colors.primary} />
              <View style={{ flex: 1 }}>
                <Text style={styles.aiTitle}>More Information</Text>
                <Text style={styles.aiSubtitle}>
                  AI-generated from FDA drug labels
                </Text>
              </View>
            </View>
            <Ionicons
              name={aiExpanded ? 'chevron-up' : 'chevron-down'}
              size={20}
              color={Colors.inkMuted}
            />
          </TouchableOpacity>

          {aiExpanded && (
            <View style={styles.aiBody}>
              <PrivacyNotice message={Privacy.MED_AI_NOTICE} dismissable />

              {loadingAI ? (
                <ActivityIndicator color={Colors.primary} style={styles.aiLoader} />
              ) : med.aiInfo ? (
                <>
                  <Text style={styles.aiText}>{med.aiInfo.summary}</Text>

                  {med.aiInfo.sideEffects.length > 0 && (
                    <>
                      <Text style={styles.aiSectionLabel}>Side Effects</Text>
                      {med.aiInfo.sideEffects.map((s, i) => (
                        <Text key={i} style={styles.listItem}>• {s}</Text>
                      ))}
                    </>
                  )}

                  {med.aiInfo.interactions.length > 0 && (
                    <>
                      <Text style={styles.aiSectionLabel}>Interactions</Text>
                      {med.aiInfo.interactions.map((s, i) => (
                        <Text key={i} style={styles.listItemDanger}>⚠️ {s}</Text>
                      ))}
                    </>
                  )}

                  {med.aiInfo.sources.length > 0 && (
                    <View style={styles.aiSourceFooter}>
                      <Text style={styles.aiSourceFooterLabel}>FDA label:</Text>
                      {dedupeSources(med.aiInfo.sources).map((s) => (
                        <TouchableOpacity
                          key={s.url}
                          onPress={() => openAiSource(s.url)}
                          activeOpacity={0.6}
                          style={styles.aiSourceChip}
                        >
                          <Text style={styles.aiSourceChipText} numberOfLines={1}>
                            {s.drug}
                          </Text>
                          <Ionicons name="open-outline" size={11} color={Colors.primaryDark} />
                        </TouchableOpacity>
                      ))}
                    </View>
                  )}

                  <Text style={styles.aiDisclaimer}>{Privacy.AI_DISCLAIMER}</Text>

                  <Button
                    label="Regenerate"
                    onPress={handleGenerateAI}
                    variant="ghost"
                    size="sm"
                    style={styles.regenerateBtn}
                  />
                </>
              ) : (
                <Button
                  label="Load More Information"
                  onPress={handleGenerateAI}
                  variant="secondary"
                  size="sm"
                />
              )}
            </View>
          )}
        </View>

        <View style={styles.bottomPad} />
      </ScrollView>
    </SafeAreaView>
  );
}

function dedupeSources<T extends { drug: string; url: string }>(sources: T[]): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const s of sources) {
    if (typeof (s as unknown as string) === 'string') continue;
    const key = s.drug.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(s);
  }
  return out;
}

async function openAiSource(url: string) {
  try {
    const supported = await Linking.canOpenURL(url);
    if (supported) await Linking.openURL(url);
    else Alert.alert('Cannot open link', url);
  } catch {
    Alert.alert('Cannot open link', url);
  }
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionLabel}>{title}</Text>
      <View style={styles.sectionContent}>{children}</View>
    </View>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.statCol}>
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

function withAlpha(hex: string, alpha: number): string {
  const clean = hex.replace('#', '');
  const h = clean.length === 3 ? clean.split('').map((c) => c + c).join('') : clean;
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: Colors.background },
  loader: { marginTop: 80 },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Colors.border,
  },
  backBtn: {
    width: 32,
    height: 32,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: {
    ...Typography.h3,
    color: Colors.ink,
    flex: 1,
    marginHorizontal: Spacing.sm,
  },
  scroll: { flex: 1 },
  content: { paddingBottom: Spacing.lg },
  profileHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: Spacing.md,
    paddingTop: Spacing.md,
    gap: Spacing.lg,
  },
  profileAvatar: {
    width: 86,
    height: 86,
    borderRadius: 43,
    alignItems: 'center',
    justifyContent: 'center',
  },
  profileAvatarText: {
    ...Typography.display,
    color: Colors.textOnPrimary,
    fontSize: 30,
  },
  profileStats: {
    flex: 1,
    flexDirection: 'row',
    justifyContent: 'space-around',
  },
  statCol: { alignItems: 'center', gap: 2 },
  statValue: { ...Typography.h2, color: Colors.ink },
  statLabel: { ...Typography.bodySmall, color: Colors.inkMuted },
  profileBio: {
    paddingHorizontal: Spacing.md,
    paddingTop: Spacing.sm,
    gap: 2,
  },
  profileName: { ...Typography.h3, color: Colors.ink },
  profileDose: { ...Typography.body, color: Colors.inkSoft, fontWeight: '500' },
  profilePurpose: { ...Typography.body, color: Colors.inkMuted },
  actionRow: {
    flexDirection: 'row',
    gap: Spacing.sm,
    paddingHorizontal: Spacing.md,
    paddingTop: Spacing.md,
    paddingBottom: Spacing.md,
  },
  logBtn: { flex: 1 },
  section: {
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.md,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: Colors.border,
    gap: Spacing.sm,
  },
  sectionLabel: { ...Typography.label, color: Colors.inkMuted },
  sectionContent: { gap: Spacing.sm },
  scheduleIconWrap: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  scheduleTime: { fontWeight: '700', color: Colors.ink },
  autoInfoHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    paddingHorizontal: Spacing.md,
    paddingVertical: 10,
    backgroundColor: Colors.primaryLight,
  },
  autoInfoText: {
    ...Typography.bodySmall,
    color: Colors.inkSoft,
    flex: 1,
  },
  scheduleRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  scheduleText: { ...Typography.body, color: Colors.inkSoft, flex: 1 },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.xs },
  noRestrictions: { ...Typography.body, color: Colors.textLight, fontStyle: 'italic' },
  listItem: { ...Typography.body, color: Colors.text, lineHeight: 24 },
  listItemDanger: { ...Typography.body, color: Colors.dangerDark, lineHeight: 24 },
  refillInfo: {
    flexDirection: 'row',
    alignItems: 'baseline',
    flexWrap: 'wrap',
    gap: 6,
    marginBottom: Spacing.sm,
  },
  refillCount: { ...Typography.body, color: Colors.inkSoft },
  refillNumber: {
    fontSize: 32,
    // Give the glyphs their own lineHeight — without this, the number
    // inherits the row's baseline and the top/bottom get clipped.
    lineHeight: 38,
    fontWeight: '800',
    color: Colors.ink,
    letterSpacing: -0.5,
  },
  progressBg: {
    height: 10,
    backgroundColor: '#E8EBE3',
    borderRadius: BorderRadius.pill,
    overflow: 'hidden',
  },
  progressFill: { height: '100%', borderRadius: BorderRadius.pill, backgroundColor: Colors.ink },
  refillBtn: { marginTop: Spacing.sm, alignSelf: 'flex-start' },
  logEntry: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  logDate: { ...Typography.bodySmall, color: Colors.textSecondary },
  aiSectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: Spacing.sm,
  },
  aiTitleRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Spacing.sm,
    flex: 1,
  },
  aiTitle: { ...Typography.h4, color: Colors.ink },
  aiSubtitle: {
    ...Typography.caption,
    color: Colors.inkMuted,
    fontStyle: 'italic',
    marginTop: 2,
  },
  aiBody: { gap: Spacing.sm, marginTop: Spacing.sm },
  aiLoader: { margin: Spacing.lg },
  aiSectionLabel: { ...Typography.label, color: Colors.text, marginTop: Spacing.sm },
  aiSourceFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 6,
    marginTop: Spacing.md,
    paddingTop: Spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: Colors.divider,
  },
  aiSourceFooterLabel: {
    ...Typography.caption,
    color: Colors.textLight,
    fontStyle: 'italic',
    marginRight: 2,
  },
  aiSourceChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: Colors.primaryLight,
    borderRadius: BorderRadius.pill,
    paddingHorizontal: 10,
    paddingVertical: 3,
  },
  aiSourceChipText: {
    ...Typography.caption,
    color: Colors.primaryDark,
    fontWeight: '600',
    textTransform: 'capitalize',
  },
  aiText: { ...Typography.body, color: Colors.text, lineHeight: 22 },
  aiDisclaimer: {
    ...Typography.caption,
    color: Colors.textLight,
    fontStyle: 'italic',
    lineHeight: 16,
    marginTop: Spacing.sm,
  },
  regenerateBtn: { marginTop: Spacing.sm },
  bottomPad: { height: 100 },
});
