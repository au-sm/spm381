/**
 * SPM 381 — Reaction Pulse + Live Poll widget
 * ---------------------------------------------
 * Drop this single tag near the end of <body>, in any deck:
 *   <script src="../questions/widgets.js"></script>
 * (config.js must load before it, so window.QUESTIONS_API is set.)
 *
 * Finds the current slide purely from the DOM -- the slide among
 * #deck's ".slide" children that carries the ".active" class -- so it
 * works on every deck regardless of how that deck's own JS tracks its
 * slide index internally. No dependency on any deck-internal variable.
 *
 * REACTION PULSE
 * A small always-on green/yellow/red bar, top-left (mirrors the "Ask a
 * question" button's top-right position; measures that button's height
 * at runtime so the two never overlap, whether or not a given deck has
 * the ask button). One tap logs a reaction for the current slide to the
 * "Reactions" tab of this course's Sheet. No name, no typing required.
 *
 * LIVE POLLS
 * Define per-slide multiple-choice questions in a small <script> BEFORE
 * this one, e.g.:
 *   <script>
 *   window.SLIDE_POLLS = {
 *     4: { id: 'w1-1-poll1', question: 'Which of these is a KPI?',
 *          options: ['Revenue growth', 'Weather', 'Mascot name'] }
 *   };
 *   </script>
 * The key is the slide's position in on-screen order, 0-based (so the
 * 5th slide a viewer sees is key 4). When a student reaches that slide,
 * a poll card appears; after voting (or immediately, if this browser
 * already voted on this pollId), a live results bar shows and refreshes
 * every 3s while the card is open. One vote per pollId per browser,
 * tracked in localStorage -- not enforced server-side, consistent with
 * the rest of this system having no student accounts.
 * Leave window.SLIDE_POLLS = {} (or omit it) for decks with no polls yet
 * -- the reaction pulse still works completely on its own.
 */
