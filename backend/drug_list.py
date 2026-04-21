"""
MedsMinder — Starter drug corpus (29 most-prescribed US drugs).
Covers: cardiovascular, diabetes, thyroid, mental health, pain, GI, respiratory, antibiotics.

Each entry is verified against DailyMed before shipping.
Expand this list post-MVP via on-demand ingestion when a user adds a new drug.
"""

STARTER_DRUGS = [
    # Cardiovascular
    "lisinopril",
    "amlodipine",
    "metoprolol",
    "atorvastatin",
    "simvastatin",
    "losartan",
    "hydrochlorothiazide",
    "furosemide",
    "carvedilol",
    "warfarin",
    # Diabetes
    "metformin",
    "glipizide",
    # Thyroid
    "levothyroxine",
    # Mental health
    "sertraline",
    "escitalopram",
    "bupropion",
    "alprazolam",
    "quetiapine",
    # Pain / neurological
    "tramadol",
    "gabapentin",
    "ibuprofen",
    # GI
    "omeprazole",
    "pantoprazole",
    # Respiratory
    "albuterol",
    "fluticasone",
    "montelukast",
    # Antibiotics / anti-infective
    "amoxicillin",
    "azithromycin",
    # Steroid
    "prednisone",
]

# DailyMed sections we extract and embed.
# Each becomes a separate chunk with its own embedding.
LABEL_SECTIONS = [
    "INDICATIONS & USAGE",
    "DOSAGE & ADMINISTRATION",
    "CONTRAINDICATIONS",
    "WARNINGS AND PRECAUTIONS",
    "ADVERSE REACTIONS",
    "DRUG INTERACTIONS",
    "USE IN SPECIFIC POPULATIONS",
]
