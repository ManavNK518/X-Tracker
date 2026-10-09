# Verification

Verification states are derived from explicit evidence by `deriveVerification` (`src/server/pipeline/verification.ts`). The rules are evaluated in this order, and the first rule whose criteria are met wins. Each evaluation is recorded in `verification_attempts`, with the criteria met and whether the attempt was complete.

| Order | State | Criteria |
| --- | --- | --- |
| 1 | **Corrected** | A correction (e.g. "CORRECTION:", "clarification") was published by the originating source or organization, or by an authoritative source |
| 2 | **Disputed** | An unresolved contradiction exists from the authoritative/issuing party, or from a source whose quality is ≥ the origin's quality − 10 |
| 3 | **Confirmed by authoritative evidence** | A primary source that is authoritative for the event's category (`authority_domains`, e.g. a central bank for monetary policy, the company for its earnings) published the information: it is the origin, or it matches the claim with similarity ≥ 0.35 |
| 4 | **Primary source located** | A primary source related to the event is linked, but not matched strongly enough to the claim to count as confirmation |
| 5 | **Independently corroborated** | At least **two independence groups** of reputable sources (news organizations, journalists, specialists, researchers, official bodies, companies) report it. Reposts, quotes, attributions ("via @X", "according to Reuters") and accounts of the same organization share a group, so 100 accounts repeating one rumor count once |
| 6 | **Stale** | Old information resurfacing (published >24 h before collection), or no new evidence within `STALE_AFTER_HOURS`, without having been confirmed or corroborated |
| 7 | **Unable to verify** | Every enabled authoritative source for the event's category is failing, so verification could not be completed |
| 8 | **Unverified** | None of the above. "No contradiction found" never produces a verified state |

## Independence

Each item attached to an event carries an `independence_key`:

1. Reposts and quotes inherit the key of the item they reference.
2. Explicit attributions map to the attributed origin (`org:reuters`, or the organization of a registered handle).
3. Otherwise the source's organization (`org:…`), then the account (`acct:…`).

Only items in evidence roles (origin, corroboration, primary source) count toward independence. Repeats and commentary are kept as context but are never treated as confirmation.

## Rumors and contradictions

- Rumor events (hedged or anonymous sourcing) show an explicit "no confirmation" statement until evidence changes their state.
- Contradictions are stored in `contradictions`, shown with links to both sides, and lower confidence (see SCORING.md).

## Reliability observations

When an event becomes **confirmed** or **corrected**, an observation is recorded for the originating source, unless that source is itself the authoritative issuer. A **dispute** is recorded as *unresolved*, because a denial does not prove the claim was false. Owners can add observations with an evidence note on the Sources screen. Reliability adjusts source quality only after five resolved observations.
