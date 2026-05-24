// One-shot script: wraps each "Sign up:" line in the cat-perks section
// with an anchor pointing to the chain's rewards page.
// Looks up URL by matching the .spot-name a few lines above each sign-up line.
//
// Run from repo root:  node patch-signup-links.mjs
// Then delete this file — it's a one-shot, not part of the runtime.

import fs from 'node:fs';

const URLS = {
  "Dutch Bros":                                    "https://www.dutchbros.com/rewards",
  "Starbucks":                                     "https://www.starbucks.com/rewards",
  "Caribou Coffee":                                "https://www.cariboucoffee.com/rewards",
  "54th Street Grill & Bar":                       "https://54thstreetrestaurants.com/rewards/",
  "Red Door Woodfired Grill":                      "https://www.reddoorgrill.com/rewards",
  "Chili's":                                       "https://www.chilis.com/my-chilis-rewards",
  "Buffalo Wild Wings":                            "https://www.buffalowildwings.com/en/rewards",
  "Texas Roadhouse":                               "https://www.texasroadhouse.com/vip-club",
  "TGI Friday's":                                  "https://www.tgifridays.com/rewards",
  "BJ's Restaurant & Brewhouse":                   "https://www.bjsrestaurants.com/rewards",
  "California Pizza Kitchen":                      "https://www.cpk.com/rewards",
  "Cheddar's Scratch Kitchen":                     "https://www.cheddars.com/eclub",
  "Famous Dave's BBQ":                             "https://www.famousdaves.com/rewards",
  "Houlihan's":                                    "https://www.houlihans.com/houli-fan-club",
  "Red Lobster":                                   "https://www.redlobster.com/my-rewards",
  "P.F. Chang's":                                  "https://www.pfchangs.com/rewards",
  "Panera Bread":                                  "https://www.panerabread.com/en-us/mypanera.html",
  "La Madeleine French Bakery & Café":             "https://www.lamadeleine.com/eclub",
  "Golden Corral":                                 "https://www.goldencorral.com/eclub-signup",
  "Bob Evans":                                     "https://www.bobevans.com/eclub",
  "Noodles & Company":                             "https://www.noodles.com/rewards",
  "Chipotle":                                      "https://www.chipotle.com/rewards",
  "On the Border":                                 "https://www.ontheborder.com/club-cantina",
  "Abuelo's Mexican Restaurant":                   "https://www.abuelos.com/rewards",
  "McDonald's":                                    "https://www.mcdonalds.com/us/en-us/mymcdonalds.html",
  "Burger King":                                   "https://www.bk.com/royal-perks",
  "Wendy's":                                       "https://www.wendys.com/rewards",
  "Taco Bell":                                     "https://www.tacobell.com/rewards",
  "Arby's":                                        "https://www.arbys.com/rewards",
  "Hardee's":                                      "https://www.hardees.com/rewards",
  "Popeyes":                                       "https://www.popeyes.com/rewards",
  "Church's Texas Chicken":                        "https://www.churchs.com/rewards",
  "Del Taco":                                      "https://www.deltaco.com/del-yeah-rewards",
  "Slim Chickens":                                 "https://www.slimchickens.com/rewards",
  "Zaxby's":                                       "https://www.zaxbys.com/rewards",
  "Freddy's Frozen Custard & Steakburgers":        "https://www.freddysusa.com/rewards",
  "Panda Express":                                 "https://www.pandaexpress.com/rewards",
  "Moe's Southwest Grill":                         "https://www.moes.com/rewards",
  "Taco John's":                                   "https://www.tacojohns.com/rewards",
  "Torchy's Tacos":                                "https://www.torchystacos.com/rewards",
  "Dave's Hot Chicken":                            "https://www.daveshotchicken.com/rewards",
  "White Castle":                                  "https://www.whitecastle.com/rewards",
  "Jimmy John's":                                  "https://www.jimmyjohns.com/rewards",
  "Potbelly":                                      "https://www.potbelly.com/perks",
  "Which Wich Superior Sandwiches":                "https://www.whichwich.com/vibeclub",
  "Krispy Kreme":                                  "https://www.krispykreme.com/rewards",
  "Cinnabon":                                      "https://www.cinnabon.com/rewards",
  "Auntie Anne's":                                 "https://www.auntieannes.com/rewards",
  "Wetzel's Pretzels":                             "https://www.wetzels.com/rewards",
  "Andy's Frozen Custard":                         "https://eatandys.com/rewards",
  "Baskin-Robbins":                                "https://www.baskinrobbins.com/rewards",
  "Bruster's Real Ice Cream":                      "https://www.brusters.com/rewards",
  "Marble Slab Creamery":                          "https://www.marbleslab.com/rewards",
  "Jamba":                                         "https://www.jamba.com/rewards",
  "Einstein Bros. Bagels":                         "https://www.einsteinbros.com/rewards",
  "IHOP":                                          "https://www.ihop.com/en/rewards",
  "LongHorn Steakhouse":                           "https://www.longhornsteakhouse.com/eclub",
  "Applebee's":                                    "https://www.applebees.com/en/rewards",
  "Red Robin":                                     "https://www.redrobin.com/royalty",
  "Nothing Bundt Cakes":                           "https://www.nothingbundtcakes.com/eclub",
  "Firehouse Subs":                                "https://www.firehousesubs.com/rewards",
  "Jersey Mike's Subs":                            "https://www.jerseymikes.com/email-club",
  "Chipotle (birthday addition)":                  "https://www.chipotle.com/rewards",
  "Martin City Brewing Company":                   "https://www.martincitybrewingcompany.com/loyalty"
};

const file = 'kc-guide.html';
const lines = fs.readFileSync(file, 'utf8').split('\n');

let patched = 0;
const unmatched = [];

for (let i = 0; i < lines.length; i++) {
  const line = lines[i];
  const m = line.match(/^(\s*)<div style="font-size:0\.85rem;color:var\(--gold-bright\);margin-top:6px"><b>Sign up:<\/b>\s*(.+?)<\/div>\s*$/);
  if (!m) continue;
  const [, indent, signupText] = m;

  // Walk back up to 8 lines for the nearest .spot-name
  let chainName = null;
  for (let j = i - 1; j >= Math.max(0, i - 8); j--) {
    const nm = lines[j].match(/<div class="spot-name">([^<]+)<\/div>/);
    if (nm) {
      chainName = nm[1].trim().replace(/&amp;/g, '&');
      break;
    }
  }
  if (!chainName) { unmatched.push({ line: i + 1, signupText }); continue; }

  const url = URLS[chainName];
  if (!url) { unmatched.push({ line: i + 1, chainName }); continue; }

  lines[i] = `${indent}<a href="${url}" target="_blank" rel="noopener" class="spot-signup"><b>Sign up:</b> ${signupText} ↗</a>`;
  patched++;
}

fs.writeFileSync(file, lines.join('\n'));
console.log(`Patched ${patched} sign-up lines.`);
if (unmatched.length) {
  console.log('UNMATCHED:');
  for (const u of unmatched) console.log('  ', u);
}
