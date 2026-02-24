// config.gs (DO NOT COMMIT REAL SECRETS)
// Example config for familysync.js
// Copy this file to config.gs and fill in your real values. Add config.gs to .gitignore!

var FEEDS = [
  {
    name: 'Example Feed',
    url: 'https://example.com/calendar.ics',
    tag: 'EX',
    prefix: '[EX] ',
    filter: function(event) {
      // Example: Only include events with 'Home' in the summary
      return event.summary && event.summary.indexOf('Home') !== -1;
    }
  }
  // Add more feeds as needed
];
