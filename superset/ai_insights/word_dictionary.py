"""Lazy-loaded English word dictionary for LocalAI text repair.

Uses the dwyl/english-words corpus filtered to 3-20 char lowercase alpha
words, stored as a newline-delimited text file (~3.7 MB, ~370k words).
The set is loaded once on first access and cached for the process lifetime.

Local names (places, proper nouns) that are NOT in the English dictionary
are protected from being split or joined by the word-spacing repair logic.
"""
from __future__ import annotations

import logging
import os
from functools import lru_cache

logger = logging.getLogger(__name__)

_DICT_PATH = os.path.join(os.path.dirname(__file__), "english_words.txt")

# Domain-specific words NOT in the English dictionary that should be
# recognized as valid whole words (never split).  Add local place names,
# health acronyms, programme names, etc. here.
_DOMAIN_WORDS: set[str] = {
    # ── Uganda regions / sub-regions ──
    "kampala", "buganda", "busoga", "karamoja", "ankole", "teso",
    "lango", "acholi", "bunyoro", "tooro", "kigezi", "bukedi",
    "rwenzori", "sebei", "elgon", "albertine", "masaka", "mbarara",
    "gulu", "lira", "soroti", "arua", "jinja", "mbale", "fortportal",
    "kabale", "hoima", "moroto", "kotido", "nakapiripirit", "napak",
    "amudat", "abim", "kaabong",
    # ── Health / malaria domain ──
    "dhis2", "hmis", "iptp", "ipt", "llin", "llins", "irs", "act",
    "acts", "rdts", "rdt", "opd", "ipd", "anc", "postnatal",
    "antenatal", "primigravidae", "multigravidae", "sulfadoxine",
    "pyrimethamine", "artemether", "lumefantrine", "artesunate",
    "amodiaquine", "parasitaemia", "gametocyte", "gametocytes",
    "falciparum", "vivax", "sporozoite",
    "stockout", "stockouts", "subcounty", "subcounties",
    "kpi", "kpis",
    # ── Common terms the dictionary may lack ──
    "positivity", "watchouts", "datasets", "dataset", "dropdown",
    "timeseries", "tooltip", "tooltips", "healthcare", "workflow",
}


@lru_cache(maxsize=1)
def load_dictionary() -> frozenset[str]:
    """Return the full English word set (loaded once, cached forever)."""
    try:
        with open(_DICT_PATH, encoding="utf-8") as fh:
            words = frozenset(line.strip() for line in fh if line.strip())
        logger.info("Loaded English word dictionary: %d words", len(words))
        return words | _DOMAIN_WORDS
    except FileNotFoundError:
        logger.warning("English word dictionary not found at %s", _DICT_PATH)
        return frozenset(_DOMAIN_WORDS)


def is_known_word(word: str) -> bool:
    """Check if a word (case-insensitive) is in the dictionary."""
    return word.lower() in load_dictionary()


def is_known_word_exact(word: str) -> bool:
    """Check if a lowercase word is in the dictionary (no case conversion)."""
    return word in load_dictionary()
