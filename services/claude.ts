// MedsMinder — RAG Chatbot Service
//
// ⚠️  PRIVACY NOTICE:
// Questions sent to this service are forwarded to:
//   Google Gemini API (for embedding the question and generating the answer)
// Retrieval is performed against public FDA label data only (no user PHI in the DB).
// The backend logs a hash of each question for auditability — never the raw text.
// Users must consent before using AI features (enforced in onboarding).
//
// Backend must be running locally:
//   cd backend && python main.py
//
// On a physical device, replace BACKEND_URL with your Mac's local IP:
//   e.g. http://192.168.1.42:8000

import type { ChatMessage, ChatSource, FoodGuidance, MedAIInfo } from '@/types';

// Use localhost for simulator, your machine's LAN IP for physical device
const BACKEND_URL =
  process.env.EXPO_PUBLIC_BACKEND_URL ?? 'http://localhost:8000';

// ── Types matching FastAPI response models ────────────────────────────────────

interface SourceItem {
  drug: string;
  section: string;
  url: string;
}

interface ChatAPIResponse {
  answer: string;
  sources: SourceItem[];
  is_emergency: boolean;
  is_out_of_scope: boolean;
  retrieved_chunks: number;
}

interface MedInfoAPIResponse {
  summary: string;
  sources: SourceItem[];
}

// ── Chat ─────────────────────────────────────────────────────────────────────

