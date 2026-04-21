"""
MedsMinder — RAG retrieval and prompt assembly

⚠️  PRIVACY: User questions and medication lists are processed here.
- Questions are embedded via Google Gemini API (data leaves device)
- Retrieved chunks contain only public FDA label data (no PHI)
- Assembled prompts are sent to Google Gemini API
- Nothing is stored beyond the audit log in main.py
"""

import os
from dataclasses import dataclass
import chromadb
from google import genai
from google.genai import types
from dotenv import load_dotenv

load_dotenv()

EMBED_MODEL = "gemini-embedding-001"
LLM_MODEL = os.getenv("GEMINI_MODEL", "gemini-2.5-flash")
CHROMA_PATH = os.getenv("CHROMA_DB_PATH", "./chroma_db")
N_RESULTS = 6  # top-k chunks to retrieve

SYSTEM_PROMPT = """You are MedsMinder's medication information assistant.
You answer questions about the user's medications using ONLY the FDA-approved drug label excerpts provided below.

STRICT RULES:
1. Answer ONLY from the provided source excerpts. If the sources don't cover the question, say so explicitly.
2. Never recommend changing a dose, stopping a medication, or starting a new one.
3. Never speculate or use outside knowledge beyond the provided sources.
4. If the question is outside the provided sources, respond: "I don't have enough information from your medications' labels to answer this. Please ask your prescriber or pharmacist."
5. Be clear and complete: aim for 4-8 sentences. Use short paragraphs or short bullet lists when that helps readability. Do not truncate mid-sentence.
6. End every response with: "⚕️ This is educational information, not medical advice. Always consult your healthcare provider."

FORMATTING:
- Do NOT add inline citations like [Drug — Section] in your prose. The app displays source links separately at the bottom of the message.
- Use plain prose or short bullets. If you use bullets, prefix each with "• ".
- Refer to drugs by name naturally in sentences (e.g., "Metformin can cause...").
"""

NO_RESULTS_RESPONSE = """I don't have FDA label information for your current medications in my database yet.

Please ask your prescriber, pharmacist, or check:
- **DailyMed** (dailymed.nlm.nih.gov) — official FDA drug labels
- **MedlinePlus** (medlineplus.gov) — plain-language drug information

⚕️ This is educational information, not medical advice. Always consult your healthcare provider."""


@dataclass
class RetrievedChunk:
    drug_name: str
    display_name: str
    section: str
    source_url: str
    text: str


@dataclass
class RAGResponse:
    answer: str
    sources: list[dict]  # [{drug, section, url}]
    retrieved_chunks: int
    is_emergency: bool = False
    is_out_of_scope: bool = False


