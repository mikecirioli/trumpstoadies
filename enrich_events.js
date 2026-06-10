import { readFileSync, writeFileSync, existsSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));

const ACTIONS_PATH = join(__dirname, 'src/data/actions.json');
const META_PATH    = join(__dirname, 'src/data/events_meta.json');
const OLLAMA_URL   = 'http://localhost:11434/api/generate';
const MODEL        = 'mistral:7b-instruct';

// Determine if a vote is an "oppose" style resolution where Nay = Trump-aligned
function isOpposeBill(description) {
  return (
    /direct the removal/i.test(description) ||
    /terminating the national emergency/i.test(description) ||
    /terminate the national emergency/i.test(description)
  );
}

function buildPrompt(event, proVoteWord) {
  const antiVoteWord = proVoteWord === 'Yea' ? 'Nay' : 'Yea';
  return `You are a nonpartisan political analyst. Given this congressional vote:

Title: ${event.eventTitle}
Full description: ${event.rawDescription}
Topic: ${event.topic}
Chamber: ${event.chamber}
A "${proVoteWord}" vote is considered alignment with Trump's position.

Respond ONLY with valid JSON and no other text:
{
  "summary": "2 sentences: what this legislation actually does in plain English",
  "why_yes": "1 sentence: the strongest argument FOR voting ${proVoteWord} on this bill",
  "why_no": "1 sentence: the strongest argument AGAINST voting ${proVoteWord} on this bill (i.e. for voting ${antiVoteWord})",
  "trump_signal": "1 sentence: why voting ${proVoteWord} aligns with Trump's stated positions or agenda",
  "tags": ["tag1", "tag2", "tag3"]
}`;
}

async function callOllama(prompt) {
  const res = await fetch(OLLAMA_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: MODEL,
      prompt,
      stream: false,
      options: { temperature: 0.1 },
    }),
  });
  if (!res.ok) {
    throw new Error(`Ollama HTTP ${res.status}: ${await res.text()}`);
  }
  const data = await res.json();
  return data.response;
}

function parseJSON(raw) {
  // Strip markdown code fences if present
  const cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '').trim();
  // Find the first { ... } block
  const match = cleaned.match(/\{[\s\S]*\}/);
  if (!match) throw new Error('No JSON object found in response');
  return JSON.parse(match[0]);
}

async function main() {
  // 1. Load actions.json and deduplicate events
  const actions = JSON.parse(readFileSync(ACTIONS_PATH, 'utf8'));

  const eventMap = new Map(); // eventId -> event info
  actions.filter(a => a.eventId).forEach(action => {
    if (!eventMap.has(action.eventId)) {
      const chamber = action.chamber ?? (action.id.startsWith('sen-') ? 'senate' : 'house');
      // Strip "Voted X on ..." prefix from description
      const description = action.description
        .replace(/^Voted .*? on (the Motion to Discharge )?/, '')
        .replace(/^Voted .*? on /, '');

      eventMap.set(action.eventId, {
        eventId: action.eventId,
        eventTitle: action.eventTitle,
        description,
        rawDescription: action.description,
        topic: action.topic,
        chamber,
        sourceUrl: action.sourceUrl,
        proCount: 0,
        antiCount: 0,
      });
    }
    const ev = eventMap.get(action.eventId);
    if (action.alignment === 'pro') ev.proCount++;
    else ev.antiCount++;
  });

  // 2. Load existing events_meta.json (or empty)
  let meta = {};
  if (existsSync(META_PATH)) {
    try {
      meta = JSON.parse(readFileSync(META_PATH, 'utf8'));
    } catch (e) {
      console.warn('Warning: could not parse existing events_meta.json, starting fresh.');
      meta = {};
    }
  }

  // 3. Enrich each event not already in meta
  const events = Array.from(eventMap.values());
  const toEnrich = events.filter(ev => !meta[ev.eventId]);

  console.log(`${meta ? Object.keys(meta).length : 0} events already enriched.`);
  console.log(`${toEnrich.length} events to enrich out of ${events.length} total.`);

  let successCount = 0;
  let failCount = 0;

  for (let i = 0; i < toEnrich.length; i++) {
    const ev = toEnrich[i];
    const num = i + 1;

    // Determine proVoteWord: for oppose-style resolutions, Nay = Trump-aligned
    // (majority alignment==='pro' means those people voted Nay on the oppose bill)
    const isOppose = isOpposeBill(ev.rawDescription);
    const proVoteWord = isOppose ? 'Nay' : 'Yea';

    console.log(`Enriching ${num}/${toEnrich.length}: ${ev.eventTitle} (proVote=${proVoteWord})`);

    const prompt = buildPrompt(ev, proVoteWord);

    try {
      const raw = await callOllama(prompt);
      const parsed = parseJSON(raw);

      // Validate expected fields
      if (!parsed.summary || !parsed.trump_signal || !Array.isArray(parsed.tags)) {
        throw new Error(`Missing required fields in response: ${JSON.stringify(parsed)}`);
      }

      meta[ev.eventId] = {
        summary: parsed.summary,
        why_yes: parsed.why_yes ?? null,
        why_no: parsed.why_no ?? null,
        trump_signal: parsed.trump_signal,
        tags: parsed.tags,
        enriched: new Date().toISOString(),
      };

      // Write after every successful enrichment so progress is saved if interrupted
      writeFileSync(META_PATH, JSON.stringify(meta, null, 2), 'utf8');
      successCount++;
      console.log(`  OK: ${parsed.tags.join(', ')}`);
    } catch (err) {
      failCount++;
      console.error(`  FAILED: ${err.message}`);
      // Skip and continue — this event will fall back to raw description in UI
    }
  }

  console.log(`\nDone. ${successCount} succeeded, ${failCount} failed.`);
  console.log(`events_meta.json now has ${Object.keys(meta).length} entries.`);
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
