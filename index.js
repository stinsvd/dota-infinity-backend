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
    if (key && key === API_KEY) {
        next();
    } else {
        res.status(403).json({ error: 'Unauthorized' });
    }
};

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
        if (!player) {
            // Create new player entry if doesn't exist
            player = new Player({ steamId: req.params.steamId });
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
        const { win, prestige, kills, damage, hero, expGain, isMvp } = req.body;

        const player = await Player.findOne({ steamId: req.params.steamId });
        if (!player) return res.status(404).json({ error: 'Player not found' });

        // Update Stats
        player.gamesPlayed += 1;
        if (win) player.wins += 1;
        if (isMvp) player.mvpCount = (player.mvpCount || 0) + 1;
        player.experience += (expGain || 0);

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

        res.json({ success: true, player });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Start Server
app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});
