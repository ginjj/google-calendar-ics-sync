
// Requires config.gs in the same Apps Script project:
//   var FAMILY_CAL_ID = 'your_calendar_id';
//   var FEEDS = [ ... ];

function masterFamilySync() {
  const familyCal = CalendarApp.getCalendarById(FAMILY_CAL_ID);
  // Track slow feeds in script properties
  const props = PropertiesService.getScriptProperties();
  let slowFeeds = {};
  try {
    slowFeeds = JSON.parse(props.getProperty('SLOW_FEEDS') || '{}');
  } catch (e) {}

  // Single calendar scan shared across all feeds — split by tag per feed
  const allCalendarEvents = familyCal.getEvents(new Date(2000, 0, 1), new Date(2100, 0, 1));

  FEEDS.forEach(feed => {
    const feedStart = Date.now();
    try {
      let response, fetchError = null;
      try {
        response = UrlFetchApp.fetch(feed.url, {
          muteHttpExceptions: true,
          followRedirects: true,
          validateHttpsCertificates: false
        });
      } catch (e) {
        fetchError = e;
      }
      const fetchTime = (Date.now() - feedStart) / 1000;
      if (fetchError || !response || response.getResponseCode() !== 200) {
        console.error(`Feed ${feed.name} failed: ${fetchError ? fetchError : 'HTTP ' + (response ? response.getResponseCode() : 'NO RESPONSE')} (${fetchTime}s)`);
        // Count any failure (slow or fast) toward the repeated-failure threshold
        slowFeeds[feed.url] = (slowFeeds[feed.url] || 0) + 1;
        return;
      }
      if (fetchTime > 25) {
        slowFeeds[feed.url] = (slowFeeds[feed.url] || 0) + 1;
        console.info(`Feed ${feed.name} was slow: ${fetchTime}s`);
        // Skip calendar operations this run to avoid overall timeout
        return;
      }
      // Feed responded successfully and promptly — reset failure count
      slowFeeds[feed.url] = 0;
      const icalData = response.getContentText();
      let feedEvents = parseIcsToData(icalData, feed);
      // Apply filter function if present
      if (typeof feed.filter === 'function') {
        feedEvents = feedEvents.filter(feed.filter);
      }

      // Build calendarMap for this feed from the shared calendar scan
      const calendarMap = {};
      allCalendarEvents.forEach(e => {
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
          // New event — create and apply colour
          let newEvent;
          if (isAllDay) {
            newEvent = familyCal.createAllDayEvent(title, item.DTSTART, item.DTEND, {location, description: fullDescription});
          } else {
            newEvent = familyCal.createEvent(title, item.DTSTART, end, {location, description: fullDescription});
          }
          if (feed.color) newEvent.setColor(feed.color);
        } else {
          // Existing event — only update if core feed data has changed
          // Does NOT touch colour or any other user-customised fields
          const hasChanged = Math.abs(existing.getStartTime().getTime() - item.DTSTART.getTime()) > 1000 ||
                             Math.abs(existing.getEndTime().getTime() - item.DTEND.getTime()) > 1000 ||
                             existing.getTitle() !== title ||
                             existing.getDescription() !== fullDescription;
          if (hasChanged) {
            if (isAllDay) {
              existing.deleteEvent();
              const newEvent = familyCal.createAllDayEvent(title, item.DTSTART, item.DTEND, {location, description: fullDescription});
              if (feed.color) newEvent.setColor(feed.color);
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
  // Save slow feed counts
  props.setProperty('SLOW_FEEDS', JSON.stringify(slowFeeds));
  // Collect all feeds that have been slow 3+ times in a row
  const failingFeeds = Object.keys(slowFeeds)
    .filter(url => slowFeeds[url] >= 3)
    .map(url => `Feed: ${url}\nSlow count: ${slowFeeds[url]}`);
  if (failingFeeds.length > 0) {
    throw new Error('FAILED - Script was unable to access the following feed(s) 3 times in a row:\n' + failingFeeds.join('\n\n'));
  }
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
      // Mark all-day if either DTSTART or DTEND has VALUE=DATE, or value is 8 chars (YYYYMMDD)
      if (keyPart.includes("VALUE=DATE") || ((key === "DTSTART" || key === "DTEND") && /^\d{8}$/.test(value))) {
        item.ALLDAY = true;
      }
    });
    if (item.UID && item.SUMMARY && item.DTSTART) {
      const isAllDay = item.ALLDAY;
      item.DTSTART = processIcsDate(item.DTSTART, item.DTSTART_TZID, isAllDay);
      item.DTEND = item.DTEND
        ? processIcsDate(item.DTEND, item.DTEND_TZID, isAllDay)
        : new Date(item.DTSTART.getTime() + (isAllDay ? 86400000 : 7200000));
      events.push(item);
    }
  });
  return events;
}

// Time zone aware ICS date parser
function processIcsDate(dateStr, tzid, isAllDay) {
  if (!dateStr) return null;
  const y = dateStr.substring(0,4), m = dateStr.substring(4,6)-1, d = dateStr.substring(6,8);
  if (isAllDay || dateStr.length === 8) {
    // All-day: return midnight local time
    return new Date(y, m, d);
  }
  const h = dateStr.length >= 11 ? dateStr.substring(9,11) : 0;
  const min = dateStr.length >= 13 ? dateStr.substring(11,13) : 0;
  const s = dateStr.length >= 15 ? dateStr.substring(13,15) : 0;
  if (dateStr.endsWith("Z")) {
    return new Date(Date.UTC(y, m, d, h, min, s));
  }
  return new Date(y, m, d, h, min, s);
}