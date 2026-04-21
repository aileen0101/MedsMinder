"""
MedsMinder — One-time ingestion pipeline

Fetches FDA drug labels from openFDA, chunks them by section,
embeds with Google Gemini gemini-embedding-001, and stores in ChromaDB.

Run once before launch:
    cd backend
    python ingest.py

Takes ~5-10 minutes for 29 drugs. Free with Google Gemini API.

Get a free API key at: https://aistudio.google.com/app/apikey

⚠️  PRIVACY: This script only processes public FDA label data (openFDA).
No user data is involved at ingestion time.
"""

import os
import re
import time
import json
import sys
import requests
import chromadb
from google import genai
from google.genai import types
from dotenv import load_dotenv
from drug_list import STARTER_DRUGS, LABEL_SECTIONS

load_dotenv()

GOOGLE_API_KEY = os.getenv("GOOGLE_API_KEY")
CHROMA_PATH = os.getenv("CHROMA_DB_PATH", "./chroma_db")
OPENFDA_LABEL = "https://api.fda.gov/drug/label.json"
DAILYMED_SEARCH = "https://dailymed.nlm.nih.gov/dailymed/services/v2/spls.json"
DAILYMED_URL = "https://dailymed.nlm.nih.gov/dailymed/drugInfo.cfm?setid={setid}"
EMBED_MODEL = "gemini-embedding-001"

# openFDA field names → our canonical section names
OPENFDA_SECTION_MAP = {
    "INDICATIONS & USAGE": "indications_and_usage",
    "DOSAGE & ADMINISTRATION": "dosage_and_administration",
    "CONTRAINDICATIONS": "contraindications",
    "WARNINGS AND PRECAUTIONS": "warnings_and_cautions",
    "WARNINGS": "warnings",
    "ADVERSE REACTIONS": "adverse_reactions",
    "DRUG INTERACTIONS": "drug_interactions",
    "USE IN SPECIFIC POPULATIONS": "use_in_specific_populations",
}


def get_setid(drug_name: str) -> tuple[str, str] | None:
    """Query DailyMed for the setid of a drug. Returns (setid, display_name).
    Used only to build a source URL — label text comes from openFDA."""
    try:
        resp = requests.get(
            DAILYMED_SEARCH,
            params={"drug_name": drug_name, "limit": 1},
            timeout=10,
        )
        resp.raise_for_status()
        data = resp.json()
        items = data.get("data", [])
        if not items:
            return None
        item = items[0]
        return item["setid"], item.get("title", drug_name)
    except Exception as e:
        print(f"  ⚠️  DailyMed search failed for {drug_name}: {e}")
        return None


def fetch_label_text(drug_name: str) -> str:
    """Fetch structured label text from openFDA (returns native JSON).
    Falls back to brand name search if generic name returns no results."""
    def _query(search_term: str) -> list:
        resp = requests.get(
            OPENFDA_LABEL,
            params={"search": search_term, "limit": 1},
            timeout=15,
        )
        resp.raise_for_status()
        return resp.json().get("results", [])

    try:
        results = _query(f"openfda.generic_name:{drug_name}")
        if not results:
            results = _query(f"openfda.brand_name:{drug_name}")
        if not results:
            return ""

        label = results[0]

        parts = []
        for section_name, field in OPENFDA_SECTION_MAP.items():
            value = label.get(field)
            if value:
                text = " ".join(value) if isinstance(value, list) else value
                # Prefix with section header so extract_sections can split on it
                parts.append(f"{section_name} {text}")

        return " ".join(parts)

    except Exception as e:
        print(f"  ⚠️  Label fetch failed: {e}")
        return ""


def extract_sections(text: str, drug_name: str) -> dict[str, str]:
    """
    Split label text into sections using header pattern matching.
    Returns dict of {section_name: section_text}.
    """
    if not text:
        return {}

    section_patterns = {
        "INDICATIONS & USAGE": re.compile(
            r"INDICATIONS\s*(?:&|AND)\s*USAGE", re.IGNORECASE
        ),
        "DOSAGE & ADMINISTRATION": re.compile(
            r"DOSAGE\s*(?:&|AND)\s*ADMINISTRATION", re.IGNORECASE
        ),
        "CONTRAINDICATIONS": re.compile(r"CONTRAINDICATIONS", re.IGNORECASE),
        "WARNINGS AND PRECAUTIONS": re.compile(
            r"WARNINGS?\s*(?:AND\s*PRECAUTIONS?)?", re.IGNORECASE
        ),
        "ADVERSE REACTIONS": re.compile(r"ADVERSE\s*REACTIONS?", re.IGNORECASE),
        "DRUG INTERACTIONS": re.compile(r"DRUG\s*INTERACTIONS?", re.IGNORECASE),
        "USE IN SPECIFIC POPULATIONS": re.compile(
            r"USE\s*IN\s*SPECIFIC\s*POPULATIONS?", re.IGNORECASE
        ),
    }

    sections: dict[str, str] = {}
    positions: list[tuple[int, str]] = []

    for section_name, pattern in section_patterns.items():
        match = pattern.search(text)
        if match:
            positions.append((match.start(), section_name))

    positions.sort(key=lambda x: x[0])

    for i, (start, section_name) in enumerate(positions):
        end = positions[i + 1][0] if i + 1 < len(positions) else len(text)
        section_text = text[start:end].strip()

        if len(section_text) > 2000:
            section_text = section_text[:2000] + "..."

        if len(section_text) > 100:
            sections[section_name] = section_text

    return sections


