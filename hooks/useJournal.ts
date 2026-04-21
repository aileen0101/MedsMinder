import { useState, useEffect, useCallback } from 'react';
import * as storage from '@/services/storage';
import type { JournalEntry } from '@/types';

export function useJournal() {
  const [entries, setEntries] = useState<JournalEntry[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const data = await storage.getJournalEntries();
    setEntries(data);
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function addEntry(entry: Omit<JournalEntry, 'id' | 'createdAt'>) {
    const newEntry: JournalEntry = {
      ...entry,
      id: `journal-${Date.now()}`,
      createdAt: new Date().toISOString(),
    };
    await storage.saveJournalEntry(newEntry);
    await load();
    return newEntry;
  }

  async function removeEntry(id: string) {
    await storage.deleteJournalEntry(id);
    await load();
  }

  return { entries, loading, addEntry, removeEntry, reload: load };
}
