import fs from 'fs';

const text = fs.readFileSync('house_vote_v2.txt', 'utf8');
const lines = text.split('\n').map(l => l.trim()).filter(l => l);

const votes = [];
let inTable = false;

for (const line of lines) {
  if (line.startsWith('Representative\tParty\tState\tVote')) {
    inTable = true;
    continue;
  }
  if (inTable && line.startsWith('U.S. Capitol')) {
    break;
  }

  if (inTable && line.includes('\t')) {
    const parts = line.split('\t');
    if (parts.length >= 4) {
      votes.push({
        nameRaw: parts[0].trim(),
        party: parts[1].trim(),
        stateFull: parts[2].trim(),
        vote: parts[3].trim()
      });
    }
  }
}

const subjects = JSON.parse(fs.readFileSync('src/data/subjects.json', 'utf8'));
const houseMembers = subjects.filter(s => s.type === 'Representative');

const stateMap = {
  "Alabama": "AL", "Alaska": "AK", "Arizona": "AZ", "Arkansas": "AR", "California": "CA",
  "Colorado": "CO", "Connecticut": "CT", "Delaware": "DE", "Florida": "FL", "Georgia": "GA",
  "Hawaii": "HI", "Idaho": "ID", "Illinois": "IL", "Indiana": "IN", "Iowa": "IA",
  "Kansas": "KS", "Kentucky": "KY", "Louisiana": "LA", "Maine": "ME", "Maryland": "MD",
  "Massachusetts": "MA", "Michigan": "MI", "Minnesota": "MN", "Mississippi": "MS", "Missouri": "MO",
  "Montana": "MT", "Nebraska": "NE", "Nevada": "NV", "New Hampshire": "NH", "New Jersey": "NJ",
  "New Mexico": "NM", "New York": "NY", "North Carolina": "NC", "North Dakota": "ND", "Ohio": "OH",
  "Oklahoma": "OK", "Oregon": "OR", "Pennsylvania": "PA", "Rhode Island": "RI", "South Carolina": "SC",
  "South Dakota": "SD", "Tennessee": "TN", "Texas": "TX", "Utah": "UT", "Vermont": "VT",
  "Virginia": "VA", "Washington": "WA", "West Virginia": "WV", "Wisconsin": "WI", "Wyoming": "WY"
};

const matchedActions = [];
let unmatched = 0;

for (const v of votes) {
  if (v.vote === 'Not Voting') continue;

  const stateAbbr = stateMap[v.stateFull];
  let searchName = v.nameRaw.replace(/\(.*?\)/, '').trim();
  
  let firstNameHint = null;
  if (searchName.includes(',')) {
    const parts = searchName.split(',');
    searchName = parts[0].trim();
    firstNameHint = parts[1].trim().toLowerCase();
  }

  const qName = searchName.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();

  let possibleMatches = houseMembers.filter(s => s.state === stateAbbr);
  
  possibleMatches = possibleMatches.filter(s => {
    const dbFullName = s.name.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
    const dbParts = dbFullName.split(' ');
    const dbLastName = dbParts[dbParts.length - 1];

    const isExactLast = dbLastName === qName;
    const includesName = dbFullName.includes(qName);

    if (firstNameHint) {
        return includesName && dbFullName.includes(firstNameHint);
    }
    return isExactLast || includesName;
  });

  if (possibleMatches.length > 1) {
      const refined = possibleMatches.filter(s => {
          const dbFullName = s.name.toLowerCase();
          return dbFullName.endsWith(' ' + qName) || dbFullName === qName;
      });
      if (refined.length === 1) possibleMatches = refined;
  }

  if (possibleMatches.length === 1) {
    const subject = possibleMatches[0];
    matchedActions.push({
        id: `hr-iran-res-38-${subject.id}`,
        subjectId: subject.id,
        date: "2026-03-05",
        topic: "Foreign Policy",
        title: `Voted ${v.vote} on Iran War Powers Resolution`,
        description: `Voted ${v.vote} on H. Con. Res. 38: Directing the President pursuant to section 5(c) of the War Powers Resolution to remove United States Armed Forces from unauthorized hostilities in the Islamic Republic of Iran.`,
        sourceUrl: "https://clerk.house.gov/Votes/202685",
        alignment: v.vote === 'Nay' ? 'pro' : 'anti'
    });
  } else {
    console.log(`Failed to match: ${v.nameRaw} (State: ${stateAbbr}) -> Found: ${possibleMatches.map(p=>p.name).join(', ')}`);
    unmatched++;
  }
}

const existingActions = JSON.parse(fs.readFileSync('src/data/actions.json', 'utf8'));
const filteredExisting = existingActions.filter(a => !a.id.startsWith('hr-iran-res-38-'));

const allActions = [...filteredExisting, ...matchedActions];
  
fs.writeFileSync('src/data/actions.json', JSON.stringify(allActions, null, 2));

console.log(`Successfully mapped ${matchedActions.length} House votes using exact states. Unmatched: ${unmatched}`);