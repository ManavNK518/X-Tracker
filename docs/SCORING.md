# Scoring

Two separate scores are computed for every event and stored with their component breakdown. Every change is recorded in `score_records` together with the scoring version (`SCORING_VERSION` in `src/config/scoring.ts`).

- **Importance (0–100)** measures *research priority*: how much attention the event deserves. It is **not** a probability of price movement or profit.
- **Confidence (0–100)** measures *the strength of the evidence* supporting the event's interpretation.

A high-impact rumor can therefore score high importance and low confidence.

## Importance components

| Component | Weight | How it is assessed |
| --- | --- | --- |
| Potential market significance | 25% | Category base value (`CATEGORY_SIGNIFICANCE`), +10 for magnitude language (unexpected, emergency, halt…), ×0.3 for opinion/commentary. Rumors keep their potential significance (impact *if true*). |
| Source quality | 20% | Best evidence source's category baseline (`SOURCE_CATEGORY_QUALITY`), raised to ≥95 for an authoritative primary source, ±15 maximum from reliability evidence once ≥5 resolved observations exist. Unregistered accounts are **unknown**. Follower counts, engagement and verification badges are never inputs. |
| Novelty | 20% | New 90, correction 70, update 60, resurfaced old information 15. |
| Relevance to tracked assets | 15% | Directly named watchlist asset 90, mapped asset 55, tracked category 35, nothing 10. **Unknown** when no watchlists exist. |
| Verification & corroboration | 15% | Confirmed 100, primary source located 80, independently corroborated 75, corrected 55, unverified 25, disputed 20, stale 15. **Unknown** when verification could not be completed. |
| Time sensitivity | 5% | ≤15 min 100, ≤1 h 85, ≤6 h 55, ≤24 h 30, older 10. **Unknown** without a publication time. |

## Confidence components

| Component | Weight | Notes |
| --- | --- | --- |
| Source authenticity | 20% | Registered primary 90, registered 65, unregistered 30 |
| Directness | 20% | First-hand 90, attributed 60, plain report 55, hedged/anonymous 25, opinion 15 |
| Independent corroboration | 20% | Authoritative confirmation 95, primary source located 80, ≥3 independent reputable 85, 2 → 65, otherwise 20 |
| Consistency across sources | 10% | **Unknown** with a single evidence item; 85 if consistent, 25 if sources disagree |
| Entity-matching confidence | 10% | Mean confidence of direct entity matches; **unknown** if none |
| Time relevance | 10% | 90 fresh, 25 resurfaced; unknown without a publication time |
| Absence of contradictions | 10% | **Unknown** with a single evidence item (absence of contradiction is not evidence); 90 with several consistent sources; 30 / 10 with contradictions |

Adjustments shown as their own rows:

- **Contradiction penalty:** ×0.5 when the issuing or authoritative party contradicts the claim, ×0.8 for other contradictions, ×0.8 after a correction.
- **Untrusted-instruction cap:** confidence is capped at 35 when the origin text addresses automated systems ("ignore previous instructions…").

## Unknown-component policy

`UNKNOWN_POLICY.policy` (default **conservative**): components that cannot be assessed contribute **0 points**, so the total is a lower bound. Coverage (the share of weight that was assessed) is shown next to every score. The alternatives are `neutral` (unknown = 50) and `renormalize` (weight only the assessed components). No component is ever silently scored as perfect.

## Priority bands (configurable)

| Band | Score |
| --- | --- |
| Critical research priority | 80–100 |
| High priority | 60–79 |
| Moderate priority | 40–59 |
| Low priority | 20–39 |
| Minimal priority | 0–19 |

## Changing scoring

Edit `src/config/scoring.ts`, bump `SCORING_VERSION`, and run `npm test`, which includes a check that the weights sum to 1. User feedback never changes production scoring automatically; use it through the evaluation metrics on System Status, then make deliberate, versioned changes.
