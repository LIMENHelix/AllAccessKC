// One-shot script: within the cat-perks section, wraps each chain-category
// h4 + spots-list block in a <details class="cat-perks-sub"> so each
// category (Coffee, Sit-down, Mexican, etc.) becomes individually
// collapsible. Default closed. Skips the 🎯 "How to stack it" section
// since that's instructional, not a chain list.
//
// Adds a chain-count + stack-value meta chip to each summary so users
// know what's in each category before expanding.
//
// Run from repo root:  node patch-collapsible-subsections.mjs

import fs from 'node:fs';

// Meta strings keyed by leading emoji of each section
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
const SKIP_EMOJI = '🎯'; // "How to stack it" — leave as plain h4

const file = 'kc-guide.html';
let html = fs.readFileSync(file, 'utf8');

// Locate cat-perks section bounds (track nesting to find matching close)
const startMarker = '<details class="cat cat-perks">';
const startIdx = html.indexOf(startMarker);
if (startIdx === -1) throw new Error('cat-perks section not found');

let i = startIdx + startMarker.length;
let depth = 1;
let endIdx = -1;
while (i < html.length && depth > 0) {
  const nextOpen = html.indexOf('<details', i);
  const nextClose = html.indexOf('</details>', i);
  if (nextClose === -1) break;
  if (nextOpen !== -1 && nextOpen < nextClose) {
    depth++;
    i = nextOpen + 8;
  } else {
    depth--;
    if (depth === 0) { endIdx = nextClose + '</details>'.length; break; }
    i = nextClose + 10;
  }
}
if (endIdx === -1) throw new Error('cat-perks close not found');

const before = html.slice(0, startIdx);
let section = html.slice(startIdx, endIdx);
const after = html.slice(endIdx);

// Match each chain-category block: an h4 followed (after whitespace) by a
// <div class="spots-list">...</div>
const blockRegex = /<h4 style="[^"]*">([\s\S]*?)<\/h4>\s*(<div class="spots-list">[\s\S]*?<\/div>)/g;

let wrapped = 0;
let skipped = 0;
section = section.replace(blockRegex, (match, h4Content, spotsList) => {
  const title = h4Content.trim();
  if (title.startsWith(SKIP_EMOJI)) { skipped++; return match; }

  // Pull leading emoji to look up meta
  const emoji = [...title][0];
  const meta = META[emoji] || '';
  const metaHtml = meta ? `<span class="cat-perks-sub-meta">${meta}</span>` : '';

  wrapped++;
  return `<details class="cat-perks-sub">
              <summary><span class="cat-perks-sub-title">${title}</span>${metaHtml}<span class="cat-perks-sub-chev">▾</span></summary>
              ${spotsList}
            </details>`;
});

fs.writeFileSync(file, before + section + after);
console.log(`Wrapped ${wrapped} sub-categories. Skipped ${skipped} (🎯 instructions).`);
