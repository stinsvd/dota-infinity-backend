const mongoose = require('mongoose');

const playerSchema = new mongoose.Schema({
    steamId: {
        type: String,
        required: true,
        unique: true,
        index: true
    },
    prestige: {
        type: Number,
        default: 0
    },
    gold: {
        type: Number,
        default: 0
    },
    experience: {
        type: Number,
        default: 0
    },
    items: {
        type: Array,
        default: []
    },
    lastUpdated: {
        type: Date,
        default: Date.now
    }
}, { timestamps: true });

module.exports = mongoose.model('Player', playerSchema);
