/* kc-chat.js — drop-in KC chat rooms. No dependencies, uses /api/board.
   Usage:  <div class="kc-room" data-channel="chiefs"></div>
   Include: <script src="/kc-chat.js" defer></script>
   Every visitor gets a persistent Kansas-City-style alias (shared across the site). */
(function () {
  var PLACES = ["Westport","Brookside","Waldo","Crossroads","Plaza","Northland","Midtown","Westside","River Market","Crown Center","Columbus Park","Strawberry Hill","Hyde Park","Martini Corner","Volker","Quindaro","Parkville","Gladstone","Riverside","Sugar Creek","Burnt End","Boulevard","Fountain","Royal","Chiefs","Sporting","Streetcar","Arrowhead","Kauffman","Shuttlecock","Scout","Jazz","Brisket","Z-Man","Ribs","Loose Park"];
  var NAMES = ["Benny","Barb","Bo","Betty","Charlie","Cleo","Dot","Earl","Faye","Gus","Hank","Ida","Jax","Kit","Lou","Mabel","Ned","Otis","Pearl","Quinn","Rae","Sal","Tess","Vic","Wally","Willa","Zeke","Marty","Stan","Roy","June","Hattie","Cliff","Rufus","Della","Moe","Pete","Stella","Hazel","Gene"];
  function rp(a){return a[Math.floor(Math.random()*a.length)];}
  function makeAlias(){var p=rp(PLACES),w=(p.replace(/[^a-z]/i,'').charAt(0)||'').toUpperCase(),n;if(Math.random()<0.6){var m=NAMES.filter(function(x){return x.charAt(0).toUpperCase()===w;});n=m.length?rp(m):rp(NAMES);}else n=rp(NAMES);return p+' '+n;}
  function getAlias(){var a;try{a=localStorage.getItem('kc_alias')||'';}catch(e){a='';}if(!a){a=makeAlias();try{localStorage.setItem('kc_alias',a);}catch(e){}}return a;}
  function setAlias(a){try{localStorage.setItem('kc_alias',a);}catch(e){}}
  function hue(s){var h=0;for(var i=0;i<s.length;i++)h=(h*31+s.charCodeAt(i))%360;return h;}
  function tint(s){return 'hsl('+hue(s)+',45%,42%)';}
  function initials(s){var p=s.split(' ');return ((p[0]||'')[0]||'')+((p[p.length-1]||'')[0]||'');}
  function esc(t){var e=document.createElement('div');e.textContent=t;return e.innerHTML;}
  function timeStr(ts){try{return new Date(Number(ts)).toLocaleTimeString([],{hour:'numeric',minute:'2-digit'});}catch(e){return '';}}

  function initRoom(host){
    var channel=host.getAttribute('data-channel')||'general';
    var alias=getAlias();
    host.innerHTML=
      '<div class="you">You\'re chatting as <span class="badge"><span class="dot"></span><span class="al"></span></span>'
      +'<button type="button" class="reroll" title="New KC nickname">🎲 New name</button></div>'
      +'<div class="feed"><div class="empty">Loading the room…</div></div>'
      +'<form><input type="text" maxlength="1000" placeholder="Say something to the room…" autocomplete="off"><button type="submit">Send</button></form>';
    var feed=host.querySelector('.feed'), form=host.querySelector('form'), input=host.querySelector('input'),
        sendBtn=host.querySelector('button[type=submit]'), alEl=host.querySelector('.al'),
        dot=host.querySelector('.badge .dot'), reroll=host.querySelector('.reroll'), empty=feed.querySelector('.empty');
    function showAlias(){alEl.textContent=alias;dot.style.background=tint(alias);}
    showAlias();
    reroll.addEventListener('click',function(){alias=makeAlias();setAlias(alias);showAlias();});

    var seen={},busy=false,started=false;
    function atBottom(){return feed.scrollHeight-feed.scrollTop-feed.clientHeight<60;}
    function render(m){
      if(!m||!m.id||seen[m.id])return;seen[m.id]=true;
      if(empty){empty.remove();empty=null;}
      var mine=m.alias===alias, row=document.createElement('div');row.className='kc-msg'+(mine?' mine':'');
      var av=document.createElement('div');av.className='kc-av';av.style.background=tint(m.alias||'?');av.textContent=(initials(m.alias||'?')||'?').toUpperCase();
      var b=document.createElement('div');b.className='kc-bub';
      var who=document.createElement('div');who.className='kc-who';who.textContent=mine?(m.alias+' (you)'):m.alias;
      var tx=document.createElement('div');tx.className='kc-txt';tx.textContent=m.text;
      var wh=document.createElement('div');wh.className='kc-when';wh.textContent=timeStr(m.ts);
      b.appendChild(who);b.appendChild(tx);b.appendChild(wh);row.appendChild(av);row.appendChild(b);feed.appendChild(row);
    }
    function load(){
      return fetch('/api/board?board=rooms&channel='+encodeURIComponent(channel)).then(function(r){return r.json();}).then(function(d){
        if(!d)return;
        if(d.posts&&d.posts.length){var stick=atBottom();d.posts.forEach(render);if(stick)feed.scrollTop=feed.scrollHeight;}
        else if(empty&&d.live===false){empty.innerHTML="This room opens soon — check back in a bit. 🍻";}
        else if(empty){empty.innerHTML="Nobody's here yet.<br>Be the first to say hi, "+esc(alias)+"!";}
      }).catch(function(){});
    }
    function flash(msg){var n=document.createElement('div');n.className='empty';n.style.color='#c44848';n.textContent=msg;feed.appendChild(n);feed.scrollTop=feed.scrollHeight;setTimeout(function(){n.remove();},4000);}
    form.addEventListener('submit',function(e){
      e.preventDefault();if(busy)return;var text=input.value.trim();if(!text)return;
      busy=true;sendBtn.disabled=true;
      fetch('/api/board',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({board:'rooms',channel:channel,alias:alias,text:text})})
        .then(function(r){return r.json();}).then(function(d){
          if(d&&d.ok&&d.post){render(d.post);feed.scrollTop=feed.scrollHeight;input.value='';}
          else if(d&&d.error){flash(d.error);}
        }).catch(function(){flash("Couldn't send — try again.");}).then(function(){busy=false;sendBtn.disabled=false;input.focus();});
    });
    function start(){if(started)return;started=true;load().then(function(){feed.scrollTop=feed.scrollHeight;});setInterval(load,6000);}
    if('IntersectionObserver' in window){var io=new IntersectionObserver(function(en){if(en[0]&&en[0].isIntersecting){start();io.disconnect();}},{rootMargin:'250px'});io.observe(host);}else start();
  }

  function init(){var rooms=document.querySelectorAll('.kc-room');for(var i=0;i<rooms.length;i++)initRoom(rooms[i]);}
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);else init();
})();
