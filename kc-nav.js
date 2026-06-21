/* kc-nav.js — shared sticky nav + footer for every All Access KC page.
   Include once: <script src="/kc-nav.js" defer></script>
   Also wires .reveal scroll animations site-wide. No dependencies. */
(function () {
  var LINKS = [
    { href: "/", label: "Home" },
    { href: "/kc-guide", label: "Guide" },
    { href: "/eat", label: "Eat" },
    { href: "/freebies", label: "Free Stuff" },
    { href: "/weekend", label: "Weekend" },
    { label: "Tools", menu: [
      { href: "/open", label: "🟢 Open Right Now" },
      { href: "/deals", label: "🏷 Today's Deals" },
      { href: "/plan", label: "🎲 Plan My Night" },
      { href: "/gameday", label: "🏟 Game-Day Toolkit" },
    ]},
    { label: "Teams", menu: [
      { href: "/chiefs", label: "Chiefs Corner" },
      { href: "/royals", label: "Royals Corner" },
      { href: "/soccer", label: "Soccer & The Summer" },
      { href: "/summer", label: "The Big Summer (live)" },
      { href: "/tailgate", label: "Tailgate & Parties" },
    ]},
    { label: "Neighborhoods", menu: [
      { href: "/neighborhoods", label: "All Neighborhoods" },
      { href: "/eastside", label: "East Side & Troost" },
      { href: "/map", label: "Interactive KC Map" },
    ]},
    { label: "Community", menu: [
      { href: "/rooms", label: "Chat Rooms" },
      { href: "/market", label: "Market & Yard Sales" },
      { href: "/singles", label: "KC Singles" },
    ]},
    { href: "/events", label: "Events" },
  ];

  var path = location.pathname.replace(/\.html$/, "").replace(/\/$/, "") || "/";
  function isActive(href) { return href === path || (href !== "/" && path.indexOf(href) === 0); }

  function linkEl(l) {
    if (l.menu) {
      var d = document.createElement("div"); d.className = "kc-drop";
      var s = document.createElement("span"); s.textContent = l.label + " ▾"; d.appendChild(s);
      var m = document.createElement("div"); m.className = "menu";
      l.menu.forEach(function (i) { var a = document.createElement("a"); a.href = i.href; a.textContent = i.label; if (isActive(i.href)) a.className = "active"; m.appendChild(a); });
      d.appendChild(m); return d;
    }
    var a = document.createElement("a"); a.href = l.href; a.textContent = l.label; if (isActive(l.href)) a.className = "active"; return a;
  }

  function buildNav() {
    var nav = document.createElement("nav"); nav.className = "kc-nav";
    var bar = document.createElement("div"); bar.className = "bar";
    var brand = document.createElement("a"); brand.className = "kc-brand"; brand.href = "/";
    brand.innerHTML = "ALL ACCESS <b>KC</b>";
    var burger = document.createElement("button"); burger.className = "kc-burger"; burger.setAttribute("aria-label", "Menu"); burger.textContent = "☰";
    var links = document.createElement("div"); links.className = "kc-links";
    LINKS.forEach(function (l) { links.appendChild(linkEl(l)); });
    burger.addEventListener("click", function () { links.classList.toggle("open"); });
    bar.appendChild(brand); bar.appendChild(burger); bar.appendChild(links);
    nav.appendChild(bar);
    return nav;
  }

  function buildFooter() {
    var f = document.createElement("footer"); f.className = "kc-foot";
    f.innerHTML =
      '<div class="wrap">' +
        '<div style="max-width:300px">' +
          '<div class="kc-brand" style="color:#fff">ALL ACCESS <b style="color:#e8c97a">KC</b></div>' +
          '<p style="font-size:0.85rem;color:#9a9db0;margin-top:8px;line-height:1.6">The local’s free guide to Kansas City — food, teams, neighborhoods, and a community that actually lives here.</p>' +
        '</div>' +
        '<div class="cols">' +
          '<div><h5>Explore</h5><ul><li><a href="/kc-guide">Full guide</a></li><li><a href="/eat">Eat</a></li><li><a href="/weekend">Perfect weekend</a></li><li><a href="/map">KC map</a></li><li><a href="/neighborhoods">Neighborhoods</a></li><li><a href="/events">Events</a></li></ul></div>' +
          '<div><h5>Teams</h5><ul><li><a href="/chiefs">Chiefs</a></li><li><a href="/royals">Royals</a></li><li><a href="/soccer">Soccer</a></li><li><a href="/tailgate">Tailgate</a></li></ul></div>' +
          '<div><h5>Community</h5><ul><li><a href="/rooms">Chat rooms</a></li><li><a href="/market">Market</a></li><li><a href="/singles">Singles</a></li></ul></div>' +
        '</div>' +
        '<div class="fine">Independent Kansas City visitor guide. Not affiliated with any sports league, federation, tournament organizer, or municipal government. Community boards are public and lightly moderated — be kind, never share sensitive personal info, and verify hours/details yourself. · <a href="/privacy">Privacy</a> · <a href="/terms">Terms</a> · <a href="mailto:info@allaccesskc.com">info@allaccesskc.com</a></div>' +
      '</div>';
    return f;
  }

  function init() {
    if (!document.querySelector(".kc-nav")) document.body.insertBefore(buildNav(), document.body.firstChild);
    if (!document.querySelector(".kc-foot")) document.body.appendChild(buildFooter());
    // reveal-on-scroll
    var els = document.querySelectorAll(".reveal");
    if ("IntersectionObserver" in window && els.length) {
      var io = new IntersectionObserver(function (en) {
        en.forEach(function (e) { if (e.isIntersecting) { e.target.classList.add("in"); io.unobserve(e.target); } });
      }, { rootMargin: "0px 0px -8% 0px" });
      els.forEach(function (e) { io.observe(e); });
    } else { els.forEach(function (e) { e.classList.add("in"); }); }
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
