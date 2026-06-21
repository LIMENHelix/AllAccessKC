/* kc-board.js — drop-in classifieds / yard-sale / singles boards. Uses /api/board.
   Usage:
     <div class="kc-board" data-board="market"  data-channels="for-sale,yard-sale,free,wanted,housing,gigs"></div>
     <div class="kc-board" data-board="singles" data-channels="women,men,everyone,friends"></div>
   Include: <script src="/kc-board.js" defer></script>  (after kc-chat.js — shares the alias) */
(function () {
  function getAlias(){var a;try{a=localStorage.getItem('kc_alias')||'';}catch(e){a='';}
    if(!a){a='River Market Local';try{localStorage.setItem('kc_alias',a);}catch(e){}}return a;}
  function esc(t){var e=document.createElement('div');e.textContent=t;return e.innerHTML;}
  function pretty(s){return s.replace(/-/g,' ').replace(/\b\w/g,function(c){return c.toUpperCase();});}
  function when(ts){try{var d=new Date(Number(ts));return d.toLocaleDateString([],{month:'short',day:'numeric'});}catch(e){return '';}}

  function initBoard(host){
    var board=host.getAttribute('data-board')||'market';
    var channels=(host.getAttribute('data-channels')||'').split(',').map(function(s){return s.trim();}).filter(Boolean);
    if(!channels.length)channels=['general'];
    var isSingles=board==='singles';
    var active=channels[0];

    var opts=channels.map(function(c){return '<option value="'+c+'">'+esc(pretty(c))+'</option>';}).join('');
    var formInner=isSingles
      ? '<div class="row">'
          +'<input name="title" maxlength="80" placeholder="Headline (e.g. Coffee + a Royals game?)">'
          +'<input name="age" maxlength="12" placeholder="Age (optional)">'
        +'</div>'
        +'<div class="row">'
          +'<select name="channel">'+opts+'</select>'
          +'<input name="area" maxlength="40" placeholder="Area (Westport, Northland…)">'
        +'</div>'
        +'<textarea name="body" maxlength="1000" placeholder="A little about you and what you\'re looking for…"></textarea>'
        +'<div class="row"><input name="contact" maxlength="80" placeholder="How to reach you (IG handle, email — your call)"></div>'
      : '<div class="row">'
          +'<input name="title" maxlength="80" placeholder="What is it? (e.g. Mid-century dresser)">'
          +'<input name="price" maxlength="20" placeholder="Price (or Free / OBO)">'
        +'</div>'
        +'<div class="row">'
          +'<select name="channel">'+opts+'</select>'
          +'<input name="area" maxlength="40" placeholder="Area / cross-streets">'
        +'</div>'
        +'<textarea name="body" maxlength="1000" placeholder="Details — condition, pickup times, sizes…"></textarea>'
        +'<div class="row"><input name="contact" maxlength="80" placeholder="How buyers reach you (email/phone/IG)"></div>'
        +'<div class="row"><input name="image" maxlength="300" placeholder="Photo URL (optional) — paste a link to an image"></div>';

    host.innerHTML=
      '<div class="kc-form"><h3>'+(isSingles?'Post to KC Singles':'Post a listing')+'</h3>'
        +'<form>'+formInner+'<div style="margin-top:6px"><button type="submit" class="btn">Post it</button></div>'
        +'<div class="msg" aria-live="polite"></div></form>'
        +'<div class="kc-safe">'+(isSingles
            ? 'Be safe: meet in public, tell a friend, never send money or sensitive info. This is a public board — anyone can read it.'
            : 'Public board — never share bank/payment details. Meet in a safe public spot for handoffs. We don\'t handle transactions.')+'</div>'
      +'</div>'
      +'<div class="tabs"></div>'
      +'<div class="listing"><div class="empty">Loading…</div></div>';

    var tabs=host.querySelector('.tabs'), listing=host.querySelector('.listing'),
        form=host.querySelector('form'), msg=host.querySelector('.msg'), sel=form.querySelector('select[name=channel]');
    channels.forEach(function(c){
      var b=document.createElement('button');b.textContent=pretty(c);b.setAttribute('data-c',c);
      if(c===active)b.className='active';
      b.addEventListener('click',function(){active=c;tabs.querySelectorAll('button').forEach(function(x){x.classList.toggle('active',x.getAttribute('data-c')===c);});load();});
      tabs.appendChild(b);
    });

    function card(p){
      var pl=p.payload||{};
      var head=isSingles
        ? '<h4>'+esc(pl.title||'Someone in KC')+'</h4>'
        : (pl.price?'<div class="price">'+esc(pl.price)+'</div>':'')+'<h4>'+esc(pl.title||'Listing')+'</h4>';
      var bits=[];
      if(isSingles&&pl.age)bits.push(esc(pl.age));
      if(pl.area)bits.push(esc(pl.area));
      bits.push(esc(p.alias));bits.push(when(p.ts));
      var contact=pl.contact?'<div class="contact">📬 '+esc(pl.contact)+'</div>':'';
      var body=p.text?'<div class="body">'+esc(p.text)+'</div>':'';
      var img=(pl.image&&/^https?:\/\//i.test(pl.image))?'<img class="kc-post-img" src="'+esc(pl.image)+'" alt="" loading="lazy" onerror="this.remove()">':'';
      var d=document.createElement('div');d.className='kc-post';
      d.innerHTML=img+head+'<div class="meta">'+bits.join(' · ')+'</div>'+body+contact;
      return d;
    }
    function load(){
      listing.innerHTML='<div class="empty">Loading…</div>';
      fetch('/api/board?board='+encodeURIComponent(board)+'&channel='+encodeURIComponent(active)).then(function(r){return r.json();}).then(function(d){
        listing.innerHTML='';
        if(d&&d.live===false){listing.innerHTML='<div class="empty">The boards open soon — check back shortly.</div>';return;}
        if(!d||!d.posts||!d.posts.length){listing.innerHTML='<div class="empty">Nothing here yet — be the first to post.</div>';return;}
        d.posts.slice().reverse().forEach(function(p){listing.appendChild(card(p));});
      }).catch(function(){listing.innerHTML='<div class="empty">Couldn\'t load — try again.</div>';});
    }

    form.addEventListener('submit',function(e){
      e.preventDefault();
      var fd={};Array.prototype.forEach.call(form.elements,function(el){if(el.name)fd[el.name]=el.value.trim();});
      var channel=fd.channel||active;
      if(!fd.title&&!fd.body){msg.style.color='#c44848';msg.textContent='Add a title or some details first.';return;}
      var payload={title:fd.title,area:fd.area,contact:fd.contact};
      if(isSingles){payload.age=fd.age;}else{payload.price=fd.price;if(fd.image&&/^https?:\/\//i.test(fd.image))payload.image=fd.image;}
      var btn=form.querySelector('button');btn.disabled=true;msg.style.color='';msg.textContent='Posting…';
      fetch('/api/board',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({board:board,channel:channel,alias:getAlias(),text:fd.body||'',payload:payload})})
        .then(function(r){return r.json();}).then(function(d){
          if(d&&d.ok){msg.style.color='#3e8a52';msg.textContent='Posted! 🎉';form.querySelectorAll('input,textarea').forEach(function(el){el.value='';});
            active=channel;tabs.querySelectorAll('button').forEach(function(x){x.classList.toggle('active',x.getAttribute('data-c')===channel);});load();}
          else{msg.style.color='#c44848';msg.textContent=(d&&d.error)||'Could not post.';}
        }).catch(function(){msg.style.color='#c44848';msg.textContent='Network error — try again.';}).then(function(){btn.disabled=false;});
    });

    load();
  }

  function init(){var b=document.querySelectorAll('.kc-board');for(var i=0;i<b.length;i++)initBoard(b[i]);}
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);else init();
})();
