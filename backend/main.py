"""
MedsMinder — FastAPI backend

Endpoints:
  POST /chat       — RAG chatbot (main endpoint)
  POST /med-info   — AI-generated medication summary (used by detail screen)
  GET  /health     — Health check + DB stats

⚠️  PRIVACY & AUDITABILITY:
- Every /chat request is logged (timestamp, user_id, question_hash) — NO raw questions
- User medication lists are processed in-memory only, never stored server-side
- All health data originates from the device and is not persisted here
- Rate limit: 20 questions/user/day (in-memory, resets on server restart for MVP)

⚠️  SECURITY:
- No authentication for MVP (local network use only)
- Add API key auth or JWT before any public deployment
- CORS is open for local dev — restrict origins in production
"""

import hashlib
import logging
import os
import time
from collections import defaultdict
from datetime import datetime, date
from functools import lru_cache

from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

from safety import check_safety
from rag import RAGPipeline

load_dotenv()

# ── Logging setup ─────────────────────────────────────────────────────────────
# Logs question hashes (not content) for auditability.
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
)
logger = logging.getLogger("medsminder")

RATE_LIMIT = int(os.getenv("RATE_LIMIT_PER_DAY", "20"))

# In-memory rate limit store: {user_id: {date: count}}
# For MVP — resets on server restart. Use Redis post-MVP.
_rate_store: dict[str, dict[str, int]] = defaultdict(lambda: defaultdict(int))


# ── App setup ─────────────────────────────────────────────────────────────────
app = FastAPI(
    title="MedsMinder API",
    description="RAG-based medication chatbot using FDA DailyMed labels",
    version="1.0.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # ⚠️ Restrict in production
    allow_methods=["GET", "POST"],
    allow_headers=["*"],
)


@lru_cache(maxsize=1)
def get_rag_pipeline() -> RAGPipeline:
    """Lazy-initialize RAG pipeline (loads ChromaDB on first request)."""
    return RAGPipeline()


# ── Request / Response models ─────────────────────────────────────────────────

class ChatRequest(BaseModel):
    question: str = Field(..., min_length=1, max_length=500)
    user_meds: list[str] = Field(default_factory=list, description="Drug names from user's med list")
    user_id: str = Field(default="anonymous", description="Opaque user identifier for rate limiting")


class SourceItem(BaseModel):
    drug: str
    section: str
    url: str


class ChatResponse(BaseModel):
    answer: str
    sources: list[SourceItem]
    is_emergency: bool = False
    is_out_of_scope: bool = False
    retrieved_chunks: int = 0


class MedInfoRequest(BaseModel):
    drug_name: str
    dose: str = ""


class MedInfoResponse(BaseModel):
    summary: str
    sources: list[SourceItem]


class FoodGuidanceRequest(BaseModel):
    drug_name: str


class FoodGuidanceResponse(BaseModel):
    takeWithFood: bool
    avoidAlcohol: bool
    avoidGrapefruit: bool
    avoidDairy: bool
    notes: str
    has_data: bool = False


class MedicationDetailsRequest(BaseModel):
    drug_name: str


class MedicationDetailsResponse(BaseModel):
    side_effects: list[str]
    contraindications: list[str]
    has_data: bool = False


# ── Rate limiting ─────────────────────────────────────────────────────────────

def check_rate_limit(user_id: str) -> bool:
    """Returns True if under limit, False if exceeded."""
    today = date.today().isoformat()
    _rate_store[user_id][today] += 1
    return _rate_store[user_id][today] <= RATE_LIMIT


# ── Endpoints ─────────────────────────────────────────────────────────────────

@app.get("/health")
async def health():
    """Health check. Also reports ChromaDB collection stats."""
    try:
        rag = get_rag_pipeline()
        count = rag.collection.count()
        return {
            "status": "ok",
            "chroma_chunks": count,
            "rate_limit_per_day": RATE_LIMIT,
            "timestamp": datetime.utcnow().isoformat(),
        }
    except Exception as e:
        return {"status": "degraded", "error": str(e)}


@app.get("/drugs")
async def list_drugs():
    """
    Return the list of drug names that have been ingested into the vector DB.
    Used by the frontend to power the medication-name autocomplete dropdown
    on the "Add medication" form so users only see meds we can enrich.
    """
    try:
        rag = get_rag_pipeline()
        # Pull all metadata rows; ChromaDB returns dicts keyed by 'ids' and
        # 'metadatas'. Each chunk has a 'drug' key — we dedupe & sort.
        result = rag.collection.get(include=["metadatas"])
        names: set[str] = set()
        for meta in result.get("metadatas") or []:
            if not meta:
                continue
            name = meta.get("drug")
            if isinstance(name, str) and name.strip():
                names.add(name.strip().lower())
        return {"drugs": sorted(names)}
    except Exception as e:
        # Fall back to the static corpus so the UI still has suggestions even
        # if the vector DB hasn't been ingested yet.
        logger.warning(f"/drugs fallback to static corpus: {e}")
        from drug_list import STARTER_DRUGS
        return {"drugs": sorted(STARTER_DRUGS)}


