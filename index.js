'use strict';

const fs = require('fs');

const calendar = require('./lib/calendar');
const dates = require('./lib/dates');

const cfpTwitter = require('./lib/cfp-twitter.js');
const cfpTelegram = require('./lib/cfp-telegram.js');

const CONFIG = require('./config.json');

const STATE = {};

try {
  STATE.Q = require('./data/queue.json');
} catch(e) { STATE.Q = {} };
Object.defineProperty(STATE.Q, 'sync', { value: function() {
  fs.writeFileSync('./data/queue.json', JSON.stringify(STATE.Q,null,1));
}});

try {
  STATE.LD = require('./data/lastdate.json')
} catch(e) { STATE.LD = { value: dates.getUTCDate('yesterday') } };
Object.defineProperty(STATE.LD, 'reset', { value: function() {
  STATE.LD.value = dates.getUTCDate('today');
  fs.writeFileSync('./data/lastdate.json', JSON.stringify(STATE.LD));

  console.log('Last date updated: ', STATE.LD.value);
}});

// Mainloop loops every 60 seconds
setInterval(mainLoop, CONFIG.DEBUG ? 6000 : 60000);

mainLoop();



function mainLoop() {
  // Current date
  let d = dates.getUTCDate();
  let ts = new Date().getTime();

  // Datechange event
  if (d > STATE.LD.value) {
    // Preview next day's content on dev channels
    if (CONFIG.PREVIEWS) {
      loadQueue({ shiftDate: 1, preview: true });
    }

    // Today's events
    loadQueue();

    // Increment state day reference
    STATE.LD.reset();
  }

  // Send
  if (STATE.Q[d]) STATE.Q[d].filter(e => !e.sent && e.ts<ts).forEach(e => {
    let test;

    switch (e.t) {
      case 'twitter':
        if (CONFIG.PREVIEWS && e.channel==='PREVIEW') test=e.channel;
        sendTweet(e.msg, test);
        break;
      case 'telegram':
        if (CONFIG.PREVIEWS && e.channel==='PREVIEW') test=e.channel;
        sendTelegram(e.msg, test);
        break;
    }

    e.sent = true;
    STATE.Q.sync();
  })
}


function loadQueue(options) {
  let { shiftDate, preview } = options||{};

  calendar.updateCfpData().then(_ => {
  //Promise.resolve().then(_ => {

    // Optionally modify the NOW date
    let shiftedDate;
    if (shiftDate) {
      shiftedDate = new Date().getTime()+24*60*60*1000*shiftDate;

      console.log('Using this date:', new Date(shiftedDate).toUTCString());
    }

    // List upcoming CFPs
    let events = calendar.listUpcomingCfps(shiftedDate);
    let {
      upcoming,
      today, tomorrow, thisweek, highlights,
      feed
    } = events;


    // Weekly feed (every Monday morning)
    let isWeeklyFeed = (events.dayOfWeek === 1);

    console.log('Day of week: ', events.dayOfWeek, '/', calendar.weekday(events.dayOfWeek-1));

    // No CFP due dates upcoming
    if (!today.length && !tomorrow.length) {
      if (isWeeklyFeed) {
        // no weekly events either
        if (!thisweek.length) {
          console.log('No upcoming CFPs this week.');
          return;
        }
      } else {
        console.log('No upcoming CFPs.');
        return;
      }
    }

    console.log('Upcoming CFP dates:');
    console.log('Today:', today.length, 'Tomorrow:',tomorrow.length,'Highlights:', highlights.length);


    // Empty feed
    if (!feed.length) {
      console.log('No events.');

    } else {
      // Twitter
      if (CONFIG.TWITTER) {
        let msgs = [];

        // Weekly tweet
        if (isWeeklyFeed) {
          msgs.push( cfpTwitter.makeWeeklyTweet(feed) );
        }

        // Tweet daily for today's cfp deadlines
        msgs = msgs.concat( cfpTwitter.makeTodaysTweets(events) );

        msgs.forEach(msg => console.log(msg, [msg.length]));

        enqueue('twitter', msgs, options);
      }

      // Telegram
      if (CONFIG.TELEGRAM) {
        let msg = cfpTelegram.makeMessage(events);

        console.log(msg);

        enqueue('telegram', msg, options);
      }
    }

  }).catch(e => console.log(e.stack||e));
}


function enqueue(type, msgs, options) {
  let key = dates.getUTCDate();
  let { preview } = options||{};

  let q = STATE.Q[key];
  if (!q) {
    STATE.Q[key] = q = [];
  }

  let ts;
  switch (type) {
    case 'twitter':
      ts = dates.dateTimeUTC(undefined, undefined, undefined, undefined, CONFIG.TWITTER.SEND_HOUR, CONFIG.TWITTER.SEND_MINS);

      msgs.forEach(msg => {
        let message = {
          t: type,
          msg: msg,
          ts: ts
        };

        if (preview) {
          message.ts = dates.dateTimeUTC();
          message.msg = '🔜'+message.msg;
          message.channel = 'PREVIEW';
        }

        q.push(message);
        console.log('Added to queue: ', message);

        ts += CONFIG.TWITTER.SEND_INTERVAL;
      });

      break;

    case 'telegram':
      let message = {
        t: type,
        msg: msgs,
        ts: dates.dateTimeUTC(undefined, undefined, undefined, undefined, CONFIG.TELEGRAM.SEND_HOUR, CONFIG.TELEGRAM.SEND_MINS)
      };

      if (preview) {
        message.ts = dates.dateTimeUTC();
        message.msg = '🔜'+message.msg;
        message.channel = 'PREVIEW';
      }

      q.push(message);
      console.log('Added to queue: ', message);

      break;
  }

  console.log('Queue updated.');
  STATE.Q.sync();
}

function sendTweet(msg, test) {
  if (typeof test === 'undefined') test = CONFIG.DEBUG;

  if (test) {
    // Send to preview channel
    if (test === 'PREVIEW' && CONFIG.TWITTER.PREVIEW) {
      cfpTwitter.tweet(msg, test).then(e => console.log('Tweet preview sent.'));
      return;
    }

    // Just a console test
    console.log('TWEET TEST:', [test], msg);
    return;
  }

  cfpTwitter.tweet(msg).then(e => console.log('Tweeted.'));
}

function sendTelegram(msg, test) {
  if (typeof test === 'undefined') test = CONFIG.DEBUG;

  if (test) {
    // Send to preview channel
    if (test === 'PREVIEW' && CONFIG.TELEGRAM.PREVIEW) {
      cfpTelegram.message(msg, test).then(e => console.log('Telegram preview sent.'));
      return;
    }

    // Just a console test
    console.log('TELEGRAM TEST:', [test], msg);
    return;
  }

  cfpTelegram.message(msg).then(e => console.log('Message sent.'))
}
