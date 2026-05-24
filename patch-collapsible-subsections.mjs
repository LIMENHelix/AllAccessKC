// One-shot: wrap each chain-category h4 + spots-list block inside the
// cat-perks section in a <details class="cat-perks-sub">.
//
// CRITICAL: the spots-list close </div> must be found via DIV DEPTH
// TRACKING, not by lazy regex - spots-list contains many nested
// <div class="spot">...<div class="spot-name">...</div>...</div> entries,
// and a naive `<div class="spots-list">[\s\S]*?</div>` regex matches the
// FIRST </div> it sees (the spot-name close), corrupting the structure.
//
// Run from repo root:  node patch-collapsible-subsections.mjs

import fs from 'node:fs';

const META = {
  '☕': '3 chains · ~$15',
  '🍴': '18 chains · ~$135',
  '🌮': '3 chains · ~$19',
  '🍔': '18 chains · ~$80',
  '🥪': '3 chains · ~$18',
  '🍩': '9 chains · ~$36',
  '🍳': '2 chains · ~$11',
  '📍': '2 chains · ~$18',
  '🎂': '5 chains · ~$43',
  '🍺': '1 chain · ~$8/mo',
};
const SKIP_EMOJI = '🎯'; // "How to stack it" — instructions, not a chain category

const file = 'kc-guide.html';
let html = fs.readFileSync(file, 'utf8');

// Locate cat-perks section bounds via <details> depth tracking
const startMarker = '<details class="cat cat-perks">';
const startIdx = html.indexOf(startMarker);
if (startIdx === -1) throw new Error('cat-perks section not found');

let i = startIdx + startMarker.length;
let detailsDepth = 1;
let endIdx = -1;
while (i < html.length && detailsDepth > 0) {
  const nOpen = html.indexOf('<details', i);
  const nClose = html.indexOf('</details>', i);
  if (nClose === -1) break;
  if (nOpen !== -1 && nOpen < nClose) { detailsDepth++; i = nOpen + 8; }
  else { detailsDepth--; if (detailsDepth === 0) { endIdx = nClose + 10; break; } i = nClose + 10; }
}
if (endIdx === -1) throw new Error('cat-perks close not found');

const before = html.slice(0, startIdx);
let section = html.slice(startIdx, endIdx);
const after = html.slice(endIdx);

// Walk the section, finding each <h4>...</h4> followed by <div class="spots-list">
// then finding the matching </div> by counting <div> opens vs </div> closes.
//
// We collect all (start, end, h4Content) tuples first, then apply replacements
// in REVERSE order so byte offsets don't shift under us.
const h4RegexAll = /<h4 style="[^"]*">([\s\S]*?)<\/h4>(\s*)<div class="spots-list">/g;
const blocks = [];

let m;
while ((m = h4RegexAll.exec(section)) !== null) {
  const blockStart = m.index;
  const h4Content = m[1];
  const spotsListOpenEnd = m.index + m[0].length; // position right AFTER '<div class="spots-list">'

  // Find matching </div> for spots-list via div-depth tracking
  let pos = spotsListOpenEnd;
  let divDepth = 1;
  let listEnd = -1;
  const openRe = /<div(?:\s[^>]*)?>/g;
  const closeRe = /<\/div>/g;
  while (divDepth > 0) {
    openRe.lastIndex = pos;
    closeRe.lastIndex = pos;
    const openM = openRe.exec(section);
    const closeM = closeRe.exec(section);
    if (!closeM) break;
    if (openM && openM.index < closeM.index) {
      divDepth++;
      pos = openM.index + openM[0].length;
    } else {
      divDepth--;
      pos = closeM.index + closeM[0].length;
      if (divDepth === 0) { listEnd = pos; break; }
    }
  }
  if (listEnd === -1) { console.warn('No matching </div> for spots-list near h4:', h4Content.slice(0, 40)); continue; }

  blocks.push({ blockStart, blockEnd: listEnd, h4Content, spotsListInnerStart: spotsListOpenEnd, spotsListEnd: listEnd });
}

// Apply replacements in reverse
blocks.reverse();
let wrapped = 0, skipped = 0;
for (const b of blocks) {
  const title = b.h4Content.trim();
  if (title.startsWith(SKIP_EMOJI)) { skipped++; continue; }
  const emoji = [...title][0];
  const meta = META[emoji] || '';
  const metaHtml = meta ? `<span class="cat-perks-sub-meta">${meta}</span>` : '';
  const spotsListBlock = '<div class="spots-list">' + section.slice(b.spotsListInnerStart, b.spotsListEnd);
  const replacement = `<details class="cat-perks-sub">
              <summary><span class="cat-perks-sub-title">${title}</span>${metaHtml}<span class="cat-perks-sub-chev">▾</span></summary>
              ${spotsListBlock}
            </details>`;
  section = section.slice(0, b.blockStart) + replacement + section.slice(b.blockEnd);
  wrapped++;
}

fs.writeFileSync(file, before + section + after);
console.log(`Wrapped ${wrapped} sub-categories. Skipped ${skipped} (🎯 instructions).`);
