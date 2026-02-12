const mongoose = require('mongoose');

const playerSchema = new mongoose.Schema({
    steamId: {
        type: String,
        required: true,
        unique: true,
        index: true
    },
    level: {
        type: Number,
        default: 1
    },
    experience: {
        type: Number,
        default: 0
    },
    gamesPlayed: {
        type: Number,
        default: 0
    },
    wins: {
        type: Number,
        default: 0
    },
    mvpCount: {
        type: Number,
        default: 0
    },
    rating: {
        type: Number,
        default: 1500
    },
    matchHistory: [{
        hero: String,
        win: Boolean,
        prestige: Number,
        kills: Number,
        damage: Number,
        date: { type: Date, default: Date.now }
    }],
    lastUpdated: {
        type: Date,
        default: Date.now
    }
}, { timestamps: true });

module.exports = mongoose.model('Player', playerSchema);
