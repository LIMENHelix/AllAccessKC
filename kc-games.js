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
  function go(){var els=document.querySelectorAll('.kc-games');for(var i=0;i<els.length;i++)init(els[i]);}
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',go);else go();
})();
