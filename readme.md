# Google Calendar Automations (Google Apps Script)

Two Google Apps Script automations for managing a shared Google Calendar.

---

## Script 1: ICS Feed Sync (`familysync.js`)

Syncs one or more external ICS calendar feeds into a shared Google Calendar.

### Features
- Config-driven: add any number of ICS feeds in `config.gs`
- UID-based differential sync — no duplicates, no unnecessary updates
- Per-feed filter functions (e.g. only home football games)
- Cleans up events removed from the feed

### Setup
1. Copy `config.example.gs` to `config.gs` and fill in your feeds and calendar ID (never commit `config.gs`).
2. Deploy `familysync.js` and `config.gs` to your Google Apps Script project.
3. Set a time-based trigger on `masterFamilySync()` to run on a schedule.

---

## Script 2: Gym Email Sync (`syncGymWithAI.js`)

Reads gym booking confirmation/cancellation emails via Gmail and creates or removes calendar events automatically using the Gemini AI API to parse the email content.

### Features
- Monitors a Gmail label for gym booking emails
- Uses Gemini AI to extract action (book/cancel/waitlist), class name, and time
- Creates, updates, or removes calendar events accordingly
- Marks processed emails with a "done" label to avoid reprocessing

### Setup
Set the following in Apps Script **Script Properties** (Project Settings → Script Properties):

| Property | Description |
|---|---|
| `GEMINI_API_KEY` | Your Gemini API key |
| `GYM_CALENDAR_ID` | Target Google Calendar ID |
| `GYM_LABEL_TO_PROCESS` | Gmail label to watch (default: `GymSync`) |
| `GYM_LABEL_DONE` | Gmail label for processed emails (default: `Processed`) |

Set a time-based trigger on `syncGymWithAI()` to run periodically.

---

## Security
- `config.gs` is gitignored and should never be committed. See `config.example.gs` for the required structure.
- All sensitive values for the gym sync are stored in Apps Script Script Properties, not in code.

## License
MIT