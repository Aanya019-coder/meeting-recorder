# Precedent — Meetings That Remember

A Chrome extension (Manifest V3) for Google Meet, Zoom Web Client, and
Microsoft Teams (web) that does two things no shipped product currently
combines:

1. **Déjà vu detection** — flags, live, when the conversation is
   re-deciding something a past meeting with these same people already
   settled ("You may have already decided this — March 3rd, Rasta sync").
2. **Commitment memory** — surfaces open "I'll do X by Friday" promises
   from past meetings with today's attendees, *before* today's meeting
   starts, not buried in a dashboard nobody opens.

Everything runs on-device. No bot joins your call, no audio leaves the
browser, there is no server and no account. See `docs/PRIVACY_POLICY.md`.

## Why this exists (and why not just use Otter/Fireflies/Fathom)

Read `docs/MARKET_RESEARCH.md` for the full breakdown. Short version: the
"resurface commitments" idea already exists (Fellow, Fireflies). Fully
local processing already exists (Kai for Chrome). Nobody combines
local-only + bot-free + cross-meeting semantic redundancy detection. That
combination is the bet this project makes.

## Project structure

```
manifest.json
lib/                       -- shared, platform-agnostic logic
  hashing-vectorizer.js     on-device "embedding" via feature hashing (no model download)
  date-parser.js             resolves "by Friday" / "EOD" / "next week" to real dates
  commitment-extractor.js    regex/heuristic promise detection
  decision-extractor.js      decision detection + déjà vu similarity search
  attendee-matcher.js        fuzzy name matching across meetings
  db.js                      IndexedDB wrapper (background worker only)
background/
  service-worker.js          message router, persistence, settings, badge
content/
  common/
    caption-observer.js      generic debounced MutationObserver caption watcher
    overlay-ui.js             shadow-DOM in-meeting panel
    platform-adapter.js       glue: captions -> extraction -> overlay -> storage
  meet.js / zoom.js / teams.js   per-platform DOM selectors only
popup/                      toolbar popup: status, open commitments, recent meetings
options/                    settings: platform toggles, sensitivity, retention, export/delete
icons/
docs/
```

The split matters: `platform-adapter.js` holds 100% of the *behavior*.
`meet.js`/`zoom.js`/`teams.js` hold *only* DOM selectors. When a platform
changes its markup, you edit one small file, not the logic.

## Install locally (for testing before publishing)

1. Open `chrome://extensions`.
2. Enable **Developer mode** (top right).
3. Click **Load unpacked** and select this folder.
4. Join a Google Meet call, **turn on live captions** (captions are
   required — this extension reads them, it does not listen to audio),
   and look for the "Precedent" pill in the bottom-right corner.

## Publishing to the Chrome Web Store

1. Create a developer account at https://chrome.google.com/webstore/devconsole
   (one-time $5 registration fee, charged by Google).
2. Zip the extension folder's *contents* (not the folder itself — the zip
   root must contain `manifest.json` directly):
   ```
   cd precedent-extension
   zip -r ../precedent-extension.zip . -x "docs/*" ".git/*"
   ```
3. Upload the zip in the developer dashboard, fill in the listing (see
   `docs/STORE_LISTING.md` for ready-to-paste copy), attach a privacy
   policy URL (host `docs/PRIVACY_POLICY.md` somewhere public — a GitHub
   Pages link works), and add at least one screenshot (1280x800 or
   640x400 — take a real screenshot of the popup and overlay once you've
   tested on a live call).
4. Google's review checks permissions match described behavior — this
   extension's `host_permissions` are scoped to exactly the three
   platforms it works on, which review flows generally accept faster than
   `<all_urls>` requests.
5. Expect a review delay (historically days to ~1-2 weeks for new
   extensions handling any sensitive-sounding permission like
   `host_permissions` on meeting sites) — budget for it if you have a
   launch date in mind.

## Maintaining selectors (you will need to do this)

The single biggest risk to this project, stated plainly: **Meet, Zoom,
and Teams do not publish a captions API for browser extensions.** This
reads their caption DOM, and none of the three vendors guarantees that
DOM stays stable. Google Meet's is the one selector in this codebase
backed by a documented, comparatively stable anchor
(`[role="region"][aria-label="Captions"]`). Zoom and Teams use
best-effort ARIA/structural heuristics because I could not verify their
current production markup from here — you should verify both against a
real call before publishing, and re-verify periodically after.

