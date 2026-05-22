import fs from 'fs';

async function run() {
  const response = await fetch('https://theunitedstates.io/congress-legislators/legislators-current.json');
  const json = await response.json();
  const existing = JSON.parse(fs.readFileSync('src/data/subjects.json', 'utf8'));

  const newSubjects = json.map(leg => {
    const term = leg.terms[leg.terms.length - 1];
    const name = leg.name.official_full || `${leg.name.first} ${leg.name.last}`;
    return {
      id: leg.id.bioguide,
      name: name,
      type: 'Representative',
      state: term.state,
      party: term.party,
      description: `${term.type === 'sen' ? 'Senator' : 'Representative'} for ${term.state}.`
    };
  });

  const all = [...existing];
  newSubjects.forEach(s => {
    if (!all.find(x => x.id === s.id)) {
      all.push(s);
    }
  });

  fs.writeFileSync('src/data/subjects.json', JSON.stringify(all, null, 2));
  console.log(`Added ${newSubjects.length} representatives.`);
}

run();
