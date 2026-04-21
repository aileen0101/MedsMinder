import React, { useCallback, useEffect, useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  Modal,
  Alert,
  RefreshControl,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useRouter } from 'expo-router';
import { useMedications } from '@/hooks/useMedications';
import { fetchDrugList } from '@/services/claude';
import type { Medication, DoseSchedule, FoodGuidance } from '@/types';
import { Colors, Spacing, BorderRadius, Typography } from '@/constants/theme';
import ChatbotFAB from '@/components/ChatbotFAB';

export default function MedicationsScreen() {
  const router = useRouter();
  const { medications, loading, addMedication, removeMedication, reload } = useMedications();
  const [search, setSearch] = useState('');
  const [showAddModal, setShowAddModal] = useState(false);

  // Whenever the tab regains focus, re-pull the medications from storage so
  // fresh data (pill counts, newly added meds, edits) shows up immediately
  // without needing pull-to-refresh.
  useFocusEffect(
    useCallback(() => {
      reload();
    }, [reload])
  );

  const filtered = medications.filter(
    (m) =>
      m.name.toLowerCase().includes(search.toLowerCase()) ||
      m.purpose.toLowerCase().includes(search.toLowerCase())
  );

  async function handleDelete(med: Medication) {
    Alert.alert(
      `Remove ${med.name}?`,
      'This will delete all dose logs and reminders for this medication.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => removeMedication(med.id),
        },
      ]
    );
  }

  return (
    <SafeAreaView style={styles.safeArea} edges={['top']}>
      <View style={styles.header}>
        <Text style={styles.title}>Medications</Text>
        <TouchableOpacity
          onPress={() => setShowAddModal(true)}
          style={styles.addBtn}
          activeOpacity={0.7}
          hitSlop={8}
        >
          <Ionicons name="add" size={26} color={Colors.ink} />
        </TouchableOpacity>
      </View>

      <View style={styles.searchRow}>
        <Ionicons name="search" size={16} color={Colors.inkMuted} style={styles.searchIcon} />
        <TextInput
          style={styles.searchInput}
          value={search}
          onChangeText={setSearch}
          placeholder="Search"
          placeholderTextColor={Colors.inkLight}
          clearButtonMode="while-editing"
        />
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={reload} tintColor={Colors.inkMuted} />}
      >
        {filtered.length === 0 && !loading ? (
          <View style={styles.empty}>
            <Ionicons name="medkit-outline" size={44} color={Colors.inkLight} />
            <Text style={styles.emptyTitle}>No medications yet</Text>
            <Text style={styles.emptyText}>Tap + to add your first medication</Text>
          </View>
        ) : (
          filtered.map((med) => (
            <MedicationCard
              key={med.id}
              med={med}
              onPress={() => router.push(`/(tabs)/medications/${med.id}`)}
              onDelete={() => handleDelete(med)}
            />
          ))
        )}
        <View style={styles.bottomPad} />
      </ScrollView>

      <ChatbotFAB />

      <AddMedicationModal
        visible={showAddModal}
        onClose={() => setShowAddModal(false)}
        onAdd={addMedication}
      />
    </SafeAreaView>
  );
}

