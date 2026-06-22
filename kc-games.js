/* kc-games.js — live team schedule/score card via ESPN's public API (CORS-open, no key).
   Usage: <div class="kc-games" data-sport="baseball/mlb" data-team="kc" data-name="Royals" data-accent="#004687"></div>
   Degrades gracefully: any failure shows a "check the team site" note, never breaks the page. */
(function () {
  function fmtDate(iso){ try{var d=new Date(iso);return d.toLocaleDateString([],{weekday:'short',month:'short',day:'numeric'})+' · '+d.toLocaleTimeString([],{hour:'numeric',minute:'2-digit'});}catch(e){return '';} }
  function scoreVal(s){ if(s==null)return null; if(typeof s==='object')return (s.displayValue!=null?s.displayValue:s.value); return s; }
  function esc(t){var e=document.createElement('div');e.textContent=String(t==null?'':t);return e.innerHTML;}

  function init(host){
    var sport=host.getAttribute('data-sport'), team=host.getAttribute('data-team')||'kc',
        name=host.getAttribute('data-name')||'Team', accent=host.getAttribute('data-accent')||'#8b6914';
    host.innerHTML='<div class="kcg-card" style="--kga:'+accent+'"><div class="kcg-load">Loading the latest…</div></div>';
    var card=host.firstChild;
    fetch('https://site.api.espn.com/apis/site/v2/sports/'+sport+'/teams/'+team)
      .then(function(r){ if(!r.ok) throw 0; return r.json(); })
      .then(function(d){
        var t=d&&d.team; if(!t) throw 0;
        var abbr=(t.abbreviation||'').toLowerCase();
        var logo=(t.logos&&t.logos[0]&&t.logos[0].href)||'';
        var rec=(t.record&&t.record.items&&t.record.items[0]&&t.record.items[0].summary)||'';
        var standing=t.standingSummary||'';
        var e=t.nextEvent&&t.nextEvent[0], line='';
        if(e&&e.competitions&&e.competitions[0]){
          var c=e.competitions[0], st=(c.status&&c.status.type)||{}, state=st.state, comps=c.competitors||[];
          var me=comps.filter(function(x){return x.team&&(x.team.abbreviation||'').toLowerCase()===abbr;})[0]||comps[0]||{};
          var opp=comps.filter(function(x){return x!==me;})[0]||{};
          var oppName=esc((opp.team&&(opp.team.shortDisplayName||opp.team.displayName))||'opponent');
          var ha=me.homeAway==='home';
          if(state==='post'){
            var ms=scoreVal(me.score), os=scoreVal(opp.score);
            var win=(ms!=null&&os!=null)?(Number(ms)>Number(os)?'W':'L'):'';
            line='<span class="kcg-tag">Final</span>'+(win?('<b>'+win+'</b> '):'')+esc(name)+' '+(ms!=null?esc(ms):'')+', '+oppName+' '+(os!=null?esc(os):'');
          } else if(state==='in'){
            line='<span class="kcg-tag live">● Live</span>'+esc(name)+' '+(ha?'vs':'@')+' '+oppName+(st.shortDetail?(' · '+esc(st.shortDetail)):'');
          } else {
            line='<span class="kcg-tag">Next</span>'+esc(name)+' '+(ha?'vs':'@')+' '+oppName+' · '+esc(fmtDate(e.date))+((c.venue&&c.venue.fullName)?(' · '+esc(c.venue.fullName)):'');
          }
        } else { line='<span class="kcg-note">No game on the board right now — back in season.</span>'; }
        card.innerHTML=(logo?'<img class="kcg-logo" src="'+esc(logo)+'" alt="" loading="lazy" onerror="this.remove()">':'')+
          '<div class="kcg-body"><div class="kcg-name">'+esc(name)+(rec?' <span class="kcg-rec">'+esc(rec)+'</span>':'')+'</div>'+
          (standing?'<div class="kcg-standing">'+esc(standing)+'</div>':'')+
          '<div class="kcg-line">'+line+'</div></div>';
      })
      .catch(function(){ card.innerHTML='<div class="kcg-note">Live schedule unavailable right now — check the team\'s site or ESPN.</div>'; });
  }
  /* ── World Cup match line: live score/kickoff for a specific match at Arrowhead ──
     Usage: <div class="kc-match" data-date="20260625" data-fallback="Netherlands vs. Tunisia"></div>
     Pulls ESPN's FIFA World Cup scoreboard for the date, finds the match at Arrowhead,
     and shows kickoff (pre), live score (in), or final (post). Never breaks the card. */
  function ckCT(iso){
    try{return new Intl.DateTimeFormat([],{hour:'numeric',minute:'2-digit',timeZone:'America/Chicago'}).format(new Date(iso));}
    catch(e){return '';}
  }
  function initMatch(host){
    var date=host.getAttribute('data-date'); if(!date) return;
    var fb=host.getAttribute('data-fallback')||'';
    host.innerHTML='<span class="kcm-load">Checking the score…</span>';
    fetch('https://site.api.espn.com/apis/site/v2/sports/soccer/fifa.world/scoreboard?dates='+date)
      .then(function(r){ if(!r.ok) throw 0; return r.json(); })
      .then(function(d){
        var evs=(d&&d.events)||[], ev=null;
        for(var i=0;i<evs.length;i++){
          var v=evs[i].competitions&&evs[i].competitions[0]&&evs[i].competitions[0].venue;
          if(v&&/arrowhead/i.test(v.fullName||'')){ ev=evs[i]; break; }
        }
        if(!ev){ host.innerHTML = fb?('<span class="kcm-pre">'+esc(fb)+'</span>'):''; if(!fb) host.remove(); return; }
        var c=ev.competitions[0], st=(c.status&&c.status.type)||{}, state=st.state, comps=c.competitors||[];
        var home=comps.filter(function(x){return x.homeAway==='home';})[0]||comps[0]||{};
        var away=comps.filter(function(x){return x.homeAway==='away';})[0]||comps[1]||{};
        function nm(x){return esc((x.team&&(x.team.shortDisplayName||x.team.displayName))||'TBD');}
        function sc(x){var s=scoreVal(x.score);return s==null?'':esc(s);}
        var line;
        if(state==='post'){
          line='<span class="kcm-tag">'+esc(st.shortDetail||'Final')+'</span>'+nm(home)+' <b>'+sc(home)+'</b>–<b>'+sc(away)+'</b> '+nm(away);
        } else if(state==='in'){
          line='<span class="kcm-tag live">● LIVE</span>'+nm(home)+' <b>'+sc(home)+'</b>–<b>'+sc(away)+'</b> '+nm(away)+(st.shortDetail?(' · '+esc(st.shortDetail)):'');
        } else {
          line='<span class="kcm-tag">Kickoff</span>'+nm(home)+' vs '+nm(away)+(ev.date?(' · '+esc(ckCT(ev.date))+' CT'):'');
        }
        host.innerHTML='<span class="kcm">'+line+'</span>';
      })
      .catch(function(){ host.innerHTML = fb?('<span class="kcm-pre">'+esc(fb)+'</span>'):''; if(!fb) host.remove(); });
  }

  /* ── Upcoming schedule: next N games for a team via ESPN team schedule ──
     Usage: <div class="kc-sched" data-sport="baseball/mlb" data-team="kc" data-name="Royals" data-accent="#004687" data-count="5"></div> */
  function initSched(host){
    var sport=host.getAttribute('data-sport'), team=host.getAttribute('data-team')||'kc',
        accent=host.getAttribute('data-accent')||'#8b6914', count=+(host.getAttribute('data-count')||5);
    host.innerHTML='<div class="kcs" style="--kga:'+accent+'"><div class="kcs-load">Loading the schedule…</div></div>';
    var box=host.firstChild;
    fetch('https://site.api.espn.com/apis/site/v2/sports/'+sport+'/teams/'+team+'/schedule')
      .then(function(r){ if(!r.ok) throw 0; return r.json(); })
      .then(function(d){
        var evs=(d&&d.events)||[], rows=[];
        for(var i=0;i<evs.length && rows.length<count;i++){
          var e=evs[i], c=e.competitions&&e.competitions[0]; if(!c) continue;
          var st=(c.status&&c.status.type)||{}, state=st.state;
          if(state==='post') continue; // upcoming only
          var comps=c.competitors||[];
          var home=comps.filter(function(x){return x.homeAway==='home';})[0]||comps[0]||{};
          var away=comps.filter(function(x){return x.homeAway==='away';})[0]||comps[1]||{};
          var meHome = isMe(home,team);
          var opp = meHome?away:home;
          var oppNm=esc((opp.team&&(opp.team.shortDisplayName||opp.team.displayName||opp.team.abbreviation))||'TBD');
          var oppLogo=(opp.team&&((opp.team.logos&&opp.team.logos[0]&&opp.team.logos[0].href)||opp.team.logo))||'';
          var live = state==='in';
          rows.push('<li>'+
            (oppLogo?'<img class="kcs-logo" src="'+esc(oppLogo)+'" alt="" loading="lazy" onerror="this.style.visibility=\'hidden\'">':'<span class="kcs-logo"></span>')+
            '<span class="kcs-vs">'+(meHome?'vs':'@')+' '+oppNm+'</span>'+
            '<span class="kcs-when">'+(live?'<span class="kcs-live">● Live</span>':esc(fmtDate(e.date)))+'</span>'+
            '</li>');
        }
        box.innerHTML = rows.length
          ? '<div class="kcs-title">Next up</div><ul class="kcs-list">'+rows.join('')+'</ul>'
          : '<div class="kcs-note">No upcoming games on the board — back in season.</div>';
      })
      .catch(function(){ box.innerHTML='<div class="kcs-note">Schedule unavailable right now — check the team\'s site.</div>'; });
  }
  function isMe(competitor, team){
    if(!competitor||!competitor.team) return false;
    var ab=(competitor.team.abbreviation||'').toLowerCase();
    var slug=(competitor.team.slug||'').toLowerCase();
    var t=(''+team).toLowerCase();
    return ab===t || slug.indexOf(t)>=0 || (''+competitor.id)===t;
  }

  function go(){
    var els=document.querySelectorAll('.kc-games');for(var i=0;i<els.length;i++)init(els[i]);
    var ms=document.querySelectorAll('.kc-match');for(var j=0;j<ms.length;j++)initMatch(ms[j]);
    var ss=document.querySelectorAll('.kc-sched');for(var k=0;k<ss.length;k++)initSched(ss[k]);
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',go);else go();
})();
