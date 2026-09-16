/**
 * SPM 381 — Slide Questions & Comments
 * -------------------------------------
 * Backend for the "Question?" button embedded in the SPM381 lecture
 * decks (Week 3 and on). A student clicks it on any slide, types a
 * question or comment, and it becomes one row in this course's own
 * Google Sheet -- tagged with which deck and which slide it came from.
 * No email is sent; check the Sheet to read submissions.
 *
 * Also serves two more per-slide widgets that POST to this same endpoint:
 *  - Reaction pulse (green/yellow/red "how clear was this?") -> "Reactions" tab
 *  - Live polls (multiple-choice, embedded on specific slides) -> "PollVotes"
 *    tab, plus a doGet(?action=pollResults&pollId=...) that tallies live
 *    counts so the results bar chart can update while the poll is open.
 * See SPM381_26/questions/widgets.js for the frontend half of both.
 *
 * This is a SEPARATE, independent deployment from the SPM261 backend
 * (SPM261_26/questions/backend.gs). Each course has its own Apps
 * Script project, its own Sheet, and its own /exec URL.
 *
 * SETUP (one time)
 *  1. Create (or pick) a Google Sheet to hold SPM381 submissions.
 *     Copy its ID out of the URL: the long string between /d/ and /edit.
 *  2. script.google.com -> New project. Paste this file in. Save.
 *  3. Project Settings (gear) -> Script Properties -> add:
 *       SHEET_ID = <the Sheet ID from step 1>
 *  4. Deploy -> New deployment -> type "Web app"
 *       Execute as: Me
 *       Who has access: Anyone            <-- required so students (not signed in) can submit
 *     Deploy, authorize, copy the Web app URL (ends in /exec).
 *  5. Put that URL in SPM381_26/questions/config.js and push.
 *
 * UPDATING AN EXISTING DEPLOYMENT: paste the new code into the same
 * script project, Save, then Deploy -> Manage deployments -> pencil
 * icon on the active deployment -> Version: "New version" -> Deploy.
 * This keeps the same /exec URL, so config.js does NOT need to change.
 * Changing SHEET_ID only changes where FUTURE rows go -- it never
 * touches rows already sitting in any Sheet.
 *
 * No triggers, no cron. Every submission is a synchronous doPost that
 * appends one row. Open the Sheet any time to read the full history --
 * newest at the bottom, or add a filter/sort to read by deck or slide.
 */

var PROPS = PropertiesService.getScriptProperties();

function doGet(e){
  var action = e && e.parameter && e.parameter.action;
  if (action === 'pollResults') return json_(pollResults_(e.parameter));
  // Visiting the deployed URL directly in a browser should show this,
  // confirming the backend is live before you wire up the frontend.
  return json_({ ok: true, msg: 'SPM381 questions backend is live. POST a question to submit one.' });
}

function doPost(e){
  var body = {};
  try { body = JSON.parse(e.postData.contents); } catch (err) {}
  var type = body.type || 'question';
  if (type === 'reaction') return json_(handleReaction_(body));
  if (type === 'poll_vote') return json_(handlePollVote_(body));
  return json_(handle_(body));
}

function handle_(body){
  var lock = LockService.getScriptLock();
  try { lock.waitLock(9000); } catch (err) { return { ok: false, error: 'busy' }; }
  try {
    var text = String(body.question || '').trim().slice(0, 4000);
    if (!text) return { ok: false, error: 'empty_question' };

    var deck = String(body.deck || '').slice(0, 160);
    var slideIndex = body.slideIndex === '' || body.slideIndex == null ? '' : Number(body.slideIndex);
    var slideTitle = String(body.slideTitle || '').slice(0, 200);
    var name = String(body.name || 'Anonymous').trim().slice(0, 120) || 'Anonymous';

    appendRow_([new Date(), deck, slideIndex, slideTitle, text, name]);
    return { ok: true };
  } finally {
    lock.releaseLock();
  }
}

function appendRow_(row){
  var id = PROPS.getProperty('SHEET_ID');
  if (!id) throw new Error('Missing Script Property SHEET_ID');
  var ss = SpreadsheetApp.openById(id);
  var sh = ss.getSheetByName('Questions') || ss.insertSheet('Questions');
  if (sh.getLastRow() === 0) {
    sh.appendRow(['When', 'Deck', 'Slide #', 'Slide Title', 'Question / Comment', 'Name']);
    sh.setFrozenRows(1);
  }
  sh.appendRow(row);
}

/**
 * Reaction pulse: one click, no name/text, logs which of green/yellow/red
 * a student tapped on the current slide. Lower friction than a written
 * question, so it's a wider signal of "is the room following along."
 */
