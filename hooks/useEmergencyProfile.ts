import { useState, useEffect, useCallback } from 'react';
import * as storage from '@/services/storage';
import type { EmergencyProfile } from '@/types';

const DEFAULT_PROFILE: EmergencyProfile = {
  bloodType: '',
  allergies: [],
  conditions: [],
  contacts: [],
  additionalNotes: '',
};

export function useEmergencyProfile() {
  const [profile, setProfile] = useState<EmergencyProfile>(DEFAULT_PROFILE);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const data = await storage.getEmergencyProfile();
    setProfile(data ?? DEFAULT_PROFILE);
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function save(updated: EmergencyProfile) {
    await storage.saveEmergencyProfile(updated);
    setProfile(updated);
  }

  return { profile, loading, save, reload: load };
}
