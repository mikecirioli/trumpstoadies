import fs from 'fs';

const actions = JSON.parse(fs.readFileSync('src/data/actions.json', 'utf8'));

actions.forEach(a => {
  if (a.title.includes('Nay') || a.title.includes('against')) {
    a.alignment = 'pro'; // Supporting Trump's position
  } else if (a.title.includes('Yea') || a.title.includes('for')) {
    a.alignment = 'anti'; // Opposing Trump's position
  } else {
    a.alignment = 'pro'; // Default
  }
});

fs.writeFileSync('src/data/actions.json', JSON.stringify(actions, null, 2));
console.log('Updated actions with alignment.');
