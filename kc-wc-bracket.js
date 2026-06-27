/* kc-wc-bracket.js — ONE live FIFA World Cup 2026 knockout bracket.
   Fills in automatically as games are played, via ESPN's public scoreboard
   feed (CORS-open, no key). KC/Arrowhead matches are highlighted.
   Usage: <div class="kc-wcb"></div>
   Degrades gracefully — any failure shows a "check back" note, never breaks the page. */
(function () {
  var API = 'https://site.api.espn.com/apis/site/v2/sports/soccer/fifa.world/scoreboard?dates=';
  // The 2026 knockout calendar, grouped by round (dates the bracket fills in on).
  var ROUNDS = [
    { key: 'R32', label: 'Round of 32',   dates: ['20260628','20260629','20260630','20260701','20260702','20260703'] },
    { key: 'R16', label: 'Round of 16',   dates: ['20260704','20260705','20260706','20260707'] },
    { key: 'QF',  label: 'Quarterfinals', dates: ['20260709','20260710','20260711'] },
    { key: 'SF',  label: 'Semifinals',    dates: ['20260714','20260715'] },
    { key: 'F',   label: 'Final',         dates: ['20260718','20260719'] }
  ];

  function esc(t){ var e=document.createElement('div'); e.textContent=String(t==null?'':t); return e.innerHTML; }
  function scoreVal(s){ if(s==null) return null; if(typeof s==='object') return (s.displayValue!=null?s.displayValue:s.value); return s; }

  function fetchDate(d){
    return fetch(API+d)
      .then(function(r){ return r.ok ? r.json() : {}; })
      .then(function(j){ return (j && j.events) || []; })
      .catch(function(){ return []; });
  }

  function side(x, state){
    var t = x.team || {};
    var disp = t.displayName || t.name || 'TBD';
    // Knockout slots start as placeholders ("Round of 32 1 Winner", "Winner Group A"),
    // which still carry an id — so detect by the name, not the id.
    var placeholder = /winner|runner|group|\bTBD\b/i.test(disp);
    var nm = placeholder ? disp : (t.shortDisplayName || disp);
    var live = (state === 'in' || state === 'post');
    var sc = live ? scoreVal(x.score) : null; // ESPN reports 0 for unplayed — hide it
    return { name: nm, score: (sc==null ? '' : sc), win: x.winner === true, tbd: placeholder };
  }

  function parseMatch(e){
    var c = (e.competitions && e.competitions[0]) || {};
    var st = (c.status && c.status.type) || {};
    var comps = c.competitors || [];
    var home = comps.filter(function(x){return x.homeAway==='home';})[0] || comps[0] || {};
    var away = comps.filter(function(x){return x.homeAway==='away';})[0] || comps[1] || {};
    return {
      date: e.date || '',
      state: st.state,
      venue: (c.venue && c.venue.fullName) || '',
      home: side(home, st.state),
      away: side(away, st.state)
    };
  }

  function matchCard(m){
    var kc = /arrowhead/i.test(m.venue);
    function row(s){
      return '<div class="wcb-team'+(s.win?' win':'')+(s.tbd?' tbd':'')+'">'+
               '<span class="wcb-nm">'+esc(s.name)+'</span>'+
               '<span class="wcb-sc">'+esc(s.score)+'</span>'+
             '</div>';
    }
    var tag = m.state==='post' ? '<span class="wcb-tag">Final</span>'
            : m.state==='in'   ? '<span class="wcb-tag live">● Live</span>'
            : '';
    var meta = (tag || kc) ? '<div class="wcb-meta">'+tag+(kc?'<span class="wcb-kc">● Arrowhead</span>':'')+'</div>' : '';
    return '<div class="wcb-match'+(kc?' kc':'')+'">'+row(m.home)+row(m.away)+meta+'</div>';
  }

  function render(host, data){
    var cols = data.map(function(rd){
      var cards = rd.matches.map(matchCard).join('');
      return '<div class="wcb-round">'+
               '<div class="wcb-rhead">'+esc(rd.label)+'</div>'+
               '<div class="wcb-cards">'+(cards || '<div class="wcb-empty">TBD</div>')+'</div>'+
             '</div>';
    }).join('');
    host.innerHTML = '<div class="wcb-scroll">'+cols+'</div>'+
      '<p class="wcb-foot">Updates live from the official results — winners advance automatically as each match goes final. '+
      '<span class="wcb-kc">●</span> = played at Arrowhead in Kansas City.</p>';
  }

  function init(host){
    host.innerHTML = '<div class="wcb-load">Loading the bracket…</div>';
    Promise.all(ROUNDS.map(function(rd){
      return Promise.all(rd.dates.map(fetchDate)).then(function(lists){
        var evs = [].concat.apply([], lists);
        var matches = evs.map(parseMatch).sort(function(a,b){ return a.date<b.date?-1:(a.date>b.date?1:0); });
        return { key: rd.key, label: rd.label, matches: matches };
      });
    })).then(function(data){
      var any = data.some(function(r){ return r.matches.length; });
      if(!any){ host.innerHTML = '<div class="wcb-empty">Bracket opens as the knockout rounds begin — check back after the group stage.</div>'; return; }
      render(host, data);
    }).catch(function(){
      host.innerHTML = '<div class="wcb-empty">Bracket unavailable right now — check back shortly.</div>';
    });
  }

  function go(){ var els=document.querySelectorAll('.kc-wcb'); for(var i=0;i<els.length;i++) init(els[i]); }
  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded', go); else go();
})();
