import { useState, useEffect, useCallback } from 'react';
import * as storage from '@/services/storage';
import { scheduleMedicationReminders, cancelMedicationReminders } from '@/services/notifications';
import { fetchFoodGuidance, fetchMedicationDetails } from '@/services/claude';
import type { Medication } from '@/types';
import { Colors } from '@/constants/theme';
import 'react-native-get-random-values';
import { v7 as uuid } from 'uuid';

export type EnrichStatus =
  | { ok: true; med: Medication; inDatabase: boolean }
  | { ok: false; reason: 'unreachable' | 'not-found' };

/**
 * Fetch food guidance + side effects + contraindications for a medication from
 * the FDA label (via backend RAG) and merge the results into the stored record.
 *
 * Return values:
 * - { ok: true, inDatabase: true }  — drug is in our DB, record updated
 * - { ok: true, inDatabase: false } — drug not in our DB (nothing to update)
 * - { ok: false, reason: 'unreachable' } — backend network error
 * - { ok: false, reason: 'not-found' } — medication ID doesn't exist locally
 */
export async function enrichMedicationFromLabel(medId: string): Promise<EnrichStatus> {
  const all = await storage.getMedications();
  const med = all.find((m) => m.id === medId);
  if (!med) return { ok: false, reason: 'not-found' };

  const [guidance, details] = await Promise.all([
    fetchFoodGuidance(med.name),
    fetchMedicationDetails(med.name),
  ]);

  if (!guidance && !details) {
    return { ok: false, reason: 'unreachable' };
  }

  const inDatabase = !!(guidance?.hasData || details?.hasData);

  const updated: Medication = {
    ...med,
    foodGuidance:
      guidance && guidance.hasData
        ? {
            takeWithFood: guidance.takeWithFood,
            avoidAlcohol: guidance.avoidAlcohol,
            avoidGrapefruit: guidance.avoidGrapefruit,
            avoidDairy: guidance.avoidDairy,
            customRestrictions: med.foodGuidance.customRestrictions ?? [],
          }
        : med.foodGuidance,
    sideEffects:
      details && details.hasData && details.sideEffects.length
        ? details.sideEffects
        : med.sideEffects,
    contraindications:
      details && details.hasData && details.contraindications.length
        ? details.contraindications
        : med.contraindications,
    updatedAt: new Date().toISOString(),
  };
  await storage.saveMedication(updated);
  return { ok: true, med: updated, inDatabase };
}

export function useMedications() {
  const [medications, setMedications] = useState<Medication[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const meds = await storage.getMedications();
    setMedications(meds);
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function addMedication(data: Omit<Medication, 'id' | 'createdAt' | 'updatedAt' | 'color'>) {
    const colorIndex = medications.length % Colors.medColors.length;
    const med: Medication = {
      ...data,
      id: uuid(),
      color: Colors.medColors[colorIndex],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    await storage.saveMedication(med);
    await scheduleMedicationReminders(med);
    await load();

    // Fire-and-forget: auto-populate food guidance + side effects +
    // contraindications from the FDA label in the background so the detail
    // page isn't empty. Failures are silent — the detail screen has a
    // "Refresh info" button as a fallback.
    enrichMedicationFromLabel(med.id)
      .then((status) => {
        if (status.ok) load();
      })
      .catch(() => {
        /* silent */
      });

    return med;
  }

  async function updateMedication(med: Medication) {
    const updated = { ...med, updatedAt: new Date().toISOString() };
    await storage.saveMedication(updated);
    await scheduleMedicationReminders(updated);
    await load();
  }

  async function removeMedication(id: string) {
    await storage.deleteMedication(id);
    await cancelMedicationReminders(id);
    await load();
  }

  return { medications, loading, addMedication, updateMedication, removeMedication, reload: load };
}