function handleReaction_(body){
  var lock = LockService.getScriptLock();
  try { lock.waitLock(9000); } catch (err) { return { ok: false, error: 'busy' }; }
  try {
    var reaction = String(body.reaction || '').slice(0, 20);
    if (['green', 'yellow', 'red'].indexOf(reaction) === -1) return { ok: false, error: 'bad_reaction' };

    var deck = String(body.deck || '').slice(0, 160);
    var slideIndex = body.slideIndex === '' || body.slideIndex == null ? '' : Number(body.slideIndex);
    var slideTitle = String(body.slideTitle || '').slice(0, 200);

    appendReactionRow_([new Date(), deck, slideIndex, slideTitle, reaction]);
    return { ok: true };
  } finally {
    lock.releaseLock();
  }
}

function appendReactionRow_(row){
  var id = PROPS.getProperty('SHEET_ID');
  if (!id) throw new Error('Missing Script Property SHEET_ID');
  var ss = SpreadsheetApp.openById(id);
  var sh = ss.getSheetByName('Reactions') || ss.insertSheet('Reactions');
  if (sh.getLastRow() === 0) {
    sh.appendRow(['When', 'Deck', 'Slide #', 'Slide Title', 'Reaction']);
    sh.setFrozenRows(1);
  }
  sh.appendRow(row);
}

/**
 * Live polls: a slide can carry a multiple-choice question (defined in the
 * deck's own window.SLIDE_POLLS, not here). A vote is one row; doGet's
 * pollResults_ tallies rows for that pollId into live counts so every
 * viewer on that slide sees the bar chart update as votes come in. Voting
 * twice from the same browser is blocked client-side (localStorage), not
 * server-side -- consistent with the rest of this system having no login.
 */
function handlePollVote_(body){
  var lock = LockService.getScriptLock();
  try { lock.waitLock(9000); } catch (err) { return { ok: false, error: 'busy' }; }
  try {
    var pollId = String(body.pollId || '').slice(0, 120);
    if (!pollId) return { ok: false, error: 'missing_poll' };
    var optionIndex = Number(body.optionIndex);
    if (!(optionIndex >= 0)) return { ok: false, error: 'bad_option' };

    var deck = String(body.deck || '').slice(0, 160);
    var slideIndex = body.slideIndex === '' || body.slideIndex == null ? '' : Number(body.slideIndex);
    var question = String(body.question || '').slice(0, 300);
    var optionText = String(body.optionText || '').slice(0, 200);

    appendPollRow_([new Date(), deck, slideIndex, pollId, question, optionIndex, optionText]);
    return { ok: true };
  } finally {
    lock.releaseLock();
  }
}

function appendPollRow_(row){
  var id = PROPS.getProperty('SHEET_ID');
  if (!id) throw new Error('Missing Script Property SHEET_ID');
  var ss = SpreadsheetApp.openById(id);
  var sh = ss.getSheetByName('PollVotes') || ss.insertSheet('PollVotes');
  if (sh.getLastRow() === 0) {
    sh.appendRow(['When', 'Deck', 'Slide #', 'Poll ID', 'Question', 'Option #', 'Option Text']);
    sh.setFrozenRows(1);
  }
  sh.appendRow(row);
}

/**
 * Tallies votes for one pollId into {"0": n, "1": n, ...} counts. Cached
 * for a few seconds so a whole class polling every ~3s during a live vote
 * doesn't hammer the Sheet with a full read on every request.
 */
function pollResults_(params){
  var pollId = String((params && params.pollId) || '').slice(0, 120);
  if (!pollId) return { ok: false, error: 'missing_poll' };

  var cache = CacheService.getScriptCache();
  var cacheKey = 'pollres_' + pollId;
  var hit = cache.get(cacheKey);
  if (hit) return JSON.parse(hit);

  var id = PROPS.getProperty('SHEET_ID');
  if (!id) return { ok: false, error: 'not_configured' };
  var ss = SpreadsheetApp.openById(id);
  var sh = ss.getSheetByName('PollVotes');
  var counts = {};
  var total = 0;
  if (sh && sh.getLastRow() > 1) {
    var data = sh.getRange(2, 1, sh.getLastRow() - 1, 7).getValues();
    for (var i = 0; i < data.length; i++) {
      if (String(data[i][3]) === pollId) {
        var opt = String(data[i][5]);
        counts[opt] = (counts[opt] || 0) + 1;
        total++;
      }
    }
  }
  var result = { ok: true, pollId: pollId, total: total, counts: counts };
  cache.put(cacheKey, JSON.stringify(result), 3);
  return result;
}

function json_(obj){
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
