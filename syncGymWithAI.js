

// Set these script properties in Apps Script UI:
// GEMINI_API_KEY: your Gemini API key
// GYM_CALENDAR_ID: your calendar ID
// GYM_LABEL_TO_PROCESS: Gmail label for gym emails (e.g. GymSync)
// GYM_LABEL_DONE: Gmail label for processed emails (e.g. Processed)

function syncGymWithAI() {
  const CALENDAR_ID = PropertiesService.getScriptProperties().getProperty('GYM_CALENDAR_ID');
  const apiKey = PropertiesService.getScriptProperties().getProperty('GEMINI_API_KEY');
  const labelToProcessName = PropertiesService.getScriptProperties().getProperty('GYM_LABEL_TO_PROCESS') || 'GymSync';
  const labelDoneName = PropertiesService.getScriptProperties().getProperty('GYM_LABEL_DONE') || 'Processed';
  const calendar = CalendarApp.getCalendarById(CALENDAR_ID);
  const labelToProcess = GmailApp.getUserLabelByName(labelToProcessName);
  const labelDone = GmailApp.getUserLabelByName(labelDoneName) || GmailApp.createLabel(labelDoneName);

  if (!labelToProcess) return;

  const threads = GmailApp.search('label:' + labelToProcess.getName() + ' -label:' + labelDone.getName());
  
  threads.forEach(thread => {
    // REVERSE the messages to process oldest emails first
    const messages = thread.getMessages().reverse(); 
    let threadFullyProcessed = true;

    messages.forEach(msg => {
      if (msg.isUnread()) {
        try {
          const body = msg.getPlainBody();
          console.log("--- START MESSAGE ---");
          const ai = askGemini(body, apiKey);

          if (!ai || ai.action === "ERROR" || !ai.action) throw new Error("Invalid AI Response");

          const cleanDateStr = ai.startTime ? ai.startTime.replace(/(\d+)\./, "$1") : null;
          const start = cleanDateStr ? new Date(cleanDateStr) : null;

          if (!start || isNaN(start.getTime())) {
            msg.markRead();
            return;
          }

          // FIX: Ensure 1 hour duration. Ignore AI endTime if it's broken or missing.
          const end = new Date(start.getTime() + 60 * 60 * 1000); 
          
          console.log(`ACTION: ${ai.action} | TIME: ${ai.startTime}`);

          // Always find and clear existing gym entries for this slot before taking action
          const existingEvents = calendar.getEvents(new Date(start.getTime() - 60000), new Date(start.getTime() + 60000));
          existingEvents.forEach(e => {
            if (e.getDescription().includes("SyncTag-Gym") || e.getTitle().includes("PT")) {
              e.deleteEvent();
              console.log("CLEANUP: Removed prior entry.");
            }
          });

          if (ai.action === "BOOK" || ai.action === "WAITLIST") {
            const title = ai.action === "WAITLIST" ? "⏳ WAITLIST: " + ai.className : "Gym: " + ai.className;
            calendar.createEvent(title, start, end, {description: "SyncTag-Gym"});
            console.log("CALENDAR: Created " + title);
          } 
          
          else if (ai.action === "CANCEL") {
            // Already wiped by the cleanup block above
            console.log("CALENDAR: Slot cleared via cancellation.");
          }

          msg.markRead();
        } catch (e) {
          threadFullyProcessed = false;
          console.error("Error: " + e.message);
        }
        Utilities.sleep(1000); 
      }
    });

    if (threadFullyProcessed) {
      thread.removeLabel(labelToProcess).addLabel(labelDone);
    }
  });
}

function askGemini(text, apiKey) {
  const model = "gemini-flash-latest"; 
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

  const prompt = `Task: Analyze gym booking. Current year is 2026.
  Return ONLY JSON: {"action":"BOOK"|"CANCEL"|"WAITLIST"|"IGNORE", "className":"Name", "startTime":"ISOString"}.
  
  Rules:
  1. "successfully registered", "confirmed", or "added... from waitlist" = "BOOK".
  2. "unregistered" or "removed from waitlist" = "CANCEL".
  3. "on the waitlist" = "WAITLIST".
  
  Email: ${text}`;

  const options = {
    method: "POST",
    contentType: "application/json",
    payload: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { responseMimeType: "application/json" }
    }),
    muteHttpExceptions: true
  };

  const response = UrlFetchApp.fetch(url, options);
  return JSON.parse(JSON.parse(response.getContentText()).candidates[0].content.parts[0].text.trim());
}