# Market research summary

Researched September 2026. Sources checked: product pages and recent
coverage of Otter.ai, Fireflies.ai, Fathom, tl;dv, Read.ai, Tactiq, Fellow,
Notta, and Kai for Chrome; general roundups of "best AI meeting assistant
extensions."

## What's already well-served (don't rebuild this)
- Live transcription + AI summary + action-item list: table stakes,
  every major competitor has it.
- Bot-based recording (joins as a fake participant, uploads audio to the
  cloud): the dominant architecture, and the thing a meaningful number of
  users/IT admins are uneasy about letting into external calls.
- Bot-free, browser-only caption capture: exists and is a real, growing
  category (Tactiq, Kai). Not unique on its own, but a legitimate,
  publishable foundation.
- Fully on-device / local-first processing: rare but not unclaimed — Kai
  for Chrome specifically markets on-device transcription via
  WebGPU/WASM.
- "Resurface open action items before your next meeting": exists at
  Fellow and (per its own marketing) Fireflies. Reviews describe both as
  inconsistent in practice, which is a real opportunity but not an
  unclaimed feature.

## The gap: cross-meeting decision redundancy detection
Across every product page, review roundup, and feature comparison
checked, none advertise or appear to implement: comparing the *current*
live discussion against a semantic index of the user's *own past
meetings* to detect that a decision is being re-litigated. There's
academic precedent for the underlying technique (a 2024 paper applying
semantic similarity search to detect near-duplicate coverage across news
archives — "news déjà vu" — a different domain entirely), but nothing
found applies it to meetings.

## The decision
Rather than claim total novelty (unrealistic in a category this
saturated — see above), Precedent bets on a specific combination that
appears genuinely unclaimed: bot-free capture + fully local processing +
live cross-meeting déjà vu detection, with commitment-resurfacing done as
a secondary feature rather than the main pitch (since that part alone
isn't new). The privacy properties of "bot-free + local" also
double as the honest differentiator against the well-funded competitors,
since none of them can credibly make the same claim about their core
architecture.