class RAGPipeline:
    def __init__(self) -> None:
        google_key = os.getenv("GOOGLE_API_KEY")

        if not google_key or google_key == "your_google_api_key_here":
            raise RuntimeError("GOOGLE_API_KEY not configured in backend/.env")

        self.gemini = genai.Client(api_key=google_key)

        # Disable ChromaDB's anonymous telemetry — its posthog client is
        # incompatible with the installed version and spams noisy
        # "capture() takes 1 positional argument but 3 were given"
        # errors on every operation. Functionally harmless, but it
        # drowns out real log output.
        chroma = chromadb.PersistentClient(
            path=CHROMA_PATH,
            settings=chromadb.Settings(anonymized_telemetry=False),
        )
        self.collection = chroma.get_or_create_collection(
            name="drug_labels",
            metadata={"hnsw:space": "cosine"},
        )

    def _embed_question(self, question: str) -> list[float]:
        """Embed the user's question with the same model used at ingestion."""
        result = self.gemini.models.embed_content(
            model=EMBED_MODEL,
            contents=question,
            config=types.EmbedContentConfig(task_type="RETRIEVAL_QUERY"),
        )
        return result.embeddings[0].values

    def _retrieve(
        self, question_embedding: list[float], user_meds: list[str]
    ) -> list[RetrievedChunk]:
        """
        Query ChromaDB for top-k chunks.
        Filters to only chunks from the user's medication list.
        """
        # Normalize med names to lowercase for matching
        normalized_meds = [m.lower().strip() for m in user_meds]

        query_kwargs: dict = {
            "query_embeddings": [question_embedding],
            "n_results": N_RESULTS,
            "include": ["documents", "metadatas", "distances"],
        }

        # Filter to user's meds if list is provided and non-empty
        if normalized_meds:
            query_kwargs["where"] = {
                "drug_name": {"$in": normalized_meds}
            }

        try:
            results = self.collection.query(**query_kwargs)
        except Exception:
            # If filter returns no results, try without filter
            query_kwargs.pop("where", None)
            results = self.collection.query(**query_kwargs)

        chunks: list[RetrievedChunk] = []
        docs = results.get("documents", [[]])[0]
        metas = results.get("metadatas", [[]])[0]

        for doc, meta in zip(docs, metas):
            if doc and meta:
                chunks.append(
                    RetrievedChunk(
                        drug_name=meta.get("drug_name", ""),
                        display_name=meta.get("display_name", meta.get("drug_name", "")),
                        section=meta.get("section", ""),
                        source_url=meta.get("source_url", ""),
                        text=doc,
                    )
                )
        return chunks

    def _build_prompt(
        self, question: str, user_meds: list[str], chunks: list[RetrievedChunk]
    ) -> str:
        """Assemble the user-turn message for the LLM."""
        med_list = ", ".join(user_meds) if user_meds else "not specified"

        context_parts = []
        for chunk in chunks:
            label = f"[{chunk.display_name} — {chunk.section}]"
            context_parts.append(f"{label}\n{chunk.text}")

        context_block = "\n\n---\n\n".join(context_parts)

        return f"""User's current medications: {med_list}

Question: {question}

--- FDA LABEL EXCERPTS (use ONLY these as sources) ---

{context_block}

--- END OF SOURCES ---

Please answer the question using only the sources above. Cite inline with [DrugName — Section]."""

    def _extract_sources(self, chunks: list[RetrievedChunk]) -> list[dict]:
        seen = set()
        sources = []
        for chunk in chunks:
            key = (chunk.drug_name, chunk.section)
            if key not in seen:
                seen.add(key)
                sources.append(
                    {
                        "drug": chunk.display_name,
                        "section": chunk.section,
                        "url": chunk.source_url,
                    }
                )
        return sources

    def extract_food_guidance(self, drug_name: str) -> dict:
        """
        Extract structured food guidance for a drug from its FDA label chunks.
        Returns dict with boolean flags: takeWithFood, avoidAlcohol, avoidGrapefruit, avoidDairy.

        Uses Gemini's structured output to guarantee valid JSON. Falls back to
        all-false flags if no chunks are retrieved.
        """
        chunks = self._retrieve_all_for_drug(drug_name)

        default = {
            "takeWithFood": False,
            "avoidAlcohol": False,
            "avoidGrapefruit": False,
            "avoidDairy": False,
            "notes": "",
            "has_data": False,
        }

        if not chunks:
            return default

        context_parts = [f"[{c.display_name} — {c.section}]\n{c.text}" for c in chunks]
        context_block = "\n\n---\n\n".join(context_parts)

        extraction_prompt = f"""Based ONLY on the FDA label excerpts below, extract food/drink guidance for {drug_name}.

{context_block}

For each flag, set it to true ONLY if the label explicitly mentions it:
- takeWithFood: true if the label says to take this medication with food or meals
- avoidAlcohol: true if the label warns against alcohol consumption
- avoidGrapefruit: true if the label warns against grapefruit or grapefruit juice
- avoidDairy: true if the label warns against dairy, milk, or calcium-containing foods

Also add a short (1-2 sentence) `notes` field summarizing the guidance. If the label doesn't mention any of these, return all false and an empty notes string.
"""

        response_schema = {
            "type": "OBJECT",
            "properties": {
                "takeWithFood": {"type": "BOOLEAN"},
                "avoidAlcohol": {"type": "BOOLEAN"},
                "avoidGrapefruit": {"type": "BOOLEAN"},
                "avoidDairy": {"type": "BOOLEAN"},
                "notes": {"type": "STRING"},
            },
            "required": ["takeWithFood", "avoidAlcohol", "avoidGrapefruit", "avoidDairy", "notes"],
        }

        try:
            response = self.gemini.models.generate_content(
                model=LLM_MODEL,
                contents=extraction_prompt,
                config=types.GenerateContentConfig(
                    response_mime_type="application/json",
                    response_schema=response_schema,
                    # Gemini 2.5 Flash is a thinking model — for deterministic
                    # structured extraction we want the output budget to go
                    # entirely to the JSON, not to hidden reasoning tokens.
                    thinking_config=types.ThinkingConfig(thinking_budget=0),
                    max_output_tokens=1024,
                ),
            )
            import json
            parsed = json.loads(response.text)
            return {
                "takeWithFood": bool(parsed.get("takeWithFood", False)),
                "avoidAlcohol": bool(parsed.get("avoidAlcohol", False)),
                "avoidGrapefruit": bool(parsed.get("avoidGrapefruit", False)),
                "avoidDairy": bool(parsed.get("avoidDairy", False)),
                "notes": str(parsed.get("notes", "")),
                "has_data": True,
            }
        except Exception:
            return {**default, "has_data": True}

    def _retrieve_all_for_drug(self, drug_name: str, limit: int = 30) -> list[RetrievedChunk]:
        """
        Return ALL stored chunks for a specific drug (no embedding query).
        Used for structured extraction where we want to feed the entire label
        to the LLM, not just top-k similarity matches.
        """
        try:
            results = self.collection.get(
                where={"drug_name": drug_name.lower().strip()},
                limit=limit,
                include=["documents", "metadatas"],
            )
        except Exception:
            return []

        chunks: list[RetrievedChunk] = []
        docs = results.get("documents", []) or []
        metas = results.get("metadatas", []) or []
        for doc, meta in zip(docs, metas):
            if doc and meta:
                chunks.append(
                    RetrievedChunk(
                        drug_name=meta.get("drug_name", ""),
                        display_name=meta.get("display_name", meta.get("drug_name", "")),
                        section=meta.get("section", ""),
                        source_url=meta.get("source_url", ""),
                        text=doc,
                    )
                )
        return chunks

    def extract_medication_details(self, drug_name: str) -> dict:
        """
        Extract structured side effects and contraindications for a drug from
        its FDA label chunks.

        Returns:
            {
                "side_effects": [...],
                "contraindications": [...],
                "has_data": bool,   # True if the drug is in our database
            }

        Side effects = common / notable adverse reactions, in patient-friendly wording.
        Contraindications = people/conditions that must avoid this drug, plus
        serious warnings. We pull from any relevant section (WARNINGS,
        PRECAUTIONS, ADVERSE REACTIONS, CONTRAINDICATIONS, DRUG INTERACTIONS)
        because not every label has a dedicated CONTRAINDICATIONS / ADVERSE
        REACTIONS section (e.g. OTC drugs like ibuprofen).
        """
        # Feed the WHOLE drug label (all ingested sections) to the LLM so it
        # can pull side effects out of WARNINGS etc., not just from a top-k
        # similarity-filtered slice.
        chunks = self._retrieve_all_for_drug(drug_name)

        default = {"side_effects": [], "contraindications": [], "has_data": False}
        if not chunks:
            return default

        context_parts = [f"[{c.display_name} — {c.section}]\n{c.text}" for c in chunks]
        context_block = "\n\n---\n\n".join(context_parts)

        extraction_prompt = f"""Read the FDA label excerpts below for {drug_name} and extract two short lists for a patient-facing medication detail screen.

{context_block}

RULES:
- Use clear, patient-friendly language (avoid heavy medical jargon).
- Keep each item short — one phrase or sentence (5-15 words).
- Do NOT invent anything not supported by the excerpts.
- Cap each list at 8 items, prioritizing the most clinically important ones.
- If a section looks empty, STILL try the other sections — e.g. ibuprofen's ADVERSE REACTIONS content often lives inside WARNINGS AND PRECAUTIONS.

LISTS:
- side_effects: notable adverse reactions a patient might experience, pulled from ANY of: ADVERSE REACTIONS, WARNINGS AND PRECAUTIONS, USE IN SPECIFIC POPULATIONS. Example phrasing: "Stomach pain or heartburn", "Dizziness", "Increased risk of bleeding".
- contraindications: people, conditions, or combinations that should NOT use this drug, or serious warnings. Pull from CONTRAINDICATIONS, WARNINGS AND PRECAUTIONS, and DRUG INTERACTIONS. Example phrasing: "Do not use in late pregnancy", "Avoid if you have a history of stomach ulcers", "Do not combine with other NSAIDs".

If the excerpts truly contain nothing relevant for a list, return an empty array for that list (but still return the other one).
"""

        response_schema = {
            "type": "OBJECT",
            "properties": {
                "side_effects": {
                    "type": "ARRAY",
                    "items": {"type": "STRING"},
                },
                "contraindications": {
                    "type": "ARRAY",
                    "items": {"type": "STRING"},
                },
            },
            "required": ["side_effects", "contraindications"],
        }

        try:
            response = self.gemini.models.generate_content(
                model=LLM_MODEL,
                contents=extraction_prompt,
                config=types.GenerateContentConfig(
                    response_mime_type="application/json",
                    response_schema=response_schema,
                    # Disable "thinking" tokens — they burn through the output
                    # budget and cause JSON to truncate to an empty array.
                    thinking_config=types.ThinkingConfig(thinking_budget=0),
                    max_output_tokens=2048,
                ),
            )
            import json
            parsed = json.loads(response.text)
            return {
                "side_effects": [str(x) for x in parsed.get("side_effects", [])][:8],
                "contraindications": [str(x) for x in parsed.get("contraindications", [])][:8],
                "has_data": True,
            }
        except Exception:
            return {"side_effects": [], "contraindications": [], "has_data": True}

    def generate_medication_summary(self, drug_name: str, dose: str = "") -> RAGResponse:
        """
        Produce a patient-friendly summary for a single medication using the
        full ingested FDA label (not a top-k similarity slice).

        This is a DIFFERENT code path from `answer()` because:
          1. `answer()` is strict — it refuses when the label's exact product
             name doesn't match the query text (e.g. user's med is
             "Amoxicillin 20" but the ingested label is titled "Amoxicillin
             and Clavulanate Potassium"). For a standalone summary on the
             detail screen, we WANT the LLM to use the ingested label
             regardless of small naming variants.
          2. We feed the whole label, not the top-6 similarity hits, so the
             summary can span every section.
        """
        chunks = self._retrieve_all_for_drug(drug_name)

        if not chunks:
            return RAGResponse(
                answer=NO_RESULTS_RESPONSE,
                sources=[],
                retrieved_chunks=0,
                is_out_of_scope=True,
            )

        context_parts = [f"[{c.display_name} — {c.section}]\n{c.text}" for c in chunks]
        context_block = "\n\n---\n\n".join(context_parts)

        # Note: we intentionally drop the user's dose string from the prompt.
        # Tokens like "20" previously made the LLM think the query was for a
        # specific product not represented in the label and it refused.
        prompt = f"""You are writing a patient-friendly summary of a medication for a medication-tracker app.

The user takes: {drug_name}{f' ({dose})' if dose else ''}

The label below is the relevant FDA label stored in our database. Even if the exact product name or strength in the label differs from the user's entry (e.g. a combination product, a different dose, or a different brand), treat the label as the authoritative source for this generic drug.

--- FDA LABEL EXCERPTS ---

{context_block}

--- END OF LABEL ---

Write a concise overview (4-8 sentences) covering:
  • What the drug treats
  • How it should be taken (with/without food, timing, etc.)
  • Most common or notable side effects
  • Important interactions or warnings

RULES:
- Use plain, patient-friendly language — no heavy medical jargon.
- Never recommend changing, stopping, or starting a medication.
- Do NOT insert inline [DrugName — Section] citations. The app shows source links separately.
- End with: "⚕️ This is educational information, not medical advice. Always consult your healthcare provider."
"""

        response = self.gemini.models.generate_content(
            model=LLM_MODEL,
            contents=prompt,
            config=types.GenerateContentConfig(
                # Disable hidden thinking tokens — they eat the output budget
                # and sometimes cause empty / truncated responses.
                thinking_config=types.ThinkingConfig(thinking_budget=0),
                max_output_tokens=1024,
            ),
        )

        answer_text = (
            response.text
            if response.text
            else "Sorry, I couldn't generate a summary. Please try again."
        )

        return RAGResponse(
            answer=answer_text,
            sources=self._extract_sources(chunks),
            retrieved_chunks=len(chunks),
        )

    def answer(self, question: str, user_meds: list[str]) -> RAGResponse:
        """
        Full RAG pipeline:
        1. Embed question
        2. Retrieve relevant chunks filtered to user's meds
        3. Handle empty retrieval
        4. Assemble prompt
        5. Generate with Gemini
        6. Return structured response
        """
        question_embedding = self._embed_question(question)

        chunks = self._retrieve(question_embedding, user_meds)

        if not chunks:
            return RAGResponse(
                answer=NO_RESULTS_RESPONSE,
                sources=[],
                retrieved_chunks=0,
                is_out_of_scope=True,
            )

        user_message = self._build_prompt(question, user_meds, chunks)

        response = self.gemini.models.generate_content(
            model=LLM_MODEL,
            contents=user_message,
            config=types.GenerateContentConfig(
                system_instruction=SYSTEM_PROMPT,
                max_output_tokens=2048,
            ),
        )

        answer_text = (
            response.text
            if response.text
            else "Sorry, I couldn't generate a response. Please try again."
        )

        return RAGResponse(
            answer=answer_text,
            sources=self._extract_sources(chunks),
            retrieved_chunks=len(chunks),
        )