(function(){
  var deckEl = document.getElementById('deck');
  if (!deckEl) return;

  function escapeHtml(s){
    return String(s).replace(/[&<>"']/g, function(c){
      return { '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c];
    });
  }

  // ---------- inject styles ----------
  var style = document.createElement('style');
  style.textContent =
    '.pulse-wrap{position:fixed;left:50%;transform:translateX(-50%);top:54px;z-index:21;display:flex;align-items:center;gap:6px;pointer-events:none;}' +
    '.pulse-label{pointer-events:none;font:600 10.5px/1 system-ui,-apple-system,sans-serif;letter-spacing:.08em;text-transform:uppercase;color:rgba(255,255,255,.5);margin-right:2px;user-select:none;}' +
    '.pulse-btn{pointer-events:auto;width:30px;height:30px;border-radius:50%;border:1px solid rgba(255,255,255,.22);background:rgba(12,13,18,.6);backdrop-filter:blur(6px);-webkit-backdrop-filter:blur(6px);font-size:15px;line-height:1;display:flex;align-items:center;justify-content:center;cursor:pointer;transition:transform .15s ease,border-color .15s ease,opacity .3s ease;}' +
    '.pulse-btn:hover{transform:translateY(-2px);border-color:rgba(255,255,255,.45);}' +
    '.pulse-btn:active{transform:translateY(0);}' +
    '.pulse-btn.locked{opacity:.3;cursor:not-allowed;}' +
    '.pulse-btn.locked.sent{opacity:1;cursor:default;box-shadow:0 0 0 2px rgba(255,255,255,.6);}' +
    '.pulse-status{pointer-events:none;font:11px system-ui,-apple-system,sans-serif;color:rgba(255,255,255,.6);margin-left:2px;white-space:nowrap;}' +
    '.poll-card{position:fixed;left:50%;bottom:98px;transform:translateX(-50%);z-index:22;width:min(420px,88vw);background:rgba(13,14,19,.85);backdrop-filter:blur(10px);-webkit-backdrop-filter:blur(10px);border:1px solid rgba(255,255,255,.14);border-radius:16px;padding:14px 16px 16px;box-shadow:0 12px 32px rgba(0,0,0,.4);color:#f2f3f5;font:14px/1.4 system-ui,-apple-system,sans-serif;}' +
    '.poll-card.collapsed .poll-q,.poll-card.collapsed .poll-options,.poll-card.collapsed .poll-results,.poll-card.collapsed .poll-status{display:none;}' +
    '.poll-head{display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;}' +
    '.poll-badge{font:700 10px/1 system-ui,sans-serif;letter-spacing:.1em;text-transform:uppercase;color:#5eead4;border:1px solid rgba(94,234,212,.4);border-radius:999px;padding:3px 9px;}' +
    '.poll-collapse{background:none;border:1px solid rgba(255,255,255,.2);border-radius:50%;width:22px;height:22px;color:#f2f3f5;cursor:pointer;line-height:1;font-size:14px;padding:0;}' +
    '.poll-q{font-weight:600;margin-bottom:10px;text-wrap:balance;}' +
    '.poll-options{display:flex;flex-direction:column;gap:7px;}' +
    '.poll-opt{text-align:left;background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.16);color:#f2f3f5;border-radius:10px;padding:9px 12px;cursor:pointer;font:14px/1.3 inherit;transition:background .15s ease,border-color .15s ease;}' +
    '.poll-opt:hover{background:rgba(94,234,212,.14);border-color:rgba(94,234,212,.5);}' +
    '.poll-opt:disabled{opacity:.5;cursor:default;}' +
    '.poll-status{margin-top:8px;font-size:12px;color:rgba(255,255,255,.6);min-height:14px;}' +
    '.poll-results{display:flex;flex-direction:column;gap:8px;}' +
    '.poll-result-row{display:grid;grid-template-columns:1fr 3fr auto;align-items:center;gap:8px;font-size:12.5px;}' +
    '.poll-result-label{color:rgba(255,255,255,.8);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}' +
    '.poll-bar-track{height:8px;border-radius:5px;background:rgba(255,255,255,.1);overflow:hidden;}' +
    '.poll-bar-fill{height:100%;width:0%;background:linear-gradient(90deg,#5eead4,#38bdf8);border-radius:5px;transition:width .5s ease;}' +
    '.poll-result-pct{color:rgba(255,255,255,.65);font-variant-numeric:tabular-nums;min-width:32px;text-align:right;}' +
    '.poll-total{margin-top:4px;font-size:11px;color:rgba(255,255,255,.45);text-align:right;}' +
    '@media (prefers-reduced-motion: reduce){.pulse-btn,.poll-bar-fill{transition:none;}}';
  document.head.appendChild(style);

  // ---------- active-slide detection (DOM order, no deck-internal state) ----------
  function getAllSlides(){
    return Array.prototype.slice.call(deckEl.querySelectorAll('.slide'));
  }
  function getActive(){
    var all = getAllSlides();
    for (var i = 0; i < all.length; i++){
      if (all[i].classList.contains('active')) return { el: all[i], index: i, total: all.length };
    }
    return null;
  }
  function slideInfo(){
    var active = getActive();
    if (!active) return { index: -1, title: '' };
    var title = active.el.getAttribute('aria-label') || '';
    if (!title){
      var h = active.el.querySelector('h1,h2,.disp,.title-hero');
      if (h) title = h.textContent.trim();
    }
    return { index: active.index, title: title.slice(0, 200) };
  }
  function deckLabel(){
    return window.DECK_LABEL || document.title || '';
  }

  // ---------- reaction pulse ----------
  var reactionWrap = document.createElement('div');
  reactionWrap.className = 'pulse-wrap';
  reactionWrap.innerHTML =
    '<span class="pulse-label">Clear?</span>' +
    '<button class="pulse-btn" data-reaction="green" title="Clear" aria-label="This is clear">🟢</button>' +
    '<button class="pulse-btn" data-reaction="yellow" title="A little fuzzy" aria-label="A little fuzzy">🟡</button>' +
    '<button class="pulse-btn" data-reaction="red" title="Lost" aria-label="I am lost">🔴</button>' +
    '<span class="pulse-status"></span>';
  document.body.appendChild(reactionWrap);
  var pulseStatus = reactionWrap.querySelector('.pulse-status');

  function flashPulseStatus(msg){
    pulseStatus.textContent = msg;
    clearTimeout(flashPulseStatus._t);
    flashPulseStatus._t = setTimeout(function(){ pulseStatus.textContent = ''; }, 2200);
  }

  // one reaction per browser, ever -- once tapped, all three lock permanently
  // (persisted so it stays locked across reloads, same idea as poll voting).
  var pulseLockKey = 'spm381_pulse_reacted';
  function lockPulseButtons(chosen){
    reactionWrap.querySelectorAll('.pulse-btn').forEach(function(b){
      b.disabled = true;
      b.classList.add('locked');
      if (b.dataset.reaction === chosen) b.classList.add('sent');
    });
  }
  var alreadyReacted = null;
  try { alreadyReacted = localStorage.getItem(pulseLockKey); } catch (e) {}
  if (alreadyReacted) lockPulseButtons(alreadyReacted);

  reactionWrap.querySelectorAll('.pulse-btn').forEach(function(btn){
    btn.addEventListener('click', function(){
      if (btn.disabled) return;
      var reaction = btn.dataset.reaction;
      var info = slideInfo();
      if (!window.QUESTIONS_API){
        flashPulseStatus("Not connected yet");
        return;
      }
      fetch(window.QUESTIONS_API, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify({
          type: 'reaction', reaction: reaction,
          deck: deckLabel(), slideIndex: info.index + 1, slideTitle: info.title
        })
      }).catch(function(){ flashPulseStatus("Couldn't send"); });
      try { localStorage.setItem(pulseLockKey, reaction); } catch (e) {}
      lockPulseButtons(reaction);
    });
  });

  function alignPulseBar(){
    var askBtn = document.getElementById('askBtn');
    var top = 54;
    if (askBtn){
      top = Math.max(10, askBtn.getBoundingClientRect().top);
    } else {
      var chromeTop = document.querySelector('.chrome-top');
      if (chromeTop) top = chromeTop.getBoundingClientRect().bottom + 12;
    }
    reactionWrap.style.top = top + 'px';
  }
  window.addEventListener('resize', alignPulseBar);

  // ---------- live polls ----------
  var pollCard = document.createElement('div');
  pollCard.className = 'poll-card';
  pollCard.hidden = true;
  document.body.appendChild(pollCard);

  var activePollTimer = null;
  var currentPoll = null;

  function votedKey(pollId){ return 'spm381_poll_voted_' + pollId; }

  function alignPollCard(){
    var chromeBottom = document.querySelector('.chrome-bottom');
    var bottom = 98;
    if (chromeBottom){
      bottom = (window.innerHeight - chromeBottom.getBoundingClientRect().top) + 14;
    }
    pollCard.style.bottom = bottom + 'px';
  }
  window.addEventListener('resize', alignPollCard);

  function renderPollCard(pollDef, slideIdx, votedOption){
    var html = '<div class="poll-head"><span class="poll-badge">Poll</span>' +
      '<button class="poll-collapse" type="button" aria-label="Minimize poll">−</button></div>' +
      '<div class="poll-q">' + escapeHtml(pollDef.question) + '</div>';
    if (votedOption === null){
      html += '<div class="poll-options">';
      pollDef.options.forEach(function(opt, i){
        html += '<button class="poll-opt" type="button" data-i="' + i + '">' + escapeHtml(opt) + '</button>';
      });
      html += '</div><div class="poll-status"></div>';
    } else {
      html += '<div class="poll-results"></div>';
    }
    pollCard.innerHTML = html;

    var collapseBtn = pollCard.querySelector('.poll-collapse');
    collapseBtn.addEventListener('click', function(){
      pollCard.classList.toggle('collapsed');
      collapseBtn.textContent = pollCard.classList.contains('collapsed') ? '+' : '−';
    });

    if (votedOption === null){
      pollCard.querySelectorAll('.poll-opt').forEach(function(btn){
        btn.addEventListener('click', function(){
          submitVote(pollDef, slideIdx, parseInt(btn.dataset.i, 10));
        });
      });
    } else {
      renderResults(pollDef);
    }
  }

  function submitVote(pollDef, slideIdx, optionIndex){
    var statusEl = pollCard.querySelector('.poll-status');
    if (!window.QUESTIONS_API){
      if (statusEl) statusEl.textContent = "This form isn't connected yet — let your professor know.";
      return;
    }
    pollCard.querySelectorAll('.poll-opt').forEach(function(b){ b.disabled = true; });
    if (statusEl) statusEl.textContent = 'Sending…';
    fetch(window.QUESTIONS_API, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({
        type: 'poll_vote', pollId: pollDef.id, optionIndex: optionIndex,
        optionText: pollDef.options[optionIndex], question: pollDef.question,
        deck: deckLabel(), slideIndex: slideIdx + 1
      })
    }).then(function(){
      try { localStorage.setItem(votedKey(pollDef.id), String(optionIndex)); } catch (e) {}
      renderPollCard(pollDef, slideIdx, optionIndex);
      startPollPolling();
    }).catch(function(){
      if (statusEl) statusEl.textContent = "Couldn't send — check your connection and try again.";
      pollCard.querySelectorAll('.poll-opt').forEach(function(b){ b.disabled = false; });
    });
  }

  function renderResults(pollDef){
    var box = pollCard.querySelector('.poll-results');
    if (!box || !window.QUESTIONS_API) return;
    fetch(window.QUESTIONS_API + '?action=pollResults&pollId=' + encodeURIComponent(pollDef.id))
      .then(function(r){ return r.json(); })
      .then(function(data){
        if (!data || !data.ok) return;
        var total = data.total || 0;
        var counts = data.counts || {};
        var html = '';
        pollDef.options.forEach(function(opt, i){
          var c = counts[String(i)] || 0;
          var pct = total ? Math.round((c / total) * 100) : 0;
          html += '<div class="poll-result-row"><div class="poll-result-label">' + escapeHtml(opt) + '</div>' +
            '<div class="poll-bar-track"><div class="poll-bar-fill" style="width:' + pct + '%"></div></div>' +
            '<div class="poll-result-pct">' + pct + '%</div></div>';
        });
        html += '<div class="poll-total">' + total + ' vote' + (total === 1 ? '' : 's') + '</div>';
        box.innerHTML = html;
      }).catch(function(){});
  }

  function startPollPolling(){
    clearInterval(activePollTimer);
    activePollTimer = setInterval(function(){
      if (pollCard.hidden || !currentPoll) { clearInterval(activePollTimer); return; }
      renderResults(currentPoll.def);
    }, 3000);
  }

  function showPoll(pollDef, slideIdx){
    clearInterval(activePollTimer);
    var voted = null;
    try { voted = localStorage.getItem(votedKey(pollDef.id)); } catch (e) {}
    currentPoll = { def: pollDef, slideIdx: slideIdx };
    renderPollCard(pollDef, slideIdx, voted === null ? null : parseInt(voted, 10));
    pollCard.hidden = false;
    pollCard.classList.remove('collapsed');
    alignPollCard();
    if (voted !== null) startPollPolling();
  }
  function hidePoll(){
    clearInterval(activePollTimer);
    currentPoll = null;
    pollCard.hidden = true;
  }

  // ---------- slide-change orchestration ----------
  var lastIndex = -1;
  function onSlideChange(){
    var info = slideInfo();
    if (info.index === lastIndex) return;
    lastIndex = info.index;
    alignPulseBar();
    var pollDef = (window.SLIDE_POLLS || {})[info.index];
    if (pollDef && pollDef.id && pollDef.question && pollDef.options && pollDef.options.length){
      showPoll(pollDef, info.index);
    } else {
      hidePoll();
    }
  }

  var mo = new MutationObserver(function(){ onSlideChange(); });
  mo.observe(deckEl, { subtree: true, attributes: true, attributeFilter: ['class'] });
  setInterval(onSlideChange, 800); // cheap safety net alongside the observer
  onSlideChange();
  alignPulseBar();

  // keep Space/arrow-key slide navigation from hijacking clicks/focus inside our widgets
  document.addEventListener('keydown', function(e){
    var t = e.target;
    if (t && t.closest && (t.closest('.poll-card') || t.closest('.pulse-wrap'))){
      if ([' ', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End'].indexOf(e.key) > -1){
        e.stopPropagation();
      }
    }
  }, true);
})();
