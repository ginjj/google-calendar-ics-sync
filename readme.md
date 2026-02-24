# Family Calendar ICS Sync

This project syncs ICS calendar feeds to Google Calendar using Google Apps Script, with robust deduplication and filtering.

## Features
- Syncs multiple ICS feeds to Google Calendar
- UID-based deduplication (no duplicate events)
- Configurable feed filters (e.g., only home games)
- Cleanup and export utilities

## Setup
1. Copy `config.example.gs` to `config.gs` and fill in your real feed info (never commit `config.gs`).
2. Deploy `familysync.js` and `config.gs` to your Google Apps Script project.
3. Use `cleanupOldSyncEvents.js` and `exportAllCalendarEventsToTxt.js` as needed.
4. See `TODO.md` for setup and usage tasks.

## Security
- `config.gs` is gitignored and should never be committed.

## License
MIT