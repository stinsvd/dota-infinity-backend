require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const Player = require('./models/Player');

const app = express();
const PORT = process.env.PORT || 3000;
const API_KEY = process.env.API_KEY;

// Middleware
app.use(cors());
app.use(express.json());

// Auth Middleware
const authenticate = (req, res, next) => {
    const key = req.headers['x-api-key'];

    // Поддержка нового секретного ключа (теперь он должен быть в переменной API_KEY)
    if (key && key === API_KEY) {
        next();
    } else if (key === "dota_inf_8f23kLp92_secure_secret") {
        // Старый скомпрометированный ключ - блокируем или предупреждаем
        console.warn(`[Security] Blocked request using COMPROMISED old key from IP: ${req.ip}`);
        res.status(403).json({ error: 'Key Compromised. Update your Dedicated Server Key.' });
    } else {
        console.warn(`[Security] Unauthorized access attempt from IP: ${req.ip}`);
        res.status(403).json({ error: 'Unauthorized' });
    }
};

// Simple Rate Limiter (Since we can't install new packages easily)
const requestCounts = new Map();
const rateLimiter = (req, res, next) => {
    const ip = req.ip;
    const now = Date.now();
    const windowMs = 60 * 1000; // 1 minute
    const maxRequests = 30; // 30 requests per minute

    if (!requestCounts.has(ip)) {
        requestCounts.set(ip, { count: 1, firstRequest: now });
        return next();
    }

    const usage = requestCounts.get(ip);
    if (now - usage.firstRequest > windowMs) {
        usage.count = 1;
        usage.firstRequest = now;
        return next();
    }

    usage.count++;
    if (usage.count > maxRequests) {
        console.warn(`[Security] Rate limit exceeded for IP: ${ip}`);
        return res.status(429).json({ error: 'Too many requests' });
    }
    next();
};

app.use(rateLimiter);

// Database Connection
mongoose.connect(process.env.MONGODB_URI)
    .then(() => console.log('Connected to MongoDB Atlas'))
    .catch(err => console.error('Could not connect to MongoDB:', err));

// Routes
app.get('/', (req, res) => {
    res.send('Dota Infinity Backend is running!');
});

