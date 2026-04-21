// MedsMinder — AsyncStorage Service
// ⚠️  PRIVACY: All data is stored locally on device only. Nothing is sent to external servers.

import AsyncStorage from '@react-native-async-storage/async-storage';
import type {
  UserProfile,
  Medication,
  DoseLog,
  JournalEntry,
  EmergencyProfile,
  ChatMessage,
} from '@/types';

const KEYS = {
  USER_PROFILE: '@medsminder:user_profile',
  MEDICATIONS: '@medsminder:medications',
  DOSE_LOGS: '@medsminder:dose_logs',
  JOURNAL: '@medsminder:journal',
  EMERGENCY: '@medsminder:emergency',
  CHAT_HISTORY: '@medsminder:chat_history',
} as const;

// --- Generic helpers ---

async function getItem<T>(key: string): Promise<T | null> {
  const raw = await AsyncStorage.getItem(key);
  if (!raw) return null;
  return JSON.parse(raw) as T;
}

async function setItem<T>(key: string, value: T): Promise<void> {
  await AsyncStorage.setItem(key, JSON.stringify(value));
}

// --- User Profile ---

export async function getUserProfile(): Promise<UserProfile | null> {
  return getItem<UserProfile>(KEYS.USER_PROFILE);
}

export async function saveUserProfile(profile: UserProfile): Promise<void> {
  return setItem(KEYS.USER_PROFILE, profile);
}

// --- Medications ---

export async function getMedications(): Promise<Medication[]> {
  return (await getItem<Medication[]>(KEYS.MEDICATIONS)) ?? [];
}

export async function saveMedication(med: Medication): Promise<void> {
  const meds = await getMedications();
  const idx = meds.findIndex((m) => m.id === med.id);
  if (idx >= 0) {
    meds[idx] = med;
  } else {
    meds.push(med);
  }
  return setItem(KEYS.MEDICATIONS, meds);
}

export async function deleteMedication(id: string): Promise<void> {
  const meds = await getMedications();
  return setItem(
    KEYS.MEDICATIONS,
    meds.filter((m) => m.id !== id)
  );
}

// --- Dose Logs ---

export async function getDoseLogs(medicationId?: string): Promise<DoseLog[]> {
  const all = (await getItem<DoseLog[]>(KEYS.DOSE_LOGS)) ?? [];
  if (medicationId) return all.filter((l) => l.medicationId === medicationId);
  return all;
}

export async function logDose(log: DoseLog): Promise<void> {
  const logs = await getDoseLogs();
  const idx = logs.findIndex((l) => l.id === log.id);
  if (idx >= 0) {
    logs[idx] = log;
  } else {
    logs.push(log);
  }
  return setItem(KEYS.DOSE_LOGS, logs);
}

export async function getTodayDoseLogs(): Promise<DoseLog[]> {
  const logs = await getDoseLogs();
  // Compare against the user's LOCAL calendar day. Comparing against a
  // UTC date string silently drops evening doses for users west of UTC
  // (a 20:00 PDT log has a next-day UTC timestamp), which caused the
  // Home agenda to agree with "taken" while the Detail page's today
  // counter missed the slot entirely.
  const now = new Date();
  return logs.filter((l) => {
    const d = new Date(l.scheduledTime);
    if (Number.isNaN(d.getTime())) return false;
    return (
      d.getFullYear() === now.getFullYear() &&
      d.getMonth() === now.getMonth() &&
      d.getDate() === now.getDate()
    );
  });
}

export async function deleteDoseLog(logId: string): Promise<void> {
  const logs = await getDoseLogs();
  return setItem(
    KEYS.DOSE_LOGS,
    logs.filter((l) => l.id !== logId)
  );
}

// --- Journal ---

export async function getJournalEntries(): Promise<JournalEntry[]> {
  const entries = (await getItem<JournalEntry[]>(KEYS.JOURNAL)) ?? [];
  return entries.sort((a, b) => b.date.localeCompare(a.date));
}

export async function saveJournalEntry(entry: JournalEntry): Promise<void> {
  const entries = await getJournalEntries();
  const idx = entries.findIndex((e) => e.id === entry.id);
  if (idx >= 0) {
    entries[idx] = entry;
  } else {
    entries.push(entry);
  }
  return setItem(KEYS.JOURNAL, entries);
}

export async function deleteJournalEntry(id: string): Promise<void> {
  const entries = await getJournalEntries();
  return setItem(
    KEYS.JOURNAL,
    entries.filter((e) => e.id !== id)
  );
}

// --- Emergency Profile ---

export async function getEmergencyProfile(): Promise<EmergencyProfile | null> {
  return getItem<EmergencyProfile>(KEYS.EMERGENCY);
}

export async function saveEmergencyProfile(profile: EmergencyProfile): Promise<void> {
  return setItem(KEYS.EMERGENCY, profile);
}

// --- Chat History ---

export async function getChatHistory(): Promise<ChatMessage[]> {
  return (await getItem<ChatMessage[]>(KEYS.CHAT_HISTORY)) ?? [];
}

export async function saveChatMessage(msg: ChatMessage): Promise<void> {
  const history = await getChatHistory();
  history.push(msg);
  // Keep only last 100 messages to avoid excessive storage
  const trimmed = history.slice(-100);
  return setItem(KEYS.CHAT_HISTORY, trimmed);
}

export async function clearChatHistory(): Promise<void> {
  return AsyncStorage.removeItem(KEYS.CHAT_HISTORY);
}

// --- Utility ---

export async function clearAllData(): Promise<void> {
  await AsyncStorage.multiRemove(Object.values(KEYS));
}
