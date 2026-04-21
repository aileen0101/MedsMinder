# MedsMinder

A personal medication management app for older adults and anyone juggling a complicated pill schedule. Built with React Native (Expo SDK 54) and a FastAPI + ChromaDB + Gemini RAG backend that grounds every AI answer in real FDA drug labels.

The UI takes visual cues from Instagram — clean type, hairline dividers, a white surface, and a minimal icon-only bottom tab bar — to keep the app feeling familiar and uncluttered.

## Features

- **Home** — Calendar strip + today's schedule in morning / afternoon / evening / as-needed buckets. Tap a slot to log it as Taken; the app locks the row, decrements your pill count, and surfaces Refill and Avoid-today callouts for the day.
- **Medications** — Add/remove meds with a full scheduling form (dose, strength, unit, times, instructions, max daily limit, refill info). Autocomplete pulls from the backend's ingested drug list so you don't have to retype. Detail view shows Today's progress, per-day cap, pills left, auto-generated food guidance, side effects and contraindications pulled from the FDA label, and a "More Information" AI summary with clickable source links (DailyMed).
- **Support** — Symptom journal, an Ask-AI popup chatbot backed by RAG, and a Nearby map that searches Google Places for doctors/pharmacies near your current location.
- **Emergency** — Blood type, allergies, conditions, emergency contacts, shareable with first responders via the native share sheet.
- **Dose safety engine** (`services/doseEngine.ts`) — centralized logic shared by Home and Detail so counts never drift:
  - Each dose is tied to a schedule slot (morning / noon / evening …) by `schedule.id`; slots are idempotent — tapping "Taken" twice on the same slot is a no-op, not a double log.
  - "STOP — Possible overdose" alert (no override) when the next tap would exceed the prescribed daily cap.
  - "Too soon since last dose" soft warning when doses are logged <2 hours apart.
  - Pill inventory is a *calculated* field (`recomputePillCount`), not a mutable counter, so Home and Detail always agree.
  - "Undo last" credits pills back to inventory; Skipped logs are implicit (anything not marked Taken).
  - All date checks are LOCAL-day-based so evening doses don't silently land on the next UTC day for users west of UTC.

## Privacy

All health data stays on your device in AsyncStorage — no accounts, no servers hold your personal log.

The Ask-AI and "More Information" features send your typed question (plus the drug name of the medication you opened) to your self-hosted RAG backend, which talks to Google's Gemini API. Sources are returned as clickable chips linking to the original FDA label on DailyMed. The privacy strings live in `constants/privacy.ts`.

---

## Running Locally

The app has two pieces: a **FastAPI backend** (AI + drug label retrieval) and the **Expo frontend**. You need to start both.

### Prerequisites

