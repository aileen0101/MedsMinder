"""
MedsMinder — Safety Layer

Pre-LLM emergency keyword filter.
If the user's question matches any emergency pattern, we skip the LLM entirely
and return a hardcoded emergency response. This is safety-critical — do not weaken.

⚠️  PRIVACY: Questions that trigger this filter are still logged (timestamp only,
no content) for auditability. See logging notes in main.py.
"""

import re
from dataclasses import dataclass

# Emergency keyword patterns — deliberately broad to reduce false negatives.
# A false positive (returning emergency info unnecessarily) is always safer
# than a false negative (letting an LLM handle a real emergency).
EMERGENCY_PATTERNS = [
    r"\bchest\s*pain\b",
    r"\bcan'?t\s+breathe\b",
    r"\bdifficulty\s+breathing\b",
    r"\bshortness\s+of\s+breath\b",
    r"\boverdose\b",
    r"\btook\s+too\s+many\b",
    r"\bsuicid(al|e)\b",
    r"\bkill\s+(my)?self\b",
    r"\bwant\s+to\s+die\b",
    r"\banaphylax(is|tic)\b",
    r"\bsevere\s+allergic\b",
    r"\bface\s+(is\s+)?(swelling|swollen)\b",
    r"\bthroat\s+(is\s+)?(swelling|closing|tight)\b",
    r"\bseizure\b",
    r"\bunconscious\b",
    r"\bpassed\s+out\b",
    r"\bstroke\b",
    r"\bheart\s+attack\b",
    r"\bnot\s+breathing\b",
    r"\bblood\s+pressure\s+(is\s+)?(very\s+)?(high|low|dangerous)\b",
    r"\bpoison(ed|ing)?\b",
    r"\baccidental\s+(ingestion|overdose)\b",
]

_COMPILED = [re.compile(p, re.IGNORECASE) for p in EMERGENCY_PATTERNS]

EMERGENCY_RESPONSE = """🚨 This sounds like a medical emergency.

**Call 911 immediately** if you or someone else is in danger.

**Poison Control (US):** 1-800-222-1222 (24/7, free, confidential)
For medication overdoses or accidental ingestion.

**Crisis Lifeline:** 988 (call or text, 24/7)
For mental health emergencies.

---
MedsMinder cannot handle emergencies. Please contact emergency services now.
"""


@dataclass
class SafetyResult:
    is_emergency: bool
    response: str | None = None  # pre-built response if is_emergency


def check_safety(question: str) -> SafetyResult:
    """
    Returns SafetyResult(is_emergency=True, response=...) if emergency detected.
    Returns SafetyResult(is_emergency=False) if safe to proceed.
    """
    for pattern in _COMPILED:
        if pattern.search(question):
            return SafetyResult(is_emergency=True, response=EMERGENCY_RESPONSE)
    return SafetyResult(is_emergency=False)
