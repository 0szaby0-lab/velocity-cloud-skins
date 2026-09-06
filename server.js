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
// Uptime ping route
app.get('/', (req, res) => {
    res.send('Velocity Cloud Skins Server is Awake! 🚀');
});

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

// Radar sessions storage
const radarSessions = {};

// POST from CS2 DLL
app.post('/api/radar', (req, res) => {
    try {
        const { session_id } = req.body;
        if (!session_id) {
            return res.status(400).json({ error: 'Missing session_id' });
        }
        
        radarSessions[session_id] = {
            lastUpdate: Date.now(),
            data: req.body
        };
        
        res.json({ success: true });
    } catch (err) {
        console.error('Error in /api/radar:', err);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});

// Serve the radar static files
app.use('/radar', express.static('public'));

app.get('/radar-view', (req, res) => {
    const path = require('path');
    res.sendFile(path.join(__dirname, 'public', 'radar.html'));
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

    // Cleanup radar sessions (5 min without update)
    for (const sessionId in radarSessions) {
        if (now - radarSessions[sessionId].lastUpdate > TTL_MS) {
            delete radarSessions[sessionId];
        }
    }
}, 60 * 1000); // Check every minute

const PORT = process.env.PORT || 3000;
const server = app.listen(PORT, () => {
    console.log(`Cloud Skins Server running on port ${PORT}`);
});

// Setup WebSocket server sharing the same HTTP server
const { WebSocketServer } = require('ws');
const wss = new WebSocketServer({ server, path: '/radar-ws' });

wss.on('connection', (ws, req) => {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const sessionId = url.searchParams.get('session');
    
    if (!sessionId) {
        ws.close();
        return;
    }
    
    ws.sessionId = sessionId;
});

// Broadcast radar updates periodically instead of on every POST to save bandwidth
setInterval(() => {
    wss.clients.forEach(client => {
        if (client.readyState === 1 && client.sessionId) {
            const data = radarSessions[client.sessionId];
            if (data && data.data) {
                client.send(JSON.stringify(data.data));
            }
        }
    });
}, 250); // Broadcast ~4 times a second to connected clients

