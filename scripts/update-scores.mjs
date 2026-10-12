// Използване на API-Football (или съвместимо API) за обновяване на резултатите в results.js
// Стартиране: API_KEY="твой_ключ" node scripts/update-scores.mjs
import fs from "node:fs";

const API_KEY = process.env.API_KEY || "c555eb96ef911901f49c67f05e4f6c6a";
if (!API_KEY) {
    console.error("Грешка: Липсва API_KEY. Използвайте: API_KEY=твоят_ключ node scripts/update-scores.mjs");
    process.exit(1);
}

const run = (file, w) => new Function("window", fs.readFileSync(file, "utf8"))(w);
const w = { RESULTS: {} }; 
try { run("results.js", w) } catch {}
run("fixtures.js", w);

const now = new Date().toISOString().slice(0, 16).replace("T", " ");
const over = m => { const k = new Date(`${m.d}T${m.t}:00Z`); k.setUTCHours(k.getUTCHours() + 2); return k.toISOString().slice(0, 16).replace("T", " ") <= now };
const pending = w.MATCHES.filter(m => m.hg == null && !m.pp && over(m));

if (!pending.length) { 
    console.log("Няма мачове за обновяване към момента."); 
    process.exit(0); 
}

async function fetchScores() {
    // Примерна заявка към API-Football за днешни или активни мачове
    const url = "https://v3.football.api-sports.io/fixtures?season=2026&league=172"; // Замени лигата с правилния ID за българската Първа лига в API-то
    const response = await fetch(url, {
        headers: {
            "x-apisports-key": API_KEY
        }
    });

    if (!response.ok) throw new Error(`API отговори с грешка: ${response.status}`);
    const data = await response.json();
    return data.response || [];
}

try {
    const apiFixtures = await fetchScores();
    const out = { ...w.RESULTS };
    let updatedCount = 0;

    // Обхождане на чакащите мачове и сравняване с данните от API
    pending.forEach(m => {
        const matchFound = apiFixtures.find(f => {
            // Тук може да се направи съпоставка по отбори и дата
            return f.fixture.date.slice(0, 10) === m.d;
        });

        if (matchFound && matchFound.fixture.status.short === "FT") {
            const k = `${m.r}:${m.h}-${m.a}`;
            const hg = matchFound.goals.home;
            const ag = matchFound.goals.away;
            if (hg != null && ag != null) {
                out[k] = `${hg}-${ag}`;
                updatedCount++;
            }
        }
    });

    fs.writeFileSync("results.js", `// Written by scripts/update-scores.mjs. Key "round:HOME-AWAY" -> "hg-ag" or "pp".\nwindow.RESULTS = ${JSON.stringify(out, null, 1)};\n`);
    console.log(`Успешно обновени ${updatedCount} мача във файла results.js`);

} catch (err) {
    console.error("Възникна грешка при заявката към API:", err.message);
    process.exit(1);
}