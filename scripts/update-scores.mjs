// Fills in scores for finished matches and writes results.js.   Node 18+, run from the project folder.
//   node scripts/update-scores.mjs                      -> reads parvaliga.bg/rezultati directly: free, no AI, no key (default)
//   PROVIDER=gemini GEMINI_API_KEY=... node ...         -> asks Gemini with Google Search (may need billing)
//   PROVIDER=claude ANTHROPIC_API_KEY=... node ...      -> asks Claude with web search (needs credit); MODEL=... overrides the model
// Safety: it only fills matches that should be over and have no score yet, and never overwrites a score.
import fs from "node:fs";
const P = process.env.PROVIDER || "scrape", KEY = process.env.ANTHROPIC_API_KEY, GEM = process.env.GEMINI_API_KEY;
const MODEL = process.env.MODEL || (P == "gemini" ? "gemini-flash-latest" : "claude-sonnet-5-5");
if (P == "gemini" && !GEM) throw new Error("Set GEMINI_API_KEY"); if (P == "claude" && !KEY) throw new Error("Set ANTHROPIC_API_KEY");
const run = (file, w) => new Function("window", fs.readFileSync(file, "utf8"))(w);
const w = { RESULTS: {} }; try { run("results.js", w) } catch { }
run("fixtures.js", w);
// "now" in Bulgarian time as "YYYY-MM-DD HH:MM" (set NOW="2026-10-12 23:59" to backfill/test)
const now = process.env.NOW || new Date().toLocaleString("sv-SE", { timeZone: "Europe/Sofia" }).slice(0, 16);
const over = m => { const k = new Date(`${m.d}T${m.t}:00Z`); k.setUTCHours(k.getUTCHours() + 2); return k.toISOString().slice(0, 16).replace("T", " ") <= now };
const pending = w.MATCHES.filter(m => m.hg == null && !m.pp && over(m));
if (!pending.length) { console.log("Nothing to update"); process.exit(0) }

// --- source 1: the league's own results page (match links look like /machove/botev-plovdiv-slavia-sofia-2026-10-10/) ---
const SLUG = { "ludogorets": "LUD", "levski-sofia": "LEV", "cska-sofia": "CSK", "cska-1948": "C48", "slavia-sofia": "SLA", "lokomotiv-plovdiv": "LPD", "lokomotiv-sofia": "LSF", "botev-plovdiv": "BPD", "botev-vratsa": "BVR", "cherno-more-varna": "CHM", "arda-kardzhali": "ARD", "dunav-ruse": "DUN", "septemvri-sofia": "SEP", "spartak-varna": "SPV" };
async function scrape() {
    const r = await fetch("https://parvaliga.bg/rezultati/", { headers: { "user-agent": "Mozilla/5.0 (compatible; efbet-fantasy-score-bot)" } });
    if (!r.ok) throw new Error(`parvaliga.bg answered ${r.status}`);
    const html = await r.text(), re = /href="[^"]*\/machove\/([a-z0-9-]+?)-\d{4}-\d{2}-\d{2}\/?"/g, found = []; let last = 0, m, links = 0;
    while ((m = re.exec(html))) {
        links++; const text = html.slice(last, m.index).replace(/<[^>]*>/g, " ").replace(/&[#a-z0-9]+;/g, " ").replace(/\s+/g, " "); last = m.index + m[0].length;
        const home = Object.keys(SLUG).find(s => m[1].startsWith(s + "-") && SLUG[m[1].slice(s.length + 1)]), sc = text.match(/(?<![\d.:-])(\d{1,2}) (\d{1,2})(?![\d.:])/);
        if (home && sc) found.push({ h: SLUG[home], a: SLUG[m[1].slice(home.length + 1)], hg: +sc[1], ag: +sc[2] })
    }
    console.log(`Page: ${links} match links, ${found.length} with a readable score`);
    if (links && !found.length) console.log("The page layout is not what the script expects. Save the page source and send it for a fix.");
    return found.flatMap(f => { const p = pending.find(x => x.h == f.h && x.a == f.a); return p ? [{ ...f, r: p.r }] : [] })
}
// --- source 2 (optional): an AI with web search ---
const prompt = `Find the final scores of these efbet Liga (Bulgarian First League, 2026/27) matches. Use parvaliga.bg or sofascore.com. Only report a match if it has finished; otherwise give null.
Matches (round | date | HOME-AWAY codes):
${pending.map(m => `${m.r} | ${m.d} | ${m.h}-${m.a}`).join("\n")}
Codes: LUD Ludogorets, LEV Levski Sofia, CSK CSKA Sofia, C48 CSKA 1948, SLA Slavia Sofia, LPD Lokomotiv Plovdiv, LSF Lokomotiv Sofia, BPD Botev Plovdiv, BVR Botev Vratsa, CHM Cherno More, ARD Arda Kardzhali, DUN Dunav Ruse, SEP Septemvri Sofia, SPV Spartak Varna. The first code is the home team.
Reply with ONLY a JSON array and no other text, like [{"r":11,"h":"SEP","a":"DUN","hg":2,"ag":1}]. Use null for hg and ag if not finished, and add "pp":true if postponed.`;
async function ask() {
    if (P == "gemini") {
        const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`, { method: "POST", headers: { "x-goog-api-key": GEM, "content-type": "application/json" }, body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }], tools: [{ google_search: {} }] }) });
        if (!r.ok) throw new Error(`Gemini ${r.status}: ${await r.text()}`);
        const j = await r.json(); return ((j.candidates && j.candidates[0] && j.candidates[0].content && j.candidates[0].content.parts) || []).map(p => p.text || "").join("")
    }
    let messages = [{ role: "user", content: prompt }], text = "";
    for (let i = 0; i < 4; i++) {
        const r = await fetch("https://api.anthropic.com/v1/messages", { method: "POST", headers: { "x-api-key": KEY, "anthropic-version": "2023-06-01", "content-type": "application/json" }, body: JSON.stringify({ model: MODEL, max_tokens: 2000, tools: [{ type: "web_search_20250305", name: "web_search", max_uses: 6 }], messages }) });
        if (!r.ok) throw new Error(`API ${r.status}: ${await r.text()}`);
        const j = await r.json(); text = j.content.filter(b => b.type == "text").map(b => b.text).join("");
        if (j.stop_reason != "pause_turn") break;
        messages = [...messages, { role: "assistant", content: j.content }];
    }
    return text
}
let arr = []; if (P == "scrape") arr = await scrape(); else { const text = await ask(); try { arr = JSON.parse((text.match(/\[[\s\S]*\]/) || ["[]"])[0]) } catch { console.log("Could not parse the reply:", text.slice(0, 300)) } }

const asked = new Set(pending.map(m => `${m.r}:${m.h}-${m.a}`)), out = { ...w.RESULTS }, ok = v => Number.isInteger(v) && v >= 0 && v <= 15; let n = 0;
for (const x of arr) {
    const k = `${x.r}:${x.h}-${x.a}`; if (!asked.has(k)) continue;      // ignore anything we didn't ask about
    if (x.pp === true) { out[k] = "pp"; n++ } else if (ok(x.hg) && ok(x.ag)) { out[k] = `${x.hg}-${x.ag}`; n++ }
}
fs.writeFileSync("results.js", `// Written by scripts/update-scores.mjs. Key "round:HOME-AWAY" -> "hg-ag" or "pp".\nwindow.RESULTS = ${JSON.stringify(out, null, 1)};\n`);
console.log(`Updated ${n} of ${pending.length} pending matches`);