def embed_texts(texts: list[str]) -> list[list[float]]:
    """Embed a batch of texts using Google Gemini gemini-embedding-001."""
    client = genai.Client(api_key=GOOGLE_API_KEY)
    result = client.models.embed_content(
        model=EMBED_MODEL,
        contents=texts,
        config=types.EmbedContentConfig(task_type="RETRIEVAL_DOCUMENT"),
    )
    embeddings = [e.values for e in result.embeddings]
    return embeddings


def ingest_drug(
    drug_name: str,
    collection: chromadb.Collection,
) -> int:
    """
    Full pipeline for one drug: fetch → extract → embed → store.
    Returns number of chunks stored.
    """
    print(f"\n{'='*50}")
    print(f"Processing: {drug_name}")

    # Get setid from DailyMed just for the source URL
    setid = None
    display_name = drug_name
    result = get_setid(drug_name)
    if result:
        setid, display_name = result
        print(f"  → setid: {setid}")
        print(f"  → label: {display_name}")

    source_url = DAILYMED_URL.format(setid=setid) if setid else ""

    label_text = fetch_label_text(drug_name)
    if not label_text:
        print(f"  ✗ Empty label text — skipping")
        return 0

    sections = extract_sections(label_text, drug_name)
    if not sections:
        print(f"  ✗ No sections extracted — skipping")
        return 0

    print(f"  → {len(sections)} sections found: {', '.join(sections.keys())}")

    section_names = list(sections.keys())
    section_texts = [sections[s] for s in section_names]

    try:
        embeddings = embed_texts(section_texts)
    except Exception as e:
        print(f"  ✗ Embedding failed: {e}")
        return 0

    ids = [f"{drug_name.replace(' ', '_')}_{s.replace(' ', '_').replace('&', 'and')}" for s in section_names]
    metadatas = [
        {
            "drug_name": drug_name,
            "display_name": display_name,
            "section": s,
            "source_url": source_url,
            "setid": setid or "",
        }
        for s in section_names
    ]

    collection.upsert(
        ids=ids,
        embeddings=embeddings,
        documents=section_texts,
        metadatas=metadatas,
    )

    print(f"  ✓ Stored {len(section_names)} chunks")
    return len(section_names)


def main() -> None:
    if not GOOGLE_API_KEY or GOOGLE_API_KEY == "your_google_api_key_here":
        print("❌ GOOGLE_API_KEY not set in backend/.env")
        print("   Get a free key at: https://aistudio.google.com/app/apikey")
        sys.exit(1)

    chroma_client = chromadb.PersistentClient(
        path=CHROMA_PATH,
        settings=chromadb.Settings(anonymized_telemetry=False),
    )
    collection = chroma_client.get_or_create_collection(
        name="drug_labels",
        metadata={"hnsw:space": "cosine"},
    )

    print(f"ChromaDB path: {CHROMA_PATH}")
    print(f"Drugs to ingest: {len(STARTER_DRUGS)}")
    print(f"Starting ingestion...\n")

    total_chunks = 0
    failed = []

    for drug_name in STARTER_DRUGS:
        chunks = ingest_drug(drug_name, collection)
        total_chunks += chunks
        if chunks == 0:
            failed.append(drug_name)
        time.sleep(1)

    print(f"\n{'='*50}")
    print(f"✅ Ingestion complete")
    print(f"   Total chunks stored: {total_chunks}")
    print(f"   Drugs processed: {len(STARTER_DRUGS) - len(failed)}/{len(STARTER_DRUGS)}")

    if failed:
        print(f"   ⚠️  Failed drugs (need manual review): {', '.join(failed)}")

    manifest = {
        "total_chunks": total_chunks,
        "drugs_ingested": [d for d in STARTER_DRUGS if d not in failed],
        "drugs_failed": failed,
        "embed_model": EMBED_MODEL,
        "chroma_path": CHROMA_PATH,
    }
    with open("ingestion_manifest.json", "w") as f:
        json.dump(manifest, f, indent=2)
    print(f"   Manifest saved to ingestion_manifest.json")


if __name__ == "__main__":
    main()