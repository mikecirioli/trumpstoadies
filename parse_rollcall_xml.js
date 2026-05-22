import fs from 'fs';
import xml2js from 'xml2js';
import yaml from 'js-yaml';

async function parseHouseXML(filePath, metadata) {
    const xmlData = fs.readFileSync(filePath, 'utf8');
    const parser = new xml2js.Parser();
    const result = await parser.parseStringPromise(xmlData);

    const voteData = result['rollcall-vote']['vote-data'][0]['recorded-vote'];
    const subjects = JSON.parse(fs.readFileSync('src/data/subjects.json', 'utf8'));
    const actions = [];

    voteData.forEach(rv => {
        const legislator = rv['legislator'][0];
        const bioguideId = legislator['$']['name-id'];
        const vote = rv['vote'][0];

        if (vote === 'Not Voting' || vote === 'Present') return;

        const subject = subjects.find(s => s.id === bioguideId);
        if (subject) {
            actions.push({
                id: `${metadata.prefix}-${bioguideId}`,
                subjectId: bioguideId,
                date: metadata.date,
                topic: metadata.topic,
                title: `Voted ${vote} on ${metadata.title}`,
                description: `Voted ${vote} on ${metadata.legisNum}: ${metadata.description}`,
                sourceUrl: metadata.sourceUrl,
                alignment: vote === metadata.proVote ? 'pro' : 'anti'
            });
        }
    });

    saveActions(actions, metadata.prefix);
}

async function parseSenateXML(filePath, metadata) {
    const xmlData = fs.readFileSync(filePath, 'utf8');
    const parser = new xml2js.Parser();
    const result = await parser.parseStringPromise(xmlData);

    const members = result.roll_call_vote.members[0].member;
    const subjects = JSON.parse(fs.readFileSync('src/data/subjects.json', 'utf8'));
    
    // Load mapping from YAML
    const legYaml = yaml.load(fs.readFileSync('legislators-current.yaml', 'utf8'));
    const lisMap = {};
    legYaml.forEach(leg => {
        if (leg.id.lis) {
            lisMap[leg.id.lis] = leg.id.bioguide;
        }
    });

    const actions = [];
    members.forEach(m => {
        const lisId = m.lis_member_id[0];
        const vote = m.vote_cast[0];
        const bioguideId = lisMap[lisId];

        if (vote === 'Not Voting' || vote === 'Present') return;

        if (bioguideId) {
            const subject = subjects.find(s => s.id === bioguideId);
            if (subject) {
                actions.push({
                    id: `${metadata.prefix}-${bioguideId}`,
                    subjectId: bioguideId,
                    date: metadata.date,
                    topic: metadata.topic,
                    title: `Voted ${vote} on ${metadata.title}`,
                    description: `Voted ${vote} on ${metadata.legisNum}: ${metadata.description}`,
                    sourceUrl: metadata.sourceUrl,
                    alignment: vote === metadata.proVote ? 'pro' : 'anti'
                });
            }
        } else {
            console.log(`Could not find Bioguide ID for LIS ID: ${lisId} (${m.member_full[0]})`);
        }
    });

    saveActions(actions, metadata.prefix);
}

function saveActions(newActions, prefix) {
    const existingActions = JSON.parse(fs.readFileSync('src/data/actions.json', 'utf8'));
    const filteredActions = existingActions.filter(a => !a.id.startsWith(prefix));
    const allActions = [...filteredActions, ...newActions];
    fs.writeFileSync('src/data/actions.json', JSON.stringify(allActions, null, 2));
    console.log(`Successfully added ${newActions.length} votes.`);
}

async function run() {
    const hr28Metadata = {
        prefix: 'hr28-119-1',
        date: '2025-01-14',
        topic: 'Social Issues',
        title: 'Protection of Women and Girls in Sports Act',
        legisNum: 'H.R. 28',
        description: 'Protection of Women and Girls in Sports Act of 2025',
        sourceUrl: 'https://clerk.house.gov/Votes/202512',
        proVote: 'Yea'
    };

    const hegsethMetadata = {
        prefix: 'sen-hegseth-119-1',
        date: '2025-01-24',
        topic: 'Nominations',
        title: 'Confirmation of Pete Hegseth as Secretary of Defense',
        legisNum: 'PN11-7',
        description: 'Confirmation of Pete Hegseth, of Tennessee, to be Secretary of Defense',
        sourceUrl: 'https://www.senate.gov/legislative/LIS/roll_call_votes/vote1191/vote_119_1_00015.xml',
        proVote: 'Yea'
    };

    const hr2616Metadata = {
        prefix: 'hr2616-119-2',
        date: '2026-05-20',
        topic: 'Social Issues',
        title: 'PROTECT Kids Act',
        legisNum: 'H.R. 2616',
        description: 'PROTECT Kids Act of 2026',
        sourceUrl: 'https://clerk.house.gov/Votes/2026184',
        proVote: 'Yea'
    };

    const sjres185Metadata = {
        prefix: 'sen-sjres185-119-2',
        date: '2026-05-19',
        topic: 'Foreign Policy',
        title: 'Iran War Powers Resolution (2026)',
        legisNum: 'S.J.Res. 185',
        description: 'Directing the removal of United States Armed Forces from hostilities within or against the Islamic Republic of Iran',
        sourceUrl: 'https://www.senate.gov/legislative/LIS/roll_call_votes/vote1192/vote_119_2_00129.xml',
        proVote: 'Yea' // Yea is for removal (anti-war/hostility)
    };

    await parseHouseXML('hr28_vote.xml', hr28Metadata);
    await parseSenateXML('senate_vote_15.xml', hegsethMetadata);
    await parseHouseXML('hr2616_vote.xml', hr2616Metadata);
    await parseSenateXML('senate_vote_129.xml', sjres185Metadata);
}

run();