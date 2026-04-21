// MedsMinder — Notification Service
// Schedules local push notifications for medication reminders.
// ⚠️  All notifications are local-only — no data is sent to external servers.

import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import type { Medication, DoseSchedule } from '@/types';

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: true,
  }),
});

export async function requestNotificationPermissions(): Promise<boolean> {
  const { status } = await Notifications.requestPermissionsAsync();
  if (status !== 'granted') return false;

  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('medication-reminders', {
      name: 'Medication reminders',
      importance: Notifications.AndroidImportance.HIGH,
      vibrationPattern: [0, 250, 250, 250],
    });
  }
  return true;
}

export async function scheduleMedicationReminders(med: Medication): Promise<void> {
  await cancelMedicationReminders(med.id);

  const { status } = await Notifications.getPermissionsAsync();
  if (status !== 'granted') {
    // Permissions not granted — silently skip instead of throwing so the
    // medication still saves. The UI should prompt for permission separately.
    return;
  }

  for (const schedule of med.schedule) {
    const [hour, minute] = schedule.time.split(':').map(Number);
    if (Number.isNaN(hour) || Number.isNaN(minute)) continue;
    const mealNote = getMealNote(schedule.mealRelation);

    try {
      await Notifications.scheduleNotificationAsync({
        identifier: `med-${med.id}-${schedule.id}`,
        content: {
          title: `💊 Time for ${med.name}`,
          body: `${med.dose}${mealNote ? ` — ${mealNote}` : ''}`,
          data: { medicationId: med.id, scheduleId: schedule.id },
          sound: true,
        },
        trigger: {
          type: Notifications.SchedulableTriggerInputTypes.DAILY,
          hour,
          minute,
        },
      });
    } catch (err) {
      // Scheduling failures shouldn't block saving the medication itself.
      console.warn(`Failed to schedule reminder for ${med.name}:`, err);
    }
  }
}

export async function cancelMedicationReminders(medicationId: string): Promise<void> {
  const scheduled = await Notifications.getAllScheduledNotificationsAsync();
  const toCancel = scheduled
    .filter((n) => n.identifier.startsWith(`med-${medicationId}-`))
    .map((n) => n.identifier);

  for (const id of toCancel) {
    await Notifications.cancelScheduledNotificationAsync(id);
  }
}

export async function cancelAllReminders(): Promise<void> {
  await Notifications.cancelAllScheduledNotificationsAsync();
}

function getMealNote(mealRelation: DoseSchedule['mealRelation']): string {
  switch (mealRelation) {
    case 'with-meal':
      return 'Take with food';
    case 'empty-stomach':
      return 'Take on empty stomach';
    default:
      return '';
  }
}
