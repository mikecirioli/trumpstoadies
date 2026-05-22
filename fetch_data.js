const fs = require('fs');
const https = require('https');
const path = require('path');

const filePath = path.join(__dirname, 'src', 'data', 'subjects.json');

function getAge(dateString) {
  if (!dateString) return 'Unknown';
  const today = new Date();
  const birthDate = new Date(dateString);
  let age = today.getFullYear() - birthDate.getFullYear();
  const m = today.getMonth() - birthDate.getMonth();
  if (m < 0 || (m === 0 && today.getDate() < birthDate.getDate())) {
    age--;
  }
  return age;
}

const adminOfficials = [
  { name: 'Donald Trump', role: 'President', age: getAge('1946-06-14'), party: 'Republican' },
  { name: 'JD Vance', role: 'Vice President', age: getAge('1984-08-02'), party: 'Republican', state: 'OH' },
  { name: 'Susie Wiles', role: 'White House Chief of Staff', age: getAge('1957-05-14'), party: 'Republican' },
  { name: 'Marco Rubio', role: 'Secretary of State', age: getAge('1971-05-28'), party: 'Republican', state: 'FL' },
  { name: 'Pete Hegseth', role: 'Secretary of Defense', age: getAge('1980-06-06'), party: 'Republican' },
  { name: 'Pam Bondi', role: 'Attorney General', age: getAge('1965-11-17'), party: 'Republican', state: 'FL' },
  { name: 'Howard Lutnick', role: 'Secretary of Commerce', age: getAge('1961-07-14'), party: 'Republican' },
  { name: 'Scott Bessent', role: 'Secretary of the Treasury', age: getAge('1962-01-01'), party: 'Republican' }, // approximate bday if unknown
  { name: 'Doug Burgum', role: 'Secretary of the Interior', age: getAge('1956-08-01'), party: 'Republican', state: 'ND' },
  { name: 'Robert F. Kennedy Jr.', role: 'Secretary of Health and Human Services', age: getAge('1954-01-17'), party: 'Independent' },
  { name: 'Chris Wright', role: 'Secretary of Energy', age: getAge('1960-01-01'), party: 'Republican' },
  { name: 'Kristi Noem', role: 'Secretary of Homeland Security', age: getAge('1971-11-30'), party: 'Republican', state: 'SD' },
  { name: 'Elise Stefanik', role: 'UN Ambassador', age: getAge('1984-07-02'), party: 'Republican', state: 'NY' },
  { name: 'Elon Musk', role: 'DOGE Co-Director', age: getAge('1971-06-28'), party: 'Republican' },
  { name: 'Vivek Ramaswamy', role: 'DOGE Co-Director', age: getAge('1985-08-09'), party: 'Republican', state: 'OH' },
  { name: 'Tulsi Gabbard', role: 'Director of National Intelligence', age: getAge('1981-04-12'), party: 'Republican', state: 'HI' },
  { name: 'Linda McMahon', role: 'Secretary of Education', age: getAge('1948-10-04'), party: 'Republican' },
  { name: 'Sean Duffy', role: 'Secretary of Transportation', age: getAge('1971-10-03'), party: 'Republican', state: 'WI' },
  { name: 'Lori Chavez-DeRemer', role: 'Secretary of Labor', age: getAge('1968-04-07'), party: 'Republican', state: 'OR' },
  { name: 'Brooke Rollins', role: 'Secretary of Agriculture', age: getAge('1972-01-01'), party: 'Republican' },
  { name: 'Scott Turner', role: 'Secretary of Housing and Urban Development', age: getAge('1972-02-26'), party: 'Republican' }
];

const mappedOfficials = adminOfficials.map(official => {
  const id = official.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
  return {
    id: id,
    name: official.name,
    type: 'Admin Official',
    state: official.state || '',
    party: official.party,
    description: `${official.role}, ${official.party}, Age: ${official.age}`
  };
});

https.get('https://theunitedstates.io/congress-legislators/legislators-current.json', (res) => {
  let data = '';
  res.on('data', chunk => {
    data += chunk;
  });
  
  res.on('end', () => {
    try {
      const legislators = JSON.parse(data);
      const mappedLegislators = legislators.map(leg => {
        const term = leg.terms[leg.terms.length - 1]; // Current term
        const name = leg.name.official_full || `${leg.name.first} ${leg.name.last}`;
        const age = getAge(leg.bio.birthday);
        const chamber = term.type === 'sen' ? 'Senate' : 'House';
        const party = term.party;
        
        return {
          id: leg.id.bioguide,
          name: name,
          type: 'Representative',
          state: term.state,
          party: party,
          description: `Chamber: ${chamber}, Party: ${party}, Age: ${age}`
        };
      });
      
      const combined = [...mappedOfficials, ...mappedLegislators];
      fs.writeFileSync(filePath, JSON.stringify(combined, null, 2));
      console.log('Successfully wrote data to ' + filePath);
    } catch (e) {
      console.error('Error parsing data:', e);
    }
  });
}).on('error', (e) => {
  console.error('Error fetching data:', e);
});
