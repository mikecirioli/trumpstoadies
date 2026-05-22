import fs from 'fs';

const actions = JSON.parse(fs.readFileSync('src/data/actions.json', 'utf8'));

// Function to normalize title
function getBaseTitle(title) {
    if (title.includes('Iran War Powers Resolution')) return 'Iran War Powers Resolution';
    return title.replace(/^Voted .*? on /, '').replace(/^Voted .*? /, '').replace(/^Shifted investments to /, '');
}

actions.forEach(a => {
    const baseTitle = getBaseTitle(a.title);
    const date = a.date;
    // Create a URL-safe ID
    const eventId = `${date}-${baseTitle}`.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
    a.eventId = eventId;
    a.eventTitle = baseTitle;
});

fs.writeFileSync('src/data/actions.json', JSON.stringify(actions, null, 2));
console.log('Added eventId to all actions.');