function initials(name: string): string {
  return name
    .split(' ')
    .map((s) => s[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();
}

function MedicationCard({
  med,
  onPress,
  onDelete,
}: {
  med: Medication;
  onPress: () => void;
  onDelete: () => void;
}) {
  const refillLow = med.refillInfo.currentCount <= 7;
  return (
    <TouchableOpacity onPress={onPress} activeOpacity={0.6}>
      <View style={styles.medRow}>
        <View style={[styles.medAvatar, { backgroundColor: med.color }]}>
          <Text style={styles.medAvatarText}>{initials(med.name)}</Text>
        </View>
        <View style={styles.medRowContent}>
          <Text style={styles.medName} numberOfLines={1}>
            {med.name}
          </Text>
          <Text style={styles.medSubtitle} numberOfLines={1}>
            {med.dose}
            {med.purpose ? ` · ${med.purpose}` : ''}
          </Text>
          {(med.schedule[0] || refillLow) && (
            <View style={styles.medBadges}>
              {med.schedule[0] && (
                <Text style={styles.medBadgeMuted}>
                  {med.schedule[0].time}
                  {med.schedule.length > 1 ? ` · ${med.schedule.length}×` : ''}
                </Text>
              )}
              {refillLow && (
                <Text style={styles.medBadgeWarn}>· {med.refillInfo.currentCount} left</Text>
              )}
            </View>
          )}
        </View>
        <TouchableOpacity onPress={onDelete} hitSlop={10} style={styles.medMore}>
          <Ionicons name="trash-outline" size={20} color={Colors.inkMuted} />
        </TouchableOpacity>
      </View>
    </TouchableOpacity>
  );
}

type Frequency =
  | 'once-daily'
  | 'twice-daily'
  | 'three-times-daily'
  | 'four-times-daily'
  | 'weekly'
  | 'as-needed';

const FREQUENCY_OPTIONS: { value: Frequency; label: string; defaultTimes: string[] }[] = [
  { value: 'once-daily', label: 'Once daily', defaultTimes: ['08:00'] },
  { value: 'twice-daily', label: 'Twice daily', defaultTimes: ['08:00', '20:00'] },
  { value: 'three-times-daily', label: 'Three times daily', defaultTimes: ['08:00', '14:00', '20:00'] },
  { value: 'four-times-daily', label: 'Four times daily', defaultTimes: ['08:00', '12:00', '16:00', '20:00'] },
  { value: 'weekly', label: 'Once weekly', defaultTimes: ['09:00'] },
  { value: 'as-needed', label: 'As needed', defaultTimes: [] },
];

const MEAL_OPTIONS: { value: DoseSchedule['mealRelation']; label: string; icon: string }[] = [
  { value: 'any', label: 'Any time', icon: '⏰' },
  { value: 'with-meal', label: 'With a meal', icon: '🍽' },
  { value: 'empty-stomach', label: 'Empty stomach', icon: '🚫🍽' },
];

function timeOfDayFromHHMM(hhmm: string): DoseSchedule['timeOfDay'] {
  const hour = parseInt(hhmm.split(':')[0], 10);
  if (isNaN(hour)) return 'morning';
  if (hour < 12) return 'morning';
  if (hour < 17) return 'afternoon';
  if (hour < 21) return 'evening';
  return 'night';
}

function AddMedicationModal({
  visible,
  onClose,
  onAdd,
}: {
  visible: boolean;
  onClose: () => void;
  onAdd: (data: Omit<Medication, 'id' | 'createdAt' | 'updatedAt' | 'color'>) => Promise<Medication>;
}) {
  const [name, setName] = useState('');
  const [dose, setDose] = useState('');
  const [purpose, setPurpose] = useState('');
  const [instructions, setInstructions] = useState('');
  const [prescriber, setPrescriber] = useState('');
  const [frequency, setFrequency] = useState<Frequency>('once-daily');
  const [times, setTimes] = useState<string[]>(['08:00']);
  const [mealRelation, setMealRelation] = useState<DoseSchedule['mealRelation']>('any');
  const [refillCount, setRefillCount] = useState('30');
  const [pillsPerDose, setPillsPerDose] = useState('1');
  const [saving, setSaving] = useState(false);
  const [drugList, setDrugList] = useState<string[]>([]);
  const [drugListLoaded, setDrugListLoaded] = useState(false);

  // Load the drug corpus every time the modal opens. `fetchDrugList`
  // falls back to `STARTER_DRUGS` when the backend is unreachable, so
  // `drugList` is guaranteed non-empty once this resolves — which
  // means the dropdown has real options to show.
  useEffect(() => {
    if (!visible) return;
    let cancelled = false;
    setDrugListLoaded(false);
    fetchDrugList()
      .then((list) => {
        if (cancelled) return;
        setDrugList(list);
        setDrugListLoaded(true);
      })
      .catch(() => {
        if (cancelled) return;
        setDrugList([]);
        setDrugListLoaded(true);
      });
    return () => { cancelled = true; };
  }, [visible]);

  // Compute suggestions regardless of focus so the chevron can toggle the
  // dropdown open/closed without blur fighting us. The `dropdownOpen` flag
  // is what controls visibility.
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const suggestions = React.useMemo(() => {
    const q = name.trim().toLowerCase();
    if (!q) return drugList;
    const starts = drugList.filter((d) => d.startsWith(q));
    const contains = drugList.filter((d) => !d.startsWith(q) && d.includes(q));
    const matches = [...starts, ...contains];
    // If the only match equals what the user already typed, there's nothing
    // new to offer — collapse the dropdown so it doesn't get in the way.
    if (matches.length === 1 && matches[0] === q) return [];
    return matches;
  }, [name, drugList]);

  function reset() {
    setName(''); setDose(''); setPurpose(''); setInstructions('');
    setPrescriber(''); setFrequency('once-daily'); setTimes(['08:00']);
    setMealRelation('any'); setRefillCount('30'); setPillsPerDose('1');
    setDropdownOpen(false);
  }

  function handleFrequencyChange(next: Frequency) {
    setFrequency(next);
    const opt = FREQUENCY_OPTIONS.find((o) => o.value === next);
    if (opt) setTimes(opt.defaultTimes);
  }

  function updateTime(idx: number, value: string) {
    setTimes((prev) => prev.map((t, i) => (i === idx ? value : t)));
  }

  async function handleSave() {
    if (!name.trim() || !dose.trim()) {
      Alert.alert('Required fields', 'Please enter at least a medication name and dose.');
      return;
    }
    // Validate time format — very light check. Accepts "H:MM", "HH:MM".
    const timeRegex = /^([01]?\d|2[0-3]):[0-5]\d$/;
    for (const t of times) {
      if (!timeRegex.test(t.trim())) {
        Alert.alert('Invalid time', `"${t}" isn't a valid time. Use 24-hour HH:MM format (e.g. 08:00, 20:30).`);
        return;
      }
    }

    setSaving(true);
    const schedule: DoseSchedule[] = times.map((t, i) => ({
      id: `sched-${Date.now()}-${i}`,
      time: t.trim(),
      mealRelation,
      timeOfDay: timeOfDayFromHHMM(t.trim()),
    }));

    // Food/drink guidance is auto-populated from the FDA label after save
    // (see useMedications.addMedication). Start with an empty/neutral default.
    const foodGuidance: FoodGuidance = {
      takeWithFood: false,
      avoidAlcohol: false,
      avoidGrapefruit: false,
      avoidDairy: false,
      customRestrictions: [],
    };

    const combinedInstructions = prescriber.trim()
      ? `${instructions.trim()}${instructions.trim() ? '\n' : ''}Prescribed by: ${prescriber.trim()}`
      : instructions.trim();

    const parsedPillsPerDose = Math.max(1, parseInt(pillsPerDose, 10) || 1);

    await onAdd({
      name: name.trim(),
      dose: dose.trim(),
      purpose: purpose.trim(),
      instructions: combinedInstructions,
      sideEffects: [],
      contraindications: [],
      foodGuidance,
      schedule,
      refillInfo: {
        currentCount: parseInt(refillCount, 10) || 30,
        totalCount: parseInt(refillCount, 10) || 30,
      },
      pillsPerDose: parsedPillsPerDose,
    });
    setSaving(false);
    reset();
    onClose();
  }

  const freqOption = FREQUENCY_OPTIONS.find((o) => o.value === frequency);
  const showTimes = freqOption && freqOption.defaultTimes.length > 0;

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet">
      <SafeAreaView style={styles.modalSafeArea} edges={['top', 'bottom']}>
        <View style={styles.modalHeader}>
          <TouchableOpacity onPress={onClose} hitSlop={12}>
            <Text style={styles.modalHeaderBtn}>Cancel</Text>
          </TouchableOpacity>
          <Text style={styles.modalTitle}>New medication</Text>
          <TouchableOpacity onPress={handleSave} disabled={saving} hitSlop={12}>
            <Text style={[styles.modalHeaderBtnPrimary, saving && { opacity: 0.4 }]}>
              {saving ? 'Saving…' : 'Save'}
            </Text>
          </TouchableOpacity>
        </View>
        <ScrollView
          style={styles.modalScroll}
          contentContainerStyle={styles.modalContent}
          keyboardShouldPersistTaps="handled"
        >
          {/* ── Basics ───────────────────────────────────────────────────── */}
          <Text style={styles.modalSectionLabel}>The basics</Text>
          <View style={styles.fieldGroup}>
            <Text style={styles.fieldLabel}>Medication Name *</Text>
            {/* Combo-box style: text input + chevron. Tap the chevron (or
                focus the input) to open the list of meds in our FDA label
                DB; typing filters the options. */}
            <View style={[styles.dropdownWrap, dropdownOpen && styles.dropdownWrapOpen]}>
              <TextInput
                style={styles.dropdownInput}
                value={name}
                onChangeText={(v) => {
                  setName(v);
                  if (!dropdownOpen) setDropdownOpen(true);
                }}
                onFocus={() => setDropdownOpen(true)}
                placeholder="Select or type a medication"
                placeholderTextColor={Colors.textLight}
                autoCapitalize="none"
                autoCorrect={false}
              />
              <TouchableOpacity
                onPress={() => setDropdownOpen((v) => !v)}
                style={styles.dropdownCaret}
                hitSlop={10}
                activeOpacity={0.5}
              >
                <Ionicons
                  name={dropdownOpen ? 'chevron-up' : 'chevron-down'}
                  size={20}
                  color={Colors.inkMuted}
                />
              </TouchableOpacity>
            </View>

            {dropdownOpen && (
              <View style={styles.suggestList}>
                <Text style={styles.suggestHint}>
                  {suggestions.length > 0
                    ? 'Tap to select, or keep typing to filter'
                    : !drugListLoaded
                      ? 'Loading medications…'
                      : drugList.length === 0
                        ? 'No saved medications found — type a custom name below'
                        : 'No matches — you can type a custom name'}
                </Text>
                <ScrollView
                  style={styles.suggestScroll}
                  nestedScrollEnabled
                  keyboardShouldPersistTaps="handled"
                >
                  {suggestions.map((d) => {
                    const selected = d === name.trim().toLowerCase();
                    return (
                      <TouchableOpacity
                        key={d}
                        onPress={() => {
                          setName(d);
                          setDropdownOpen(false);
                        }}
                        style={[styles.suggestItem, selected && styles.suggestItemActive]}
                        activeOpacity={0.6}
                      >
                        <Ionicons name="medkit-outline" size={16} color={Colors.primary} />
                        <Text style={styles.suggestItemText}>{d}</Text>
                        {selected && (
                          <Ionicons
                            name="checkmark"
                            size={18}
                            color={Colors.primary}
                            style={{ marginLeft: 'auto' }}
                          />
                        )}
                      </TouchableOpacity>
                    );
                  })}
                </ScrollView>
              </View>
            )}
          </View>
          <ModalField label="Dose *" value={dose} onChange={setDose} placeholder="e.g. 500 mg" />
          <ModalField label="Purpose / Condition" value={purpose} onChange={setPurpose} placeholder="e.g. Type 2 diabetes" />
          <ModalField label="Prescribing doctor" value={prescriber} onChange={setPrescriber} placeholder="e.g. Dr. Lin" />

          {/* ── How often ────────────────────────────────────────────────── */}
          <Text style={styles.modalSectionLabel}>How often do you take it?</Text>
          <View style={styles.pickerRow}>
            {FREQUENCY_OPTIONS.map((opt) => {
              const active = opt.value === frequency;
              return (
                <TouchableOpacity
                  key={opt.value}
                  onPress={() => handleFrequencyChange(opt.value)}
                  style={[styles.pickerChip, active && styles.pickerChipActive]}
                  activeOpacity={0.7}
                >
                  <Text style={[styles.pickerChipText, active && styles.pickerChipTextActive]}>
                    {opt.label}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>

          {/* ── Reminder times (hidden for as-needed) ─────────────────────── */}
          {showTimes && (
            <>
              <Text style={styles.modalSectionLabel}>
                Reminder time{times.length > 1 ? 's' : ''} (24-hour)
              </Text>
              <View style={styles.timesGroup}>
                {times.map((t, i) => (
                  <View key={i} style={styles.timeRow}>
                    <Ionicons name="time-outline" size={18} color={Colors.primary} />
                    <TextInput
                      style={styles.timeInput}
                      value={t}
                      onChangeText={(v) => updateTime(i, v)}
                      placeholder="08:00"
                      placeholderTextColor={Colors.textLight}
                      keyboardType="numbers-and-punctuation"
                      maxLength={5}
                    />
                    <Text style={styles.timeLabel}>Dose {i + 1}</Text>
                  </View>
                ))}
              </View>
            </>
          )}

          {/* ── How to take it ───────────────────────────────────────────── */}
          <Text style={styles.modalSectionLabel}>How should you take it?</Text>
          <View style={styles.pickerRow}>
            {MEAL_OPTIONS.map((opt) => {
              const active = opt.value === mealRelation;
              return (
                <TouchableOpacity
                  key={opt.value}
                  onPress={() => setMealRelation(opt.value)}
                  style={[styles.pickerChip, active && styles.pickerChipActive]}
                  activeOpacity={0.7}
                >
                  <Text style={[styles.pickerChipText, active && styles.pickerChipTextActive]}>
                    {opt.icon} {opt.label}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>

          {/* ── Extra instructions ───────────────────────────────────────── */}
          <ModalField
            label="Special instructions (optional)"
            value={instructions}
            onChange={setInstructions}
            placeholder="e.g. Take with a full glass of water"
            multiline
          />

          {/* ── Refill ───────────────────────────────────────────────────── */}
          <Text style={styles.modalSectionLabel}>Supply</Text>
          <ModalField
            label="Pills remaining"
            value={refillCount}
            onChange={setRefillCount}
            placeholder="30"
            keyboardType="number-pad"
          />
          <ModalField
            label="Pills per dose"
            value={pillsPerDose}
            onChange={setPillsPerDose}
            placeholder="1"
            keyboardType="number-pad"
          />
          <Text style={styles.fieldHint}>
            How many tablets make up ONE dose. e.g. if your prescription is 500 mg
            and each pill is 250 mg, that's 2 pills per dose.
          </Text>

          <View style={styles.autoFoodNotice}>
            <Ionicons name="sparkles-outline" size={16} color={Colors.primary} />
            <Text style={styles.autoFoodNoticeText}>
              Food & drink guidance (avoid grapefruit, alcohol, etc.) will be filled in
              automatically from the FDA label after you save.
            </Text>
          </View>
        </ScrollView>
      </SafeAreaView>
    </Modal>
  );
}

function ModalField({
  label,
  value,
  onChange,
  placeholder,
  multiline,
  keyboardType,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  multiline?: boolean;
  keyboardType?: 'default' | 'number-pad';
}) {
  return (
    <View style={styles.fieldGroup}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <TextInput
        style={[styles.fieldInput, multiline && styles.fieldInputMulti]}
        value={value}
        onChangeText={onChange}
        placeholder={placeholder}
        placeholderTextColor={Colors.textLight}
        multiline={multiline}
        keyboardType={keyboardType ?? 'default'}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: Colors.background },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Colors.border,
  },
  title: { ...Typography.h1, color: Colors.ink },
  addBtn: {
    width: 32,
    height: 32,
    alignItems: 'center',
    justifyContent: 'center',
  },
  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.divider,
    borderRadius: BorderRadius.md,
    marginHorizontal: Spacing.md,
    marginTop: Spacing.sm,
    marginBottom: Spacing.sm,
    paddingHorizontal: Spacing.sm,
  },
  searchIcon: { marginRight: 6 },
  searchInput: {
    flex: 1,
    height: 36,
    ...Typography.body,
    color: Colors.ink,
  },
  scroll: { flex: 1 },
  content: { paddingTop: Spacing.xs },
  empty: { alignItems: 'center', gap: Spacing.sm, marginTop: 80, paddingHorizontal: Spacing.lg },
  emptyTitle: { ...Typography.h3, color: Colors.inkMuted },
  emptyText: { ...Typography.body, color: Colors.inkLight, textAlign: 'center' },
  bottomPad: { height: 100 },

  medRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    paddingHorizontal: Spacing.md,
    paddingVertical: 10,
  },
  medAvatar: {
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: 'center',
    justifyContent: 'center',
  },
  medAvatarText: {
    fontSize: 18,
    fontWeight: '700',
    color: Colors.textOnPrimary,
    letterSpacing: -0.3,
  },
  medRowContent: { flex: 1, gap: 2 },
  medName: { ...Typography.h4, color: Colors.ink },
  medSubtitle: { ...Typography.bodySmall, color: Colors.inkMuted },
  medBadges: { flexDirection: 'row', gap: 4, marginTop: 2 },
  medBadgeMuted: { ...Typography.caption, color: Colors.inkMuted, fontWeight: '500' },
  medBadgeWarn: { ...Typography.caption, color: Colors.warning, fontWeight: '600' },
  medMore: { padding: 6 },
  modalSafeArea: { flex: 1, backgroundColor: Colors.background },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Colors.border,
  },
  modalTitle: { ...Typography.h3, color: Colors.ink },
  modalHeaderBtn: { ...Typography.body, color: Colors.ink, fontWeight: '500' },
  modalHeaderBtnPrimary: { ...Typography.body, color: Colors.primary, fontWeight: '700' },
  modalScroll: { flex: 1 },
  modalContent: { padding: Spacing.lg, gap: Spacing.md, paddingBottom: 40 },
  modalSectionLabel: { ...Typography.label, color: Colors.inkMuted, marginTop: Spacing.md },
  fieldGroup: { gap: 6 },
  fieldLabel: { ...Typography.caption, color: Colors.inkMuted, fontWeight: '700', letterSpacing: 0.2, textTransform: 'none' as const },
  fieldInput: {
    backgroundColor: Colors.surface,
    borderRadius: BorderRadius.md,
    padding: Spacing.md,
    ...Typography.body,
    color: Colors.ink,
    fontWeight: '500',
    borderWidth: 1,
    borderColor: Colors.border,
  },
  fieldInputMulti: { minHeight: 80, textAlignVertical: 'top' },
  fieldHint: {
    ...Typography.caption,
    color: Colors.inkMuted,
    lineHeight: 16,
    marginTop: -6,
  },
  dropdownWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.surface,
    borderRadius: BorderRadius.md,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  dropdownWrapOpen: {
    borderColor: Colors.primary,
    borderBottomLeftRadius: 0,
    borderBottomRightRadius: 0,
  },
  dropdownInput: {
    flex: 1,
    padding: Spacing.md,
    ...Typography.body,
    color: Colors.ink,
    fontWeight: '500',
  },
  dropdownCaret: {
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.md,
  },
  suggestList: {
    marginTop: -1,
    backgroundColor: Colors.surface,
    borderBottomLeftRadius: BorderRadius.md,
    borderBottomRightRadius: BorderRadius.md,
    borderWidth: 1,
    borderTopWidth: 0,
    borderColor: Colors.primary,
    paddingVertical: 4,
    maxHeight: 260,
  },
  suggestScroll: { maxHeight: 220 },
  suggestHint: {
    ...Typography.caption,
    color: Colors.inkMuted,
    paddingHorizontal: Spacing.md,
    paddingVertical: 6,
    fontStyle: 'italic',
  },
  suggestItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    paddingHorizontal: Spacing.md,
    paddingVertical: 10,
  },
  suggestItemActive: {
    backgroundColor: Colors.primary + '14',
  },
  suggestItemText: {
    ...Typography.body,
    color: Colors.ink,
    textTransform: 'capitalize',
    fontWeight: '500',
  },
  pickerRow: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.xs },
  pickerChip: {
    paddingHorizontal: Spacing.md,
    paddingVertical: 10,
    borderRadius: BorderRadius.pill,
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  pickerChipActive: {
    backgroundColor: Colors.ink,
    borderColor: Colors.ink,
  },
  pickerChipText: {
    ...Typography.bodySmall,
    color: Colors.ink,
    fontWeight: '700',
  },
  pickerChipTextActive: {
    color: Colors.primary,
  },
  timesGroup: { gap: Spacing.xs },
  timeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    backgroundColor: Colors.surface,
    borderRadius: BorderRadius.md,
    paddingHorizontal: Spacing.md,
    paddingVertical: 10,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  timeInput: {
    ...Typography.body,
    color: Colors.ink,
    fontWeight: '700',
    minWidth: 72,
    paddingVertical: 2,
  },
  timeLabel: {
    ...Typography.bodySmall,
    color: Colors.inkMuted,
    marginLeft: 'auto',
  },
  autoFoodNotice: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Spacing.sm,
    backgroundColor: Colors.primaryLight,
    borderRadius: BorderRadius.md,
    padding: Spacing.md,
    marginTop: Spacing.sm,
  },
  autoFoodNoticeText: {
    ...Typography.bodySmall,
    color: Colors.ink,
    flex: 1,
    lineHeight: 18,
    fontWeight: '500',
  },
});
