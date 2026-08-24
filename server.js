const express = require('express');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json({ limit: '1mb' }));

// Memory storage
// format: matches[match_ip][account_id] = { lastSeen: Date.now(), skins: { ... } }
const matches = {};

// 5 minutes TTL
const TTL_MS = 5 * 60 * 1000;

app.post('/api/sync', (req, res) => {
    try {
        const { match_ip, account_id, skins } = req.body;

        if (!match_ip || !account_id) {
            return res.status(400).json({ error: 'Missing match_ip or account_id' });
        }

        if (!matches[match_ip]) {
            matches[match_ip] = {};
        }

        // Upsert current player data
        matches[match_ip][account_id] = {
            lastSeen: Date.now(),
            skins: skins || {}
        };

        // Gather all other players' skins to return
        const responseData = { players: {} };
        const now = Date.now();

        for (const [otherAccountId, playerData] of Object.entries(matches[match_ip])) {
            // Skip sending the player's own skins back to them
            if (otherAccountId === String(account_id)) {
                continue;
            }

            // Optional: Skip players who timed out just in case the cleanup interval hasn't caught them
            if (now - playerData.lastSeen > TTL_MS) {
                continue;
            }

            responseData.players[otherAccountId] = playerData.skins;
        }

        res.json(responseData);

    } catch (err) {
        console.error('Error in /api/sync:', err);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});

// Cleanup routine
setInterval(() => {
    const now = Date.now();
    for (const matchIp in matches) {
        const matchData = matches[matchIp];
        for (const accountId in matchData) {
            if (now - matchData[accountId].lastSeen > TTL_MS) {
                delete matchData[accountId];
                console.log(`Cleaned up inactive player ${accountId} from match ${matchIp}`);
            }
        }
        
        // If match is empty, delete it
        if (Object.keys(matchData).length === 0) {
            delete matches[matchIp];
            console.log(`Cleaned up empty match ${matchIp}`);
        }
    }
}, 60 * 1000); // Check every minute

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Cloud Skins Server running on port ${PORT}`);
});