- Node.js 18+
- Python 3.8+
- A Google Gemini API key → [aistudio.google.com/app/apikey](https://aistudio.google.com/app/apikey) (free tier is fine)
- Optional: a Google Maps + Places key for the Nearby map → [console.cloud.google.com](https://console.cloud.google.com) (enable *Maps SDK for iOS*, *Maps SDK for Android*, and *Places API*)
- To test on a physical phone: [Expo Go](https://expo.dev/go) on iOS/Android, on the same Wi-Fi as your Mac. To run on a simulator: Xcode (iOS) or Android Studio (Android).

### 1. Backend setup (one time)

```bash
cd backend
chmod +x setup.sh && ./setup.sh       # creates venv, installs deps
```

Open `backend/.env` and set:

```bash
GOOGLE_API_KEY=your_gemini_key_here
GEMINI_MODEL=gemini-2.5-flash
CHROMA_DB_PATH=./chroma_db
RATE_LIMIT_PER_DAY=20
```

Then do the one-time drug-label ingestion (pulls FDA labels, embeds them with `gemini-embedding-001`, stores vectors in ChromaDB):

```bash
source venv/bin/activate
python3 ingest.py
```

The drug list is configured in `backend/drug_list.py` — add or remove names there and re-run `ingest.py`.

### 2. Start the backend

```bash
cd backend
source venv/bin/activate
python3 main.py
```

The server listens on `http://0.0.0.0:8000`. Sanity check: `curl http://localhost:8000/health`.

### 3. Frontend setup

```bash
npm install --legacy-peer-deps
```

Open `.env` at the repo root and set:

```bash
# Simulator: use localhost. Physical phone: use your Mac's LAN IP.
# Find it with:  ipconfig getifaddr en0
EXPO_PUBLIC_BACKEND_URL=http://<your-mac-lan-ip>:8000

EXPO_PUBLIC_GOOGLE_MAPS_KEY=your_maps_key_here
```

> ⚠️ The LAN IP changes whenever your Mac rejoins Wi-Fi. If the app shows "backend not running", check `ipconfig getifaddr en0`, update `.env`, and restart Expo with the `--clear` flag to bust the Metro cache.

### 4. Start the app

```bash
npx expo start --clear
```

Then:
- Press `i` → iOS Simulator
- Press `a` → Android Emulator
- Scan the QR code with your phone's camera (iOS) or Expo Go (Android)

---

## Project Structure

```
app/                            Expo Router — one file = one route
  _layout.tsx                   Root layout (fonts, safe area, auth gate)
  index.tsx                     Auth redirect (onboarding → home)
  onboarding.tsx                Privacy consent + name entry
  (tabs)/
    _layout.tsx                 Instagram-style bottom tab bar
    home.tsx                    Today's agenda + refill / avoid callouts
    medications/
      _layout.tsx               Stack (list → detail)
      index.tsx                 All-medications list + AddMedicationModal
      [id].tsx                  Medication detail + "More Information"
    support.tsx                 Journal | Ask AI chat | Nearby map
    emergency.tsx               Emergency profile + share

components/
  ChatbotFAB.tsx                Floating "sparkles" action button
  ChatbotModal.tsx              Full-screen chat popup (RAG client)
  ui/                           Shared Button, Card, Badge, PrivacyNotice

services/
  storage.ts                    AsyncStorage CRUD (all local)
  doseEngine.ts                 ★ Centralized dose safety + pill inventory
  claude.ts                     RAG backend client (chat, drug list,
                                food guidance, medication details)
  notifications.ts              Expo local reminders

constants/
  theme.ts                      Instagram-inspired palette + spacing
  privacy.ts                    All privacy notice strings

types/index.ts                  Medication, DoseLog, ChatSource, …
hooks/                          useMedications, useJournal,
                                useEmergencyProfile

backend/                        FastAPI + ChromaDB + Gemini RAG
  main.py                         /chat, /med-info, /food-guidance,
                                  /medication-details, /drugs, /health
  rag.py                          RAGPipeline — embed, retrieve, generate
  ingest.py                       One-time drug label → ChromaDB
  drug_list.py                    Which FDA labels to ingest
  safety.py                       Guard rails on generated content
  requirements.txt
  setup.sh
  chroma_db/                      Local vector store (gitignored)
```

---

## How the AI works

1. **Ingestion** (`backend/ingest.py`) pulls each drug's FDA label from DailyMed, splits it into semantic sections (INDICATIONS, WARNINGS, ADVERSE REACTIONS, CONTRAINDICATIONS, etc.), embeds each chunk with `gemini-embedding-001`, and stores the vectors + metadata in ChromaDB.
2. **Retrieval** (`backend/rag.py`) — for a user question, embed the query with the same model (using `task_type=RETRIEVAL_QUERY`), pull the top-k chunks for the referenced drug(s), and pass them as context to `gemini-2.5-flash`.
3. **Structured extraction** — the detail page's food guidance, side effects, and contraindications are generated with Gemini's `response_schema` for guaranteed JSON output, with `thinking_budget=0` so the model doesn't burn tokens on hidden reasoning and then truncate the JSON.
4. **Citations** — every response returns a `sources: ChatSource[]` list that the UI renders as tappable chips linking back to DailyMed, so the user can always verify.

Rate limiting lives in `backend/main.py` (per-day, per-user cap configurable via `RATE_LIMIT_PER_DAY`).

---

## Tech Stack

- **Frontend**: Expo SDK 54, React Native 0.76, Expo Router, TypeScript, `react-native-reanimated`, AsyncStorage
- **Backend**: FastAPI, ChromaDB, Google `google-genai` SDK (Gemini 2.5 Flash + `gemini-embedding-001`), `pypdfium2`, Pillow
- **External APIs**: Google Gemini (chat + embeddings), Google Maps + Places (Nearby), DailyMed (FDA label source for ingestion)

---

## Medical Disclaimer

MedsMinder is not a substitute for professional medical advice, diagnosis, or treatment. Always consult your healthcare provider before making medical decisions. AI-generated information is pulled from FDA drug labels but may contain errors — verify with your pharmacist or doctor before acting.
