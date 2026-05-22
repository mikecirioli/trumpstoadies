import fs from 'fs';
import yaml from 'js-yaml';

async function run() {
  const existing = JSON.parse(fs.readFileSync('src/data/subjects.json', 'utf8'));

  const fileContents = fs.readFileSync('legislators-current.yaml', 'utf8');
  const legislators = yaml.load(fileContents);

  const newSubjects = legislators.map(leg => {
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

  const cabinet = [
    { name: "Donald Trump", title: "President" },
    { name: "J.D. Vance", title: "Vice President" },
    { name: "Marco Rubio", title: "Secretary of State" },
    { name: "Scott Bessent", title: "Secretary of the Treasury" },
    { name: "Pete Hegseth", title: "Secretary of Defense" },
    { name: "Pam Bondi", title: "Attorney General" },
    { name: "Doug Burgum", title: "Secretary of the Interior" },
    { name: "Brooke Rollins", title: "Secretary of Agriculture" },
    { name: "Howard Lutnick", title: "Secretary of Commerce" },
    { name: "Lori Chavez-DeRemer", title: "Secretary of Labor" },
    { name: "Robert F. Kennedy Jr.", title: "Secretary of Health and Human Services" },
    { name: "Scott Turner", title: "Secretary of Housing and Urban Development" },
    { name: "Sean Duffy", title: "Secretary of Transportation" },
    { name: "Chris Wright", title: "Secretary of Energy" },
    { name: "Linda McMahon", title: "Secretary of Education" },
    { name: "Doug Collins", title: "Secretary of Veterans Affairs" },
    { name: "Markwayne Mullin", title: "Secretary of Homeland Security" },
    { name: "Susie Wiles", title: "White House Chief of Staff" },
    { name: "Lee Zeldin", title: "Administrator of the EPA" },
    { name: "Russ Vought", title: "Director of the OMB" },
    { name: "Tulsi Gabbard", title: "Director of National Intelligence" },
    { name: "John Ratcliffe", title: "Director of the CIA" },
    { name: "Vivek Ramaswamy", title: "Department of Government Efficiency" },
    { name: "Kash Patel", title: "FBI Director" },
    { name: "Tom Homan", title: "Border Czar" },
    { name: "Kristi Noem", title: "Special Envoy for the Shield of the Americas" },
    { name: "Michael Waltz", title: "UN Ambassador" }
  ].map(official => ({
    id: official.name.toLowerCase().replace(/[^a-z0-9]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, ''),
    name: official.name,
    type: 'Admin Official',
    party: 'Republican',
    description: official.title
  }));

  const all = [...existing];

  // Merge Congress
  newSubjects.forEach(s => {
    if (!all.find(x => x.id === s.id)) {
      all.push(s);
    }
  });

  // Merge Cabinet
  cabinet.forEach(s => {
    if (!all.find(x => x.id === s.id)) {
      all.push(s);
    }
  });

  fs.writeFileSync('src/data/subjects.json', JSON.stringify(all, null, 2));
  console.log(`Added ${newSubjects.length} representatives and ${cabinet.length} administration officials.`);
}

run();
