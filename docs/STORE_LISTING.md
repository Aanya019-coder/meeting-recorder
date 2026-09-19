# Chrome Web Store listing — ready to paste

## Extension name
Precedent — Meetings That Remember

## Short description (132 char max)
Flags when a meeting re-decides something you already settled, and surfaces open promises before you start. 100% on-device.

## Detailed description

Every recurring team has had this meeting: twenty minutes spent
re-debating a decision you already made three weeks ago, because nobody
remembered — or found — the earlier conversation.

Precedent watches your live captions (never your audio) on Google Meet,
Zoom, and Microsoft Teams, and does two things other meeting tools don't:

**Catches déjà vu.** When the conversation starts circling a topic your
past meetings with these same people already settled, Precedent flags it
live: "You may have already decided this — March 3rd, [meeting]." You
decide whether to move on or genuinely revisit it.

**Remembers what people promised.** Before your meeting even starts,
Precedent shows you which open "I'll send that by Friday" commitments
exist between today's attendees — pulled from your own past meetings, not
a task board someone has to remember to update.

**Runs entirely on your device.** No bot joins your call. No audio is
ever accessed — only the caption text you already chose to turn on. No
server, no account, no sync. Everything is stored locally in your
browser and you can export or permanently delete it at any time from the
Options page.

Why local-only, and why caption-based instead of a meeting bot? Because
the alternative — a bot joining your call and uploading audio to a
cloud — is the thing most people are quietly uneasy about in every
AI-notetaker tool on the market. Precedent trades some convenience
(captions have to be turned on; there's no cross-device sync) for a
privacy story you can actually verify by reading the code.

Supported today: Google Meet, Zoom (web client), Microsoft Teams (web).

## Category
Productivity

## Permission justifications (for the review form)
- **storage**: saves your settings and meeting data locally via
  chrome.storage and IndexedDB.
- **alarms**: schedules a daily local cleanup of data past your chosen
  retention window.
- **scripting / host_permissions (meet.google.com, zoom.us,
  teams.microsoft.com, teams.live.com)**: reads on-screen live captions
  and renders the in-meeting panel on these three meeting platforms only.
- **downloads**: lets you export your stored data as a JSON file when you
  click "Export."

## Screenshots to capture before submitting
1. The in-meeting overlay pill + expanded "Before you start" primer panel
   on a real Meet call.
2. A déjà vu toast mid-call.
3. The end-of-meeting "Save to this device" summary.
4. The popup showing open commitments.
5. The Options page.