How to check/update a selector in ~2 minutes:
1. Join a call on the platform, turn on captions, right-click a caption
   line -> **Inspect**.
2. Find the closest stable ancestor with a `role`, `aria-label`, or
   `data-tid`-style attribute (prefer these over class names — class
   names on all three platforms are build-hashed and rotate).
3. Update the matching `get*` function in `content/meet.js` /
   `content/zoom.js` / `content/teams.js` only. Nothing else needs to
   change.

## My honest self-critique of this build

You asked me to critique my own decisions rather than just present the
idea, so here's where I think this is genuinely strong and where it's
weakest:

**Strong:**
- The core hook (déjà vu detection) is real and, per the research, not
  shipped anywhere else in this category.
- Fully local processing is a legitimate, checkable privacy claim — a
  reviewer or a skeptical user can read `lib/db.js` and `manifest.json`'s
  `host_permissions` and verify nothing calls out to a server.
- The hashing-vectorizer approach means zero-friction install: no 30-90MB
  model download, works the instant it's installed, no GPU/WASM
  requirements that could fail on lower-end machines.

**Weak, and I'm not going to pretend otherwise:**
- **Caption-dependent by construction.** If a user doesn't turn on live
  captions, this extension does nothing. That's a real adoption tax
  compared to bot-based tools that need zero setup from attendees.
- **Zoom and Teams selectors are unverified.** I said this above and I'm
  saying it again because it's the part most likely to make the extension
  feel broken on first use for two of the three platforms. Verify before
  you publish, or scope your first release to Meet-only and add Zoom/Teams
  once selectors are confirmed — I'd actually recommend that over
  shipping all three at once with two of them unverified.
- **The hashing-vectorizer will miss pure paraphrase.** "Let's ship
  Tuesday" and "we'll release early next week" share almost no tokens and
  won't match. It catches lexical overlap, not deep semantic equivalence.
  I chose this trade-off deliberately (see the comment in
  `lib/hashing-vectorizer.js`) to avoid bundling a real embedding model,
  but it means the déjà vu feature will under-flag more than a
  transformer-based version would. If false negatives bother you more
  than install size, transformers.js with a small quantized model is the
  upgrade path.
- **Regex-based commitment/decision extraction has real false-positive
  and false-negative rates.** It's the same approach every rule-based
  action-item tool uses (and why LLM-based ones like Otter get better
  recall) — I picked it because you explicitly chose "no API key," not
  because it's the best available method. If you get an API key later,
  swapping the extraction step for an LLM call is a contained change:
  everything downstream (storage, primer, déjà vu) is extraction-method
  agnostic.
- **No cross-device sync, by design.** Local-only means your commitment
  history on your laptop isn't visible on your phone or a coworker's
  machine. That's the direct cost of the privacy claim — worth stating
  explicitly rather than letting it surface as a surprise complaint.
- **Not tested against a live call.** I built, syntax-checked, and
  logic-tested every module I could test outside a browser (the
  extraction/similarity/date logic all have passing checks — see below),
  but a MutationObserver-driven DOM scraper fundamentally needs a real
  call to validate. Treat this as a solid, thoroughly-reasoned first
  draft that needs one real testing pass before you trust it in a meeting
  that matters.

## What I actually tested (vs. what I could only reason about)

Verified by running in Node during the build:
- `hashing-vectorizer.js`: similar-topic sentences score meaningfully
  higher cosine similarity (~0.5-0.6) than unrelated ones (~0.0).
- `commitment-extractor.js`: correctly pulls owner/task/due-date out of
  first-person, named-assignment, and direct-ask phrasings.
- `decision-extractor.js`: correctly identifies decision sentences and
  ranks past-decision matches by similarity.
- All 15 JS files pass `node --check` (syntax-valid).
- `manifest.json` references zero missing files.

Not verified (needs a real browser + real call):
- Actual DOM selectors against live Meet/Zoom/Teams markup.
- The MutationObserver debounce timing against real caption update
  cadence.
- Extension packaging/review in the actual Chrome Web Store pipeline.