@app.post("/chat", response_model=ChatResponse)
async def chat(req: ChatRequest, request: Request):
    """
    Main RAG chatbot endpoint.

    Pipeline:
    1. Rate limit check
    2. Emergency keyword filter (pre-LLM)
    3. RAG retrieval + generation
    4. Audit log (hash only, no raw question)
    """
    # Rate limit
    if not check_rate_limit(req.user_id):
        raise HTTPException(
            status_code=429,
            detail=f"Daily question limit ({RATE_LIMIT}) reached. Try again tomorrow.",
        )

    # Audit log — hash the question, never log raw content
    question_hash = hashlib.sha256(req.question.encode()).hexdigest()[:16]
    logger.info(
        f"chat request | user={req.user_id[:8]} | q_hash={question_hash} | "
        f"meds_count={len(req.user_meds)} | ip={request.client.host if request.client else 'unknown'}"
    )

    # Step 1: Emergency pre-filter (skip LLM entirely if emergency)
    safety = check_safety(req.question)
    if safety.is_emergency:
        logger.warning(f"Emergency trigger | user={req.user_id[:8]} | q_hash={question_hash}")
        return ChatResponse(
            answer=safety.response or "",
            sources=[],
            is_emergency=True,
        )

    # Step 2: RAG pipeline
    try:
        rag = get_rag_pipeline()
        result = rag.answer(req.question, req.user_meds)
    except RuntimeError as e:
        # API keys not configured
        raise HTTPException(status_code=503, detail=str(e))
    except Exception as e:
        logger.error(f"RAG error | user={req.user_id[:8]} | error={e}")
        raise HTTPException(status_code=500, detail="Internal error. Please try again.")

    return ChatResponse(
        answer=result.answer,
        sources=[SourceItem(**s) for s in result.sources],
        is_emergency=False,
        is_out_of_scope=result.is_out_of_scope,
        retrieved_chunks=result.retrieved_chunks,
    )


@app.post("/med-info", response_model=MedInfoResponse)
async def med_info(req: MedInfoRequest):
    """
    Generate a patient-friendly medication summary from the FULL ingested
    FDA label. Used by the "More Information" section on the medication
    detail screen.

    We deliberately use `generate_medication_summary` (not the strict RAG
    `answer` pipeline) so small naming mismatches — e.g. user entered
    "Amoxicillin 20" but the ingested label is "Amoxicillin and Clavulanate
    Potassium" — don't cause the LLM to refuse.
    """
    try:
        rag = get_rag_pipeline()
        result = rag.generate_medication_summary(req.drug_name, req.dose)
    except RuntimeError as e:
        raise HTTPException(status_code=503, detail=str(e))
    except Exception as e:
        logger.error(f"med-info error | drug={req.drug_name} | error={e}")
        raise HTTPException(status_code=500, detail="Internal error. Please try again.")

    return MedInfoResponse(
        summary=result.answer,
        sources=[SourceItem(**s) for s in result.sources],
    )


@app.post("/food-guidance", response_model=FoodGuidanceResponse)
async def food_guidance(req: FoodGuidanceRequest):
    """
    Extract structured food/drink guidance for a drug from its FDA label.
    Called automatically when a user adds a medication — the app populates
    foodGuidance flags instead of asking the user to figure it out.
    """
    try:
        rag = get_rag_pipeline()
        result = rag.extract_food_guidance(req.drug_name)
    except RuntimeError as e:
        raise HTTPException(status_code=503, detail=str(e))
    except Exception as e:
        logger.error(f"food-guidance error | drug={req.drug_name} | error={e}")
        raise HTTPException(status_code=500, detail="Internal error. Please try again.")

    return FoodGuidanceResponse(**result)


@app.post("/medication-details", response_model=MedicationDetailsResponse)
async def medication_details(req: MedicationDetailsRequest):
    """
    Extract structured side effects and contraindications for a drug from its
    FDA label. Called automatically when a user adds a medication so the
    detail page isn't empty.
    """
    try:
        rag = get_rag_pipeline()
        result = rag.extract_medication_details(req.drug_name)
    except RuntimeError as e:
        raise HTTPException(status_code=503, detail=str(e))
    except Exception as e:
        logger.error(f"medication-details error | drug={req.drug_name} | error={e}")
        raise HTTPException(status_code=500, detail="Internal error. Please try again.")

    return MedicationDetailsResponse(**result)


# ── Dev runner ────────────────────────────────────────────────────────────────
if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)
