import fs from 'fs';

const text = fs.readFileSync('house_vote.txt', 'utf8');
const lines = text.split('\n').map(l => l.trim()).filter(l => l);

let currentVote = null;
const votes = [];

for (const line of lines) {
  if (line.startsWith('---- YEAS')) {
    currentVote = 'Yea';
    continue;
  } else if (line.startsWith('---- NAYS')) {
    currentVote = 'Nay';
    continue;
  } else if (line.startsWith('---- NOT VOTING')) {
    currentVote = 'Not Voting';
    continue;
  }

  if (line.startsWith('FINAL VOTE') || line.startsWith('(Republicans') || line.startsWith('H CON RES') || line.startsWith('QUESTION') || line.startsWith('BILL TITLE') || line.startsWith('Yeas\tNays') || line.startsWith('Republican') || line.startsWith('Democratic') || line.startsWith('Independent') || line.startsWith('TOTALS')) {
      continue;
  }

  if (currentVote && !line.startsWith('----') && line.length > 1) {
    votes.push({ nameRaw: line, vote: currentVote });
  }
}

const subjects = JSON.parse(fs.readFileSync('src/data/subjects.json', 'utf8'));
const houseMembers = subjects.filter(s => s.type === 'Representative');

const matchedActions = [];
let unmatched = 0;

for (const v of votes) {
  if (v.vote === 'Not Voting') continue;

  let searchName = v.nameRaw;
  let state = null;

  const matchState = searchName.match(/\((.*?)\)/);
  if (matchState) {
    state = matchState[1];
    searchName = searchName.replace(/\(.*?\)/, '').trim();
  }

  // Handle names like "Frankel, Lois" or "Scott, David"
  let firstNameHint = null;
  if (searchName.includes(',')) {
    const parts = searchName.split(',');
    searchName = parts[0].trim();
    firstNameHint = parts[1].trim().toLowerCase();
  }

  const qName = searchName.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();

  let possibleMatches = houseMembers.filter(s => {
    // 1. Check state if provided in the list
    if (state && s.state !== state) return false;
    
    const dbFullName = s.name.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
    const dbParts = dbFullName.split(' ');
    const dbLastName = dbParts[dbParts.length - 1];

    // 2. Precise match on last name
    const isExactLast = dbLastName === qName;
    
    // 3. Or it's a compound last name or includes it
    const includesName = dbFullName.includes(qName);

    if (firstNameHint) {
        return includesName && dbFullName.includes(firstNameHint);
    }

    return isExactLast || (includesName && !state); // If no state provided, we are more cautious
  });

  // If still ambiguous, try to match precisely if we have a state
  if (possibleMatches.length > 1 && state) {
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
    console.log(`Failed to match: ${v.nameRaw} (State: ${state}) -> Found: ${possibleMatches.map(p=>p.name).join(', ')}`);
    unmatched++;
  }
}

const existingActions = JSON.parse(fs.readFileSync('src/data/actions.json', 'utf8'));
// Keep the 99 Senate actions we already matched
const senateActions = existingActions.filter(a => a.id.startsWith('sen-iran-res-104-'));
const otherActions = existingActions.filter(a => !a.id.startsWith('sen-iran-res-104-') && !a.id.startsWith('hr-iran-res-38-'));

const allActions = [...senateActions, ...otherActions, ...matchedActions];
  
fs.writeFileSync('src/data/actions.json', JSON.stringify(allActions, null, 2));

console.log(`Matched ${matchedActions.length} House votes. Unmatched: ${unmatched}`);