// Load Player Data
app.get('/player/:steamId', authenticate, async (req, res) => {
    try {
        let player = await Player.findOne({ steamId: req.params.steamId });

        // Handle Nickname Update (if provided in query)
        let nickname = req.query.nickname;
        if (nickname) {
            try {
                nickname = decodeURIComponent(nickname);
            } catch (e) {
                // Keep original if decode fails
            }
        }

        if (!player) {
            // Create new player entry if doesn't exist
            player = new Player({
                steamId: req.params.steamId,
                nickname: nickname || "Unknown"
            });
            await player.save();
        } else if (nickname && player.nickname !== nickname) {
            // Update existing nickname if changed
            player.nickname = nickname;
            await player.save();
        }

        res.json(player);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Update Player Stats & History
app.post('/player/:steamId/report-match', authenticate, async (req, res) => {
    try {
        const { win, prestige, kills, damage, hero, expGain, isMvp, nickname, serverKey } = req.body;

        // --- BASIC VALIDATION ---
        if (!hero || typeof win !== 'boolean') {
            return res.status(400).json({ error: 'Invalid match data' });
        }

        // Anti-Cheat: Simple logic check
        if (kills > 500 || damage > 10000000 || (expGain || 0) > 50000) {
            console.warn(`[Security] Suspicious stats reported for ${req.params.steamId}: Kills=${kills}, Exp=${expGain}`);
            // We still log it but maybe flag it or cap it
        }

        const player = await Player.findOne({ steamId: req.params.steamId });
        if (!player) return res.status(404).json({ error: 'Player not found' });

        // Update nickname if provided
        if (nickname) {
            player.nickname = nickname;
        }

        // Update Stats
        player.gamesPlayed += 1;
        if (win) player.wins += 1;
        if (isMvp) player.mvpCount = (player.mvpCount || 0) + 1;
        player.experience += Math.min(expGain || 0, 50000); // Cap experience gain

        // MMR Logic: +25 for win, -25 for loss (min 300)
        let mmrChange = win ? 25 : -25;
        player.rating = Math.max(300, (player.rating || 1500) + mmrChange);

        // Simple Level Logic: 1000 exp per level
        player.level = Math.floor(player.experience / 1000) + 1;

        // Add to History (Keep last 10)
        player.matchHistory.unshift({ hero, win, prestige, kills, damage });
        if (player.matchHistory.length > 10) {
            player.matchHistory.pop();
        }

        player.lastUpdated = Date.now();
        await player.save();

        // [MANDATORY] Invalidate Leaderboard Cache upon data update
        cache.overall.data = null;
        cache.weekly.data = null;
        console.log(`[Cache] Leaderboard invalidated after match report for ${req.params.steamId}`);

        res.json({ success: true, player });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// === MAINTENANCE & CLEANUP ===

// Reset suspicious stats (Admin only - requires a special header or just manual trigger)
app.post('/maintenance/cleanup-hacked-stats', authenticate, async (req, res) => {
    try {
        console.log("[Maintenance] Starting cleanup of highly suspicious stats...");

        // Example: Reset anyone with more than 500 wins or rating > 5000 (adjust thresholds as needed)
        const result = await Player.updateMany(
            {
                $or: [
                    { rating: { $gt: 5000 } },
                    { wins: { $gt: 1000 } },
                    { level: { $gt: 100 } }
                ]
            },
            {
                $set: {
                    rating: 1500,
                    wins: 0,
                    gamesPlayed: 0,
                    level: 1,
                    experience: 0,
                    matchHistory: []
                }
            }
        );

        res.json({
            success: true,
            message: `Cleanup complete. Modified ${result.modifiedCount} suspicious accounts.`,
            criteria: "Rating > 5000, Wins > 1000, or Level > 100"
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// === LEADERBOARD API ===

// Simple In-Memory Cache
const cache = {
    overall: { data: null, lastUpdated: 0 },
    weekly: { data: null, lastUpdated: 0 }
};
const CACHE_DURATION = 5 * 60 * 1000; // 5 Minutes

// Overall Top 10 (by rating)
app.get('/leaderboard/overall', authenticate, async (req, res) => {
    try {
        // Check Cache
        const now = Date.now();
        if (cache.overall.data && (now - cache.overall.lastUpdated < CACHE_DURATION)) {
            return res.json(cache.overall.data);
        }

        const players = await Player.find({ gamesPlayed: { $gte: 1 } })
            .sort({ rating: -1 })
            .limit(10)
            .select('steamId nickname rating gamesPlayed wins level');

        // Update Cache
        cache.overall.data = players;
        cache.overall.lastUpdated = now;

        res.json(players);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Weekly Top 10 (by wins in last 7 days)
app.get('/leaderboard/weekly', authenticate, async (req, res) => {
    try {
        // Check Cache
        const now = Date.now();
        if (cache.weekly.data && (now - cache.weekly.lastUpdated < CACHE_DURATION)) {
            return res.json(cache.weekly.data);
        }

        const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

        const results = await Player.aggregate([
            // Unwind matchHistory to filter by date
            { $unwind: '$matchHistory' },
            // Only matches from last 7 days AND ensure date exists
            {
                $match: {
                    'matchHistory.date': { $gte: sevenDaysAgo },
                    'matchHistory.win': true // Optimization: Only count wins
                }
            },
            // Group back by player
            {
                $group: {
                    _id: '$_id',
                    steamId: { $first: '$steamId' },
                    nickname: { $first: '$nickname' },
                    rating: { $first: '$rating' },
                    level: { $first: '$level' },
                    weeklyWins: { $sum: 1 } // Since we pre-filtered wins, just count
                }
            },
            // Sort by wins descending
            { $sort: { weeklyWins: -1 } },
            { $limit: 10 },
            // Project clean output
            {
                $project: {
                    _id: 0,
                    steamId: 1,
                    nickname: 1,
                    rating: 1,
                    level: 1,
                    weeklyWins: 1
                }
            }
        ]);

        // Update Cache
        cache.weekly.data = results;
        cache.weekly.lastUpdated = now;

        res.json(results);
    } catch (err) {
        console.error("Weekly Leaderboard Error:", err);
        res.status(500).json({ error: err.message });
    }
});

// Start Server
app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});
