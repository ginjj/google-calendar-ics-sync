
// Requires config.gs in the same Apps Script project:
//   var FAMILY_CAL_ID = 'your_calendar_id';
//   var FEEDS = [ ... ];

function masterFamilySync() {
  const familyCal = CalendarApp.getCalendarById(FAMILY_CAL_ID);

  FEEDS.forEach(feed => {
    try {
      const response = UrlFetchApp.fetch(feed.url);
      const icalData = response.getContentText();
      let feedEvents = parseIcsToData(icalData, feed);
      // Apply filter function if present
      if (typeof feed.filter === 'function') {
        feedEvents = feedEvents.filter(feed.filter);
      }

      // Query all events in the calendar and filter by tag
      const allEvents = familyCal.getEvents(new Date(2000, 0, 1), new Date(2100, 0, 1));
      // Map: UID -> array of events (to handle duplicates)
      const calendarMap = {};
      allEvents.forEach(e => {
        const desc = e.getDescription();
        if (desc && desc.includes("[UID:") && desc.includes("[" + feed.tag + "]")) {
          const match = desc.match(/\[UID:(.*?)\]/);
          if (match) {
            const uid = match[1];
            if (!calendarMap[uid]) calendarMap[uid] = [];
            calendarMap[uid].push(e);
          }
        }
      });

      // Deduplicate: For each UID, keep only one event (the first), delete the rest
      Object.keys(calendarMap).forEach(uid => {
        const events = calendarMap[uid];
        if (events.length > 1) {
          // Keep the first, delete the rest
          for (let i = 1; i < events.length; i++) {
            events[i].deleteEvent();
          }
          // Only keep the first in the map for update logic
          calendarMap[uid] = [events[0]];
        }
      });

      // Differential sync
      const processedUids = new Set();
      feedEvents.forEach(item => {
        if (!item.UID || !item.SUMMARY || !item.DTSTART) return;
        processedUids.add(item.UID);
        const existingArr = calendarMap[item.UID];
        const existing = existingArr && existingArr[0];
        const cleanDesc = (item.DESCRIPTION || "").replace(/\\n/g, '\n').replace(/\\,/g, ',').replace(/\\;/g, ';');
        const fullDescription = `${cleanDesc}\n\nSynced from ${feed.name}\n[${feed.tag}] [UID:${item.UID}]`;
        const location = item.LOCATION ? item.LOCATION.replace(/\\,/g, ',') : "TBC";
        const title = (feed.prefix || "") + item.SUMMARY;
        const isAllDay = item.ALLDAY;
        const end = item.DTEND || (item.DTSTART ? new Date(item.DTSTART.getTime() + 2 * 60 * 60 * 1000) : null);

        if (!existing) {
          if (isAllDay) {
            familyCal.createAllDayEvent(title, item.DTSTART, {location, description: fullDescription});
          } else {
            familyCal.createEvent(title, item.DTSTART, end, {location, description: fullDescription});
          }
        } else {
          // Check if update needed
          const hasChanged = Math.abs(existing.getStartTime().getTime() - item.DTSTART.getTime()) > 1000 ||
                             existing.getTitle() !== title ||
                             existing.getDescription() !== fullDescription;
          if (hasChanged) {
            if (isAllDay) {
              existing.deleteEvent();
              familyCal.createAllDayEvent(title, item.DTSTART, {location, description: fullDescription});
            } else {
              existing.setTitle(title);
              existing.setTime(item.DTSTART, end);
              existing.setDescription(fullDescription);
              existing.setLocation(location);
            }
          }
        }
      });

      // Delete events no longer in feed
      Object.keys(calendarMap).forEach(uid => {
        if (!processedUids.has(uid)) {
          const existingArr = calendarMap[uid];
          if (existingArr && existingArr[0]) existingArr[0].deleteEvent();
        }
      });
    } catch (err) {
      console.error("Fail: " + feed.name + " - " + err.message);
    }
  });
}


// Robust ICS parser: returns array of {UID, SUMMARY, DTSTART, DTEND, DESCRIPTION, LOCATION, ALLDAY}
function parseIcsToData(icsString, feed) {
  const events = [];
  const unfolded = icsString.replace(/\r?\n /g, "");
  const blocks = unfolded.split("BEGIN:VEVENT");
  blocks.shift();
  blocks.forEach(block => {
    const item = {};
    const lines = block.split(/\r?\n/);
    lines.forEach(line => {
      const splitIdx = line.indexOf(":");
      if (splitIdx === -1) return;
      const keyPart = line.substring(0, splitIdx);
      const value = line.substring(splitIdx + 1);
      const key = keyPart.split(";")[0];
      item[key] = value;
      if (keyPart.includes("TZID=")) {
        item[key + "_TZID"] = keyPart.match(/TZID=(.*)/)[1];
      }
      if (keyPart.includes("VALUE=DATE")) {
        item.ALLDAY = true;
      }
    });
    if (item.UID && item.SUMMARY && item.DTSTART) {
      item.DTSTART = processIcsDate(item.DTSTART, item.DTSTART_TZID);
      item.DTEND = processIcsDate(item.DTEND, item.DTEND_TZID) || (item.DTSTART ? new Date(item.DTSTART.getTime() + 2 * 60 * 60 * 1000) : null);
      events.push(item);
    }
  });
  return events;
}

// Time zone aware ICS date parser
function processIcsDate(dateStr, tzid) {
  if (!dateStr) return null;
  const y = dateStr.substring(0,4), m = dateStr.substring(4,6)-1, d = dateStr.substring(6,8);
  const h = dateStr.length >= 11 ? dateStr.substring(9,11) : 0;
  const min = dateStr.length >= 13 ? dateStr.substring(11,13) : 0;
  const s = dateStr.length >= 15 ? dateStr.substring(13,15) : 0;
  if (dateStr.endsWith("Z")) {
    return new Date(Date.UTC(y, m, d, h, min, s));
  }
  if (tzid) {
    return new Date(y, m, d, h, min, s);
  }
  return new Date(y, m, d, h, min, s);
}