export async function sendChatMessage(
  userMessage: string,
  _history: ChatMessage[], // history is managed server-side via context window — kept for API compat
  userMeds: string[] = [],
  userId: string = 'anonymous'
): Promise<{ content: string; sources: ChatSource[] }> {
  const response = await fetch(`${BACKEND_URL}/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      question: userMessage,
      user_meds: userMeds,
      user_id: userId,
    }),
  });

  if (response.status === 429) {
    throw new Error('Daily question limit reached. Try again tomorrow.');
  }
  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err.detail ?? `Server error ${response.status}`);
  }

  const data: ChatAPIResponse = await response.json();

  if (data.is_emergency) {
    return { content: data.answer, sources: [] };
  }

  // De-duplicate by URL so the user doesn't see the same link multiple times
  const seen = new Set<string>();
  const sources: ChatSource[] = [];
  for (const s of data.sources) {
    if (!s.url || seen.has(s.url)) continue;
    seen.add(s.url);
    sources.push({ drug: s.drug, section: s.section, url: s.url });
  }

  return { content: data.answer, sources };
}

// ── Medication AI Info ────────────────────────────────────────────────────────

export async function generateMedicationInfo(
  medicationName: string,
  dose: string
): Promise<MedAIInfo> {
  const response = await fetch(`${BACKEND_URL}/med-info`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ drug_name: medicationName, dose }),
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err.detail ?? `Server error ${response.status}`);
  }

  const data: MedInfoAPIResponse = await response.json();

  // De-dup by URL so a drug with multiple matching sections collapses to one link
  const seen = new Set<string>();
  const sources: ChatSource[] = [];
  for (const s of data.sources) {
    if (!s.url || seen.has(s.url)) continue;
    seen.add(s.url);
    sources.push({ drug: s.drug, section: s.section, url: s.url });
  }

  return {
    summary: data.summary,
    purpose: '',
    sideEffects: [],
    interactions: [],
    sources,
    generatedAt: new Date().toISOString(),
  };
}

// ── Food guidance (auto-populated when a medication is added) ────────────────

interface FoodGuidanceAPIResponse {
  takeWithFood: boolean;
  avoidAlcohol: boolean;
  avoidGrapefruit: boolean;
  avoidDairy: boolean;
  notes: string;
  has_data?: boolean;
}

/**
 * Ask the backend to extract structured food/drink guidance for a drug from
 * its FDA label.
 *
 * Returns:
 *   - null if the backend is unreachable (network error)
 *   - a guidance object with `hasData=false` if the drug isn't in our DB
 *   - a guidance object with `hasData=true` otherwise
 */
export async function fetchFoodGuidance(
  drugName: string
): Promise<(FoodGuidance & { notes: string; hasData: boolean }) | null> {
  try {
    const response = await fetch(`${BACKEND_URL}/food-guidance`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ drug_name: drugName }),
    });
    if (!response.ok) return null;
    const data: FoodGuidanceAPIResponse = await response.json();
    return {
      takeWithFood: !!data.takeWithFood,
      avoidAlcohol: !!data.avoidAlcohol,
      avoidGrapefruit: !!data.avoidGrapefruit,
      avoidDairy: !!data.avoidDairy,
      customRestrictions: [],
      notes: data.notes ?? '',
      hasData: !!data.has_data,
    };
  } catch {
    return null;
  }
}

// ── Medication details (side effects + contraindications, auto-populated) ───

interface MedicationDetailsAPIResponse {
  side_effects: string[];
  contraindications: string[];
  has_data?: boolean;
}

/**
 * Ask the backend to extract structured side effects and contraindications for
 * a drug from its FDA label.
 *
 * Returns:
 *   - null if the backend is unreachable (network error)
 *   - {hasData: false} if the drug isn't in our DB
 *   - {hasData: true, sideEffects, contraindications} on success (lists may
 *     still be empty if the label simply doesn't mention them)
 */
export async function fetchMedicationDetails(
  drugName: string
): Promise<
  | {
      sideEffects: string[];
      contraindications: string[];
      hasData: boolean;
    }
  | null
> {
  try {
    const response = await fetch(`${BACKEND_URL}/medication-details`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ drug_name: drugName }),
    });
    if (!response.ok) return null;
    const data: MedicationDetailsAPIResponse = await response.json();
    return {
      sideEffects: Array.isArray(data.side_effects) ? data.side_effects : [],
      contraindications: Array.isArray(data.contraindications) ? data.contraindications : [],
      hasData: !!data.has_data,
    };
  } catch {
    return null;
  }
}

// ── Drug corpus (autocomplete) ───────────────────────────────────────────────

/**
 * Local fallback list — the 29 most-prescribed US drugs that we know the
 * backend has FDA label data for (mirrors backend/drug_list.py). This
 * keeps the Add Medication dropdown useful even when the backend is
 * down, so users can still pick a known-good name without typing from
 * memory. When the backend IS up we merge this with its `/drugs`
 * response (the backend can legitimately have more than this list once
 * a user ingests additional meds).
 */
export const STARTER_DRUGS: string[] = [
  'lisinopril', 'amlodipine', 'metoprolol', 'atorvastatin', 'simvastatin',
  'losartan', 'hydrochlorothiazide', 'furosemide', 'carvedilol', 'warfarin',
  'metformin', 'glipizide',
  'levothyroxine',
  'sertraline', 'escitalopram', 'bupropion', 'alprazolam', 'quetiapine',
  'tramadol', 'gabapentin', 'ibuprofen',
  'omeprazole', 'pantoprazole',
  'albuterol', 'fluticasone', 'montelukast',
  'amoxicillin', 'azithromycin',
  'prednisone',
];

let _drugListCache: string[] | null = null;

/**
 * Return the lowercase list of drugs available for autocomplete. Prefers
 * the backend's `/drugs` response (which reflects what's actually in
 * the vector DB) and falls back to `STARTER_DRUGS` when the backend is
 * unreachable. Cached in-memory for the session — the corpus is
 * static once ingestion is done.
 */
export async function fetchDrugList(): Promise<string[]> {
  if (_drugListCache) return _drugListCache;
  try {
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), 3000);
    const res = await fetch(`${BACKEND_URL}/drugs`, { signal: controller.signal });
    clearTimeout(t);
    if (!res.ok) throw new Error(`bad status ${res.status}`);
    const data: { drugs: string[] } = await res.json();
    const fromBackend = Array.isArray(data.drugs) ? data.drugs : [];
    // Union + dedupe + sort so the dropdown always shows at least the
    // starter drugs, even if the backend returns a shorter list.
    const merged = Array.from(new Set([...fromBackend, ...STARTER_DRUGS])).sort();
    _drugListCache = merged;
    return merged;
  } catch {
    // Backend unreachable — fall back to the starter list. Don't cache
    // this result so the next modal-open retries the fetch (in case
    // the user starts the backend mid-session).
    return [...STARTER_DRUGS].sort();
  }
}

// ── Health check ─────────────────────────────────────────────────────────────

export async function checkBackendHealth(): Promise<{
  ok: boolean;
  chunks: number;
  error?: string;
}> {
  try {
    const res = await fetch(`${BACKEND_URL}/health`, { method: 'GET' });
    if (!res.ok) return { ok: false, chunks: 0, error: `HTTP ${res.status}` };
    const data = await res.json();
    return { ok: data.status === 'ok', chunks: data.chroma_chunks ?? 0 };
  } catch (e) {
    return {
      ok: false,
      chunks: 0,
      error: 'Backend not running. Start it with: cd backend && python main.py',
    };
  }
}
