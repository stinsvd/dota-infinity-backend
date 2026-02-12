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

// Save Player Data
app.post('/player/:steamId/save', authenticate, async (req, res) => {
    try {
        const { prestige, gold, experience, items } = req.body;
        const player = await Player.findOneAndUpdate(
            { steamId: req.params.steamId },
            {
                prestige,
                gold,
                experience,
                items,
                lastUpdated: Date.now()
            },
            { new: true, upsert: true }
        );
        res.json({ success: true, player });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Start Server
app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});
