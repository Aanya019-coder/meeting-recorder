# Privacy Policy — Precedent

**Last updated:** September 2026

## Summary

Precedent does not collect, transmit, sell, or share any data. Everything
it processes stays on your device, inside your Chrome profile's local
storage. There is no server, no account, no analytics, and no third-party
SDK in this extension.

## What Precedent accesses

- **Live captions text** on Google Meet, Zoom (web client), and Microsoft
  Teams (web) pages, only while you are on a call on one of those sites,
  and only if you have live captions turned on. Precedent does not access
  microphone or camera input, and does not access audio or video in any
  form.
- **Participant names** as rendered in the meeting's UI (e.g. the
  participants panel), used to match commitments and decisions to the
  people who were in the room.
- **The meeting page's title**, used to label saved meetings.

## What Precedent stores, and where

Transcribed caption lines are processed in memory to detect commitments
and decisions. Only the *extracted results* — a commitment ("Aanya will
send the deck", due date, source sentence), a decision summary, and a
compact numeric vector used for similarity comparison — are saved, and
only after you explicitly confirm at the end of a call via the "Save to
this device" button in the in-meeting panel. All of this is stored in
your browser's IndexedDB, scoped to the extension, on your device only.

Nothing is uploaded. Nothing is sent to Precedent's developer or to any
third party. There is no backend server for this extension to talk to.

## Your controls

- **Export**: the Options page and popup both offer "Export as JSON",
  which downloads everything Precedent has stored, as a local file you
  control.
- **Delete**: the Options page has a "Delete all data" button that
  permanently erases everything, immediately, on this device.
- **Retention**: you can set an automatic retention window (30/90/180
  days, 1 year, or forever) for resolved commitments and past decisions.
  Open (unresolved) commitments are kept regardless of age until you
  resolve or delete them.
- **Per-platform toggles**: you can disable Precedent on any of the three
  supported platforms individually from the Options page.

## Uninstalling

Uninstalling the extension deletes its IndexedDB storage as part of
Chrome's standard extension removal — this follows Chrome's normal
behavior for extension-scoped storage, not any special deletion logic in
Precedent.

## Changes to this policy

If this policy changes, the "Last updated" date above will change and the
new version will be included in the next extension update.

## Contact

[Add your contact email here before publishing — required by the Chrome
Web Store developer program policies.]
