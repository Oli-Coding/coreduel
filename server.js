const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const path = require('path');

const JWT_SECRET = 'coreduel_ultra_secret_key_1337';
const PORT = process.env.PORT || 8000;

// Initialize Database — use persistent disk path on Render, local otherwise
const dbPath = process.env.DATABASE_URL || path.join(__dirname, 'database.sqlite');
const db = new sqlite3.Database(dbPath, (err) => {
    if (err) {
        console.error('Error opening SQLite database:', err.message);
    } else {
        console.log('Connected to the SQLite database.');
        initializeDatabaseSchema();
    }
});

function initializeDatabaseSchema() {
    db.run(`
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            email TEXT UNIQUE NOT NULL,
            password_hash TEXT NOT NULL,
            name TEXT NOT NULL,
            elo INTEGER DEFAULT 200,             -- Combined Elo (Math + IQ)
            coins INTEGER DEFAULT 1000,
            level INTEGER DEFAULT 1,
            xp INTEGER DEFAULT 0,
            streak INTEGER DEFAULT 0,
            math_best INTEGER DEFAULT 100,       -- Math Elo (starts at 100)
            iq_best INTEGER DEFAULT 100,         -- IQ Elo (starts at 100)
            equipped_frame TEXT DEFAULT 'default',
            equipped_title TEXT DEFAULT 'Novice Dueler',
            equipped_background TEXT DEFAULT 'default',
            inventory TEXT DEFAULT '["default","Novice Dueler","bg-default"]',
            pass_claims TEXT DEFAULT '[]',
            streak_checkins TEXT DEFAULT '[false,false,false,false,false,false,false]',
            avatar_seed TEXT NOT NULL,
            premium INTEGER DEFAULT 0            -- 0 = Regular, 1 = Premium
        )
    `, (err) => {
        if (err) console.error('Error creating users table:', err.message);
    });
}

// Express app setup
const app = express();
const server = http.createServer(app);
const io = socketIo(server);

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Middleware for JWT Authentication
function authenticateToken(req, res, next) {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];
    
    if (!token) return res.status(401).json({ error: 'Access denied. Token missing.' });
    
    jwt.verify(token, JWT_SECRET, (err, user) => {
        if (err) return res.status(403).json({ error: 'Invalid or expired token.' });
        req.user = user;
        next();
    });
}

// ==================== REST AUTH ENDPOINTS ====================

app.post('/api/auth/register', (req, res) => {
    const { email, password, name, avatarSeed } = req.body;
    if (!email || !password || !name) {
        return res.status(400).json({ error: 'All fields are required.' });
    }
    
    db.get('SELECT id FROM users WHERE email = ?', [email.toLowerCase()], (err, row) => {
        if (err) return res.status(500).json({ error: err.message });
        if (row) return res.status(400).json({ error: 'Email already registered.' });
        
        bcrypt.hash(password, 10, (err, hash) => {
            if (err) return res.status(500).json({ error: err.message });
            
            const seed = avatarSeed || name;
            db.run(
                `INSERT INTO users (email, password_hash, name, avatar_seed) VALUES (?, ?, ?, ?)`,
                [email.toLowerCase(), hash, name, seed],
                function(err) {
                    if (err) return res.status(500).json({ error: err.message });
                    const token = jwt.sign({ id: this.lastID, email }, JWT_SECRET);
                    res.json({ token, user: { id: this.lastID, email, name, avatarSeed: seed } });
                }
            );
        });
    });
});

app.post('/api/auth/login', (req, res) => {
    const { email, password } = req.body;
    if (!email || !password) {
        return res.status(400).json({ error: 'Email and password are required.' });
    }
    
    db.get('SELECT * FROM users WHERE email = ?', [email.toLowerCase()], (err, user) => {
        if (err) return res.status(500).json({ error: err.message });
        if (!user) return res.status(400).json({ error: 'User not found.' });
        
        bcrypt.compare(password, user.password_hash, (err, isMatch) => {
            if (err) return res.status(500).json({ error: err.message });
            if (!isMatch) return res.status(400).json({ error: 'Incorrect password.' });
            
            const token = jwt.sign({ id: user.id, email: user.email }, JWT_SECRET);
            res.json({
                token,
                user: {
                    id: user.id,
                    email: user.email,
                    name: user.name,
                    elo: user.elo,
                    coins: user.coins,
                    level: user.level,
                    xp: user.xp,
                    streak: user.streak,
                    mathBest: user.math_best,
                    iqBest: user.iq_best,
                    equippedFrame: user.equipped_frame,
                    equippedTitle: user.equipped_title,
                    equippedBackground: user.equipped_background,
                    inventory: JSON.parse(user.inventory),
                    passClaims: JSON.parse(user.pass_claims),
                    streakCheckins: JSON.parse(user.streak_checkins),
                    avatarSeed: user.avatar_seed,
                    premium: user.premium || 0
                }
            });
        });
    });
});

// Profile endpoints
app.get('/api/user/profile', authenticateToken, (req, res) => {
    db.get('SELECT * FROM users WHERE id = ?', [req.user.id], (err, user) => {
        if (err) return res.status(500).json({ error: err.message });
        if (!user) return res.status(404).json({ error: 'User not found.' });
        
        res.json({
            id: user.id,
            email: user.email,
            name: user.name,
            elo: user.elo,
            coins: user.coins,
            level: user.level,
            xp: user.xp,
            streak: user.streak,
            mathBest: user.math_best,
            iqBest: user.iq_best,
            equippedFrame: user.equipped_frame,
            equippedTitle: user.equipped_title,
            equippedBackground: user.equipped_background,
            inventory: JSON.parse(user.inventory),
            passClaims: JSON.parse(user.pass_claims),
            streakCheckins: JSON.parse(user.streak_checkins),
            avatarSeed: user.avatar_seed,
            premium: user.premium || 0
        });
    });
});

app.post('/api/user/profile', authenticateToken, (req, res) => {
    const { 
        name, coins, level, xp, streak, mathBest, iqBest, 
        equippedFrame, equippedTitle, equippedBackground, 
        inventory, passClaims, streakCheckins, avatarSeed, premium 
    } = req.body;
    
    db.run(`
        UPDATE users SET 
            name = COALESCE(?, name),
            coins = COALESCE(?, coins),
            level = COALESCE(?, level),
            xp = COALESCE(?, xp),
            streak = COALESCE(?, streak),
            math_best = COALESCE(?, math_best),
            iq_best = COALESCE(?, iq_best),
            equipped_frame = COALESCE(?, equipped_frame),
            equipped_title = COALESCE(?, equipped_title),
            equipped_background = COALESCE(?, equipped_background),
            inventory = COALESCE(?, inventory),
            pass_claims = COALESCE(?, pass_claims),
            streak_checkins = COALESCE(?, streak_checkins),
            avatar_seed = COALESCE(?, avatar_seed),
            premium = COALESCE(?, premium)
        WHERE id = ?
    `, [
        name, coins, level, xp, streak, mathBest, iqBest, 
        equippedFrame, equippedTitle, equippedBackground, 
        inventory ? JSON.stringify(inventory) : null,
        passClaims ? JSON.stringify(passClaims) : null,
        streakCheckins ? JSON.stringify(streakCheckins) : null,
        avatarSeed, premium,
        req.user.id
    ], function(err) {
        if (err) return res.status(500).json({ error: err.message });
        
        // Always enforce combined Global Elo = Math Elo + IQ Elo
        db.run(`
            UPDATE users SET elo = math_best + iq_best WHERE id = ?
        `, [req.user.id], (err2) => {
            if (err2) return res.status(500).json({ error: err2.message });
            res.json({ success: true });
        });
    });
});

// Leaderboard API
app.get('/api/leaderboard', (req, res) => {
    const mode = req.query.mode || 'global';
    let query = 'SELECT name, elo, streak, equipped_title as title, equipped_frame as frame, equipped_background as background, avatar_seed as avatarSeed, math_best as mathBest, iq_best as iqBest, premium FROM users ';
    if (mode === 'math') {
        query += 'ORDER BY math_best DESC, elo DESC LIMIT 20';
    } else if (mode === 'iq') {
        query += 'ORDER BY iq_best DESC, elo DESC LIMIT 20';
    } else {
        query += 'ORDER BY elo DESC LIMIT 20';
    }
    db.all(query, [], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows);
    });
});

// ==================== WEBSOCKET GAME ENGINE ====================

// Matchmaking Queue structures
let queues = {
    math: [],
    iq: []
};

let activeMatches = {};
let closedMatches = {};

// Simpler IQ questions to make playing enjoyable
const IQ_QUESTIONS = [
    { q: "2, 4, 6, 8, ?", a: 10, choices: [9, 10, 11, 12] },
    { q: "1, 3, 5, 7, ?", a: 9, choices: [8, 9, 10, 11] },
    { q: "5, 10, 15, 20, ?", a: 25, choices: [22, 24, 25, 30] },
    { q: "10, 20, 30, 40, ?", a: 50, choices: [45, 48, 50, 60] },
    { q: "3, 6, 9, 12, ?", a: 15, choices: [14, 15, 16, 18] },
    { q: "2, 5, 8, 11, ?", a: 14, choices: [12, 13, 14, 15] },
    { q: "10, 9, 8, 7, ?", a: 6, choices: [5, 6, 7, 8] },
    { q: "1, 2, 3, 4, ?", a: 5, choices: [4, 5, 6, 7] },
    { q: "20, 18, 16, 14, ?", a: 12, choices: [10, 11, 12, 13] },
    { q: "1, 4, 7, 10, ?", a: 13, choices: [11, 12, 13, 14] }
];

// Easy math generators
function generateQuestion(mode, roundNumber = 1) {
    if (mode === 'math') {
        const op = ['+', '-', '*'][Math.floor(Math.random() * 3)];
        let num1, num2, correctAns, questionText;
        
        if (op === '+') {
            num1 = Math.floor(Math.random() * 20) + 2;
            num2 = Math.floor(Math.random() * 20) + 2;
            questionText = `${num1} + ${num2}`;
            correctAns = num1 + num2;
        } else if (op === '-') {
            num1 = Math.floor(Math.random() * 25) + 10;
            num2 = Math.floor(Math.random() * num1); // Always positive result
            questionText = `${num1} - ${num2}`;
            correctAns = num1 - num2;
        } else {
            num1 = Math.floor(Math.random() * 7) + 2; // small factors
            num2 = Math.floor(Math.random() * 6) + 2;
            questionText = `${num1} × ${num2}`;
            correctAns = num1 * num2;
        }
        
        const choices = new Set();
        choices.add(correctAns);
        while (choices.size < 4) {
            const variance = Math.floor(Math.random() * 5) + 1;
            const choice = Math.random() > 0.5 ? correctAns + variance : correctAns - variance;
            if (choice >= 0) choices.add(choice);
        }
        return {
            q: questionText,
            a: correctAns,
            choices: Array.from(choices).sort(() => Math.random() - 0.5)
        };
    } else {
        // IQ grid memory sequence of indices from 0 to 8
        const len = Math.min(9, roundNumber + 2);
        const indices = [0, 1, 2, 3, 4, 5, 6, 7, 8];
        const shuffled = indices.sort(() => Math.random() - 0.5);
        const seq = shuffled.slice(0, len);
        return {
            isIqGrid: true,
            sequence: seq,
            round: roundNumber
        };
    }
}

function getEloRank(elo) {
    if (elo < 100) return { name: "Bronze I", css: "rank-bronze" };
    if (elo < 200) return { name: "Bronze II", css: "rank-bronze" };
    if (elo < 300) return { name: "Bronze III", css: "rank-bronze" };
    if (elo < 450) return { name: "Silber I", css: "rank-silber" };
    if (elo < 600) return { name: "Silber II", css: "rank-silber" };
    if (elo < 750) return { name: "Silber III", css: "rank-silber" };
    if (elo < 950) return { name: "Gold I", css: "rank-gold" };
    if (elo < 1150) return { name: "Gold II", css: "rank-gold" };
    if (elo < 1350) return { name: "Gold III", css: "rank-gold" };
    if (elo < 1600) return { name: "Diamant I", css: "rank-diamant" };
    if (elo < 1850) return { name: "Diamant II", css: "rank-diamant" };
    if (elo < 2100) return { name: "Diamant III", css: "rank-diamant" };
    if (elo < 2600) return { name: "Champion I", css: "rank-champion" };
    if (elo < 3100) return { name: "Champion II", css: "rank-champion" };
    if (elo < 3600) return { name: "Champion III", css: "rank-champion" };
    if (elo < 4600) return { name: "Meister I", css: "rank-master" };
    if (elo < 5600) return { name: "Meister II", css: "rank-master" };
    if (elo < 6600) return { name: "Meister III", css: "rank-master" };
    return { name: "Grandmaster", css: "rank-grandmaster" };
}

io.on('connection', (socket) => {
    console.log('Client connected:', socket.id);
    
    socket.on('auth_handshake', (token) => {
        if (!token) return;
        jwt.verify(token, JWT_SECRET, (err, decoded) => {
            if (!err) {
                socket.userId = decoded.id;
            }
        });
    });

    socket.on('join_queue', (data) => {
        const { mode } = data;
        if (!queues[mode]) return;
        
        leaveAllQueues(socket);
        
        db.get('SELECT name, math_best, iq_best, equipped_frame as frame, equipped_title as title, avatar_seed as avatarSeed FROM users WHERE id = ?', [socket.userId], (err, user) => {
            const elo = user ? (mode === 'math' ? user.math_best : user.iq_best) : 100;
            const playerDetails = user ? {
                id: socket.userId,
                socketId: socket.id,
                name: user.name,
                elo: elo,
                frame: user.frame,
                title: user.title,
                avatarSeed: user.avatarSeed
            } : {
                id: null,
                socketId: socket.id,
                name: "Guest Player",
                elo: 100,
                frame: "default",
                title: "Novice Dueler",
                avatarSeed: "Guest"
            };
            
            if (queues[mode].length > 0) {
                const opponent = queues[mode].shift();
                clearTimeout(opponent.timeoutId);
                startMatch(mode, playerDetails, opponent.player);
            } else {
                const queueItem = {
                    socketId: socket.id,
                    player: playerDetails,
                    timeoutId: setTimeout(() => {
                        const idx = queues[mode].findIndex(q => q.socketId === socket.id);
                        if (idx !== -1) {
                            queues[mode].splice(idx, 1);
                            const botDetails = getBotDetailsForElo(playerDetails.elo);
                            startMatch(mode, playerDetails, botDetails, true);
                        }
                    }, 5000)
                };
                queues[mode].push(queueItem);
            }
        });
    });
    
    socket.on('submit_answer', (data) => {
        const { matchId, selectedOption } = data;
        const match = activeMatches[matchId];
        if (!match) return;
        
        const isP1 = (match.p1.socketId === socket.id);
        const player = isP1 ? match.p1 : match.p2;
        
        if (player.finished || match.ended) return;
        
        const isCorrect = (selectedOption === player.currentQuestion.a);
        if (isCorrect) {
            player.score++;
            player.correct++;
        } else {
            player.incorrect++;
        }
        
        io.to(match.id).emit('score_update', {
            p1Score: match.p1.score,
            p2Score: match.p2.score,
            p1Correct: match.p1.correct,
            p1Incorrect: match.p1.incorrect,
            p2Correct: match.p2.correct,
            p2Incorrect: match.p2.incorrect
        });
        
        if (!isCorrect) {
            socket.emit('answer_wrong', { correctVal: player.currentQuestion.a });
        }
        
        const totalQuestions = player.correct + player.incorrect;
        const delay = isCorrect ? 300 : 800;
        
        setTimeout(() => {
            if (match.ended) return;
            if (totalQuestions >= 10) {
                player.finished = true;
                player.finishedTime = Date.now();
                socket.emit('player_finished');
                
                if (match.p1.finished && match.p2.finished) {
                    determineWinnerAndEndMatch(match);
                }
            } else {
                player.currentQuestion = generateQuestion(match.mode);
                socket.emit('question_next', {
                    q: player.currentQuestion.q,
                    choices: player.currentQuestion.choices
                });
            }
        }, delay);
    });

    socket.on('iq_submit_progress', (data) => {
        const { matchId, progress, failed, completed } = data;
        const match = activeMatches[matchId];
        if (!match || match.ended) return;
        
        const isP1 = (match.p1.socketId === socket.id);
        const player = isP1 ? match.p1 : match.p2;
        
        player.progress = progress;
        player.failed = failed;
        player.completed = completed;
        
        io.to(match.id).emit('iq_progress_update', {
            p1Progress: match.p1.progress,
            p1Failed: match.p1.failed,
            p1Completed: match.p1.completed,
            p2Progress: match.p2.progress,
            p2Failed: match.p2.failed,
            p2Completed: match.p2.completed
        });
        
        checkIqRoundOver(match);
    });

    socket.on('cancel_queue', () => {
        leaveAllQueues(socket);
    });
    
    // Manual forfeit trigger
    socket.on('forfeit_match', (data) => {
        const match = activeMatches[data.matchId];
        if (!match) return;
        const isP1 = (match.p1.socketId === socket.id);
        endMatch(match, isP1 ? 'p2' : 'p1', true);
    });

    socket.on('rematch_double_or_nothing', (data) => {
        const prevMatch = closedMatches[data.matchId];
        if (!prevMatch) return;
        
        const isP1 = (prevMatch.p1.socketId === socket.id);
        const me = isP1 ? prevMatch.p1 : prevMatch.p2;
        const opp = isP1 ? prevMatch.p2 : prevMatch.p1;
        
        const p1Clean = {
            id: me.id,
            socketId: me.socketId,
            name: me.name,
            elo: me.elo,
            frame: me.frame,
            title: me.title,
            avatarSeed: me.avatarSeed
        };
        
        const p2Clean = {
            id: opp.id,
            socketId: opp.socketId,
            name: opp.name,
            elo: opp.elo,
            frame: opp.frame,
            title: opp.title,
            avatarSeed: opp.avatarSeed,
            solveSpeedRange: opp.solveSpeedRange,
            accuracy: opp.accuracy
        };
        
        const newMatch = startMatch(prevMatch.mode, p1Clean, p2Clean, prevMatch.isBot);
        newMatch.isDoubleOrNothing = true;
        newMatch.parentEloChange = data.eloChange;
    });
    
    socket.on('disconnect', () => {
        leaveAllQueues(socket);
        Object.keys(activeMatches).forEach(matchId => {
            const match = activeMatches[matchId];
            if (match.p1.socketId === socket.id && !match.isBot) {
                endMatch(match, 'p2', true);
            } else if (match.p2.socketId === socket.id && !match.isBot) {
                endMatch(match, 'p1', true);
            }
        });
    });
});

function leaveAllQueues(socket) {
    ['math', 'iq'].forEach(mode => {
        const idx = queues[mode].findIndex(q => q.socketId === socket.id);
        if (idx !== -1) {
            clearTimeout(queues[mode][idx].timeoutId);
            queues[mode].splice(idx, 1);
        }
    });
}

function getBotDetailsForElo(elo) {
    const rankInfo = getEloRank(elo);
    let speedRange = [3000, 5000];
    let accuracy = 0.55;
    
    if (rankInfo.name.includes("Bronze")) {
        speedRange = [1300, 2200];
        accuracy = 0.82;
    } else if (rankInfo.name.includes("Silber")) {
        speedRange = [1000, 1600];
        accuracy = 0.87;
    } else if (rankInfo.name.includes("Gold")) {
        speedRange = [800, 1250];
        accuracy = 0.91;
    } else if (rankInfo.name.includes("Diamant")) {
        speedRange = [600, 950];
        accuracy = 0.94;
    } else if (rankInfo.name.includes("Champion")) {
        speedRange = [500, 750];
        accuracy = 0.96;
    } else {
        speedRange = [400, 600];
        accuracy = 0.98;
    }
    
    const botNames = ["Mia", "Leo", "Zoe", "Alex", "Sasha", "Nico", "Sophia", "Lucas", "Max", "Amelie", "Felix", "Emma"];
    const name = botNames[Math.floor(Math.random() * botNames.length)] + " (Bot)";
    const avatarSeed = "Bot_" + name.replace(" (Bot)", "");
    const botElo = Math.max(0, elo + Math.floor(Math.random() * 100) - 50);
    
    return {
        id: 'bot',
        socketId: 'bot_' + Math.random(),
        name: name,
        elo: botElo,
        frame: 'default',
        title: 'Bot Opponent',
        avatarSeed: avatarSeed,
        solveSpeedRange: speedRange,
        accuracy: accuracy
    };
}

function startMatch(mode, p1, p2, isBot = false) {
    const matchId = 'match_' + Date.now() + '_' + Math.floor(Math.random() * 1000);
    
    const p1Socket = io.sockets.sockets.get(p1.socketId);
    const p2Socket = io.sockets.sockets.get(p2.socketId);
    
    if (p1Socket) p1Socket.join(matchId);
    if (p2Socket) p2Socket.join(matchId);
    
    const match = {
        id: matchId,
        mode: mode,
        isBot: isBot,
        p1: { ...p1, score: 0, correct: 0, incorrect: 0, finished: false, currentQuestion: null, progress: 0, failed: false, completed: false },
        p2: { ...p2, score: 0, correct: 0, incorrect: 0, finished: false, currentQuestion: null, progress: 0, failed: false, completed: false },
        botTimerId: null,
        ended: false,
        roundNumber: 1
    };
    
    if (mode === 'iq') {
        match.currentIqQuestion = generateQuestion('iq', 1);
    }
    
    activeMatches[matchId] = match;
    
    io.to(matchId).emit('match_found', {
        matchId,
        p1: { name: p1.name, elo: p1.elo, frame: p1.frame, title: p1.title, avatarSeed: p1.avatarSeed },
        p2: { name: p2.name, elo: p2.elo, frame: p2.frame, title: p2.title, avatarSeed: p2.avatarSeed }
    });
    
    // Server safety timer
    if (mode === 'math') {
        match.matchTimerId = setTimeout(() => {
            if (!match.ended) {
                determineWinnerAndEndMatch(match);
            }
        }, 36000);
    } else {
        startIqRoundSafetyTimer(match);
    }
    
    setTimeout(() => {
        if (match.ended) return;
        
        if (mode === 'math') {
            match.p1.currentQuestion = generateQuestion(mode);
            match.p2.currentQuestion = generateQuestion(mode);
            
            if (p1Socket) {
                p1Socket.emit('match_start', {
                    q: match.p1.currentQuestion.q,
                    choices: match.p1.currentQuestion.choices
                });
            }
            
            if (!isBot && p2Socket) {
                p2Socket.emit('match_start', {
                    q: match.p2.currentQuestion.q,
                    choices: match.p2.currentQuestion.choices
                });
            }
            
            if (isBot) {
                triggerBotSolver(match);
            }
        } else {
            // IQ grid sequence match start
            if (p1Socket) {
                p1Socket.emit('match_start', {
                    isIqGrid: true,
                    sequence: match.currentIqQuestion.sequence,
                    round: 1
                });
            }
            
            if (!isBot && p2Socket) {
                p2Socket.emit('match_start', {
                    isIqGrid: true,
                    sequence: match.currentIqQuestion.sequence,
                    round: 1
                });
            }
            
            if (isBot) {
                triggerBotIqSolver(match);
            }
        }
    }, 3800);
}

function triggerBotSolver(match) {
    if (match.ended || match.p2.finished) return;
    
    const bot = match.p2;
    const minSpeed = bot.solveSpeedRange[0];
    const maxSpeed = bot.solveSpeedRange[1];
    const delay = Math.floor(Math.random() * (maxSpeed - minSpeed)) + minSpeed;
    
    match.botTimerId = setTimeout(() => {
        if (match.ended || bot.finished) return;
        
        const isCorrect = Math.random() < (bot.accuracy || 0.8);
        if (isCorrect) {
            bot.score++;
            bot.correct++;
        } else {
            bot.incorrect++;
        }
        
        io.to(match.id).emit('score_update', {
            p1Score: match.p1.score,
            p2Score: match.p2.score,
            p1Correct: match.p1.correct,
            p1Incorrect: match.p1.incorrect,
            p2Correct: match.p2.correct,
            p2Incorrect: match.p2.incorrect
        });
        
        const totalAnswered = bot.correct + bot.incorrect;
        
        const delayNext = isCorrect ? 300 : 800;
        setTimeout(() => {
            if (match.ended) return;
            if (totalAnswered >= 10) {
                bot.finished = true;
                bot.finishedTime = Date.now();
                if (match.p1.finished) {
                    determineWinnerAndEndMatch(match);
                }
            } else {
                bot.currentQuestion = generateQuestion(match.mode);
                triggerBotSolver(match);
            }
        }, delayNext);
    }, delay);
}

function startIqRoundSafetyTimer(match) {
    if (match.matchTimerId) clearTimeout(match.matchTimerId);
    
    const seqLen = match.currentIqQuestion.sequence.length;
    const timeLimitMs = (seqLen * 2000) + 2500; // 2s per tile + 2.5s memorization padding
    
    match.matchTimerId = setTimeout(() => {
        if (match.ended) return;
        
        let updated = false;
        if (!match.p1.completed && !match.p1.failed) {
            match.p1.failed = true;
            updated = true;
        }
        if (!match.p2.completed && !match.p2.failed) {
            match.p2.failed = true;
            updated = true;
        }
        
        if (updated) {
            io.to(match.id).emit('iq_progress_update', {
                p1Progress: match.p1.progress,
                p1Failed: match.p1.failed,
                p1Completed: match.p1.completed,
                p2Progress: match.p2.progress,
                p2Failed: match.p2.failed,
                p2Completed: match.p2.completed
            });
            checkIqRoundOver(match);
        }
    }, timeLimitMs);
}

function triggerBotIqSolver(match) {
    if (match.ended || match.p2.failed || match.p2.completed) return;
    
    const bot = match.p2;
    const seqLen = match.currentIqQuestion.sequence.length;
    
    // Memorization phase is 1.5s. Add 300ms reaction delay.
    setTimeout(() => {
        if (match.ended || bot.failed || bot.completed) return;
        
        let currentClickIndex = 0;
        
        function doBotClick() {
            if (match.ended || bot.failed || bot.completed) return;
            
            const isCorrect = Math.random() < (bot.accuracy || 0.85);
            if (isCorrect) {
                currentClickIndex++;
                bot.progress = currentClickIndex;
                if (currentClickIndex === seqLen) {
                    bot.completed = true;
                }
            } else {
                bot.failed = true;
            }
            
            io.to(match.id).emit('iq_progress_update', {
                p1Progress: match.p1.progress,
                p1Failed: match.p1.failed,
                p1Completed: match.p1.completed,
                p2Progress: match.p2.progress,
                p2Failed: match.p2.failed,
                p2Completed: match.p2.completed
            });
            
            checkIqRoundOver(match);
            
            if (!bot.failed && !bot.completed) {
                const minSpeed = bot.solveSpeedRange[0];
                const maxSpeed = bot.solveSpeedRange[1];
                const delay = Math.floor(Math.random() * (maxSpeed - minSpeed)) + minSpeed;
                match.botTimerId = setTimeout(doBotClick, delay);
            }
        }
        
        doBotClick();
    }, 1800);
}

function checkIqRoundOver(match) {
    if (match.ended) return;
    
    const p1Done = match.p1.failed || match.p1.completed;
    const p2Done = match.p2.failed || match.p2.completed;
    
    if (p1Done && p2Done) {
        // Both finished current round. Check if one/both failed.
        const p1Failed = match.p1.failed;
        const p2Failed = match.p2.failed;
        
        if (p1Failed || p2Failed) {
            // Match is over! Someone failed.
            // Setup scores so determineWinner works (higher score wins)
            match.p1.score = match.p1.completed ? match.roundNumber : match.p1.progress;
            match.p2.score = match.p2.completed ? match.roundNumber : match.p2.progress;
            
            setTimeout(() => {
                determineWinnerAndEndMatch(match);
            }, 1000);
        } else {
            // Both succeeded! Advance to next round.
            match.roundNumber++;
            match.currentIqQuestion = generateQuestion('iq', match.roundNumber);
            
            match.p1.progress = 0; match.p1.failed = false; match.p1.completed = false;
            match.p2.progress = 0; match.p2.failed = false; match.p2.completed = false;
            
            if (match.botTimerId) clearTimeout(match.botTimerId);
            if (match.matchTimerId) clearTimeout(match.matchTimerId);
            
            setTimeout(() => {
                if (match.ended) return;
                
                io.to(match.id).emit('iq_round_next', {
                    sequence: match.currentIqQuestion.sequence,
                    round: match.roundNumber
                });
                
                startIqRoundSafetyTimer(match);
                
                if (match.isBot) {
                    triggerBotIqSolver(match);
                }
            }, 1200); // slight delay before starting next round animations
        }
    }
}

function determineWinnerAndEndMatch(match) {
    let winnerKey = 'draw';
    if (match.p1.score > match.p2.score) {
        winnerKey = 'p1';
    } else if (match.p2.score > match.p1.score) {
        winnerKey = 'p2';
    } else {
        // Tied score! Decide by speed (faster finishedTime wins)
        if (match.p1.finished && match.p2.finished) {
            const p1Time = match.p1.finishedTime || Infinity;
            const p2Time = match.p2.finishedTime || Infinity;
            if (p1Time < p2Time) {
                winnerKey = 'p1';
            } else if (p2Time < p1Time) {
                winnerKey = 'p2';
            }
        } else if (match.p1.finished) {
            winnerKey = 'p1';
        } else if (match.p2.finished) {
            winnerKey = 'p2';
        }
    }
    endMatch(match, winnerKey);
}

function endMatch(match, winnerKey, earlyExit = false) {
    if (match.ended) return;
    match.ended = true;
    
    // Save to closedMatches
    closedMatches[match.id] = match;
    
    if (match.botTimerId) clearTimeout(match.botTimerId);
    if (match.matchTimerId) clearTimeout(match.matchTimerId);
    
    const isDraw = (winnerKey === 'draw');
    const p1Winner = (winnerKey === 'p1');
    
    const calculateEloChange = (userElo, result) => {
        if (result === 'draw') return 0;
        const rankInfo = getEloRank(userElo);
        let winElo = 20;
        let loseElo = 5;
        
        if (rankInfo.name.includes("Bronze")) {
            winElo = 20; loseElo = 5;
        } else if (rankInfo.name.includes("Silber")) {
            winElo = 15; loseElo = 5;
        } else if (rankInfo.name.includes("Gold")) {
            winElo = 10; loseElo = 6;
        } else if (rankInfo.name.includes("Diamant")) {
            winElo = 8; loseElo = 8;
        } else if (rankInfo.name.includes("Champion")) {
            winElo = 6; loseElo = 10;
        } else if (rankInfo.name.includes("Meister")) {
            winElo = 5; loseElo = 15;
        } else {
            winElo = 2; loseElo = 20;
        }
        
        return result === 'win' ? winElo : -loseElo;
    };
    
    const p1Result = isDraw ? 'draw' : (p1Winner ? 'win' : 'lose');
    const p2Result = isDraw ? 'draw' : (!p1Winner ? 'win' : 'lose');
    
    let p1EloChange = calculateEloChange(match.p1.elo, p1Result);
    let p2EloChange = calculateEloChange(match.p2.elo, p2Result);
    
    if (match.isDoubleOrNothing) {
        const p1Parent = match.parentEloChange || 0;
        if (p1Result === 'win') {
            p1EloChange = p1Parent > 0 ? p1Parent : Math.abs(p1Parent);
        } else if (p1Result === 'lose') {
            p1EloChange = p1Parent > 0 ? -p1Parent : p1Parent;
        } else {
            p1EloChange = 0;
        }
        
        // Simulating the bot's ELO shift
        const p2Parent = -p1Parent;
        if (p2Result === 'win') {
            p2EloChange = p2Parent > 0 ? p2Parent : Math.abs(p2Parent);
        } else if (p2Result === 'lose') {
            p2EloChange = p2Parent > 0 ? -p2Parent : p2Parent;
        } else {
            p2EloChange = 0;
        }
    }
    
    // Fixed game rewards: 50 coins and 100 xp
    const coinsGained = 50;
    const xpGained = 100;
    
    if (match.p1.id && match.p1.id !== 'bot') {
        saveMatchResult(match.p1.id, p1EloChange, coinsGained, xpGained, match.mode);
    }
    
    if (match.p2.id && match.p2.id !== 'bot') {
        saveMatchResult(match.p2.id, p2EloChange, coinsGained, xpGained, match.mode);
    }
    
    const p1Socket = io.sockets.sockets.get(match.p1.socketId);
    const p2Socket = io.sockets.sockets.get(match.p2.socketId);
    
    if (p1Socket) {
        p1Socket.emit('match_end', {
            matchId: match.id,
            result: isDraw ? 'Draw' : (p1Winner ? 'Victory' : 'Defeat'),
            opponentName: match.p2.name,
            eloChange: p1EloChange,
            coinsGained,
            xpGained,
            isDoubleOrNothing: !!match.isDoubleOrNothing
        });
    }
    
    if (p2Socket && !match.isBot) {
        p2Socket.emit('match_end', {
            matchId: match.id,
            result: isDraw ? 'Draw' : (!p1Winner ? 'Victory' : 'Defeat'),
            opponentName: match.p1.name,
            eloChange: p2EloChange,
            coinsGained,
            xpGained,
            isDoubleOrNothing: !!match.isDoubleOrNothing
        });
    }
    
    delete activeMatches[match.id];
}

function saveMatchResult(userId, eloChange, coinsGained, xpGained, mode) {
    db.get('SELECT math_best, iq_best, coins, level, xp FROM users WHERE id = ?', [userId], (err, user) => {
        if (err || !user) return;
        
        let mathElo = user.math_best;
        let iqElo = user.iq_best;
        
        if (mode === 'math') mathElo = Math.max(0, mathElo + eloChange);
        if (mode === 'iq') iqElo = Math.max(0, iqElo + eloChange);
        
        let newElo = mathElo + iqElo; // combined ELO
        let newCoins = user.coins + coinsGained;
        let newXp = user.xp + xpGained;
        let newLevel = user.level;
        let xpNeeded = newLevel * 400;
        
        while (newXp >= xpNeeded) {
            newXp -= xpNeeded;
            newLevel++;
            xpNeeded = newLevel * 400;
        }
        
        db.run(`
            UPDATE users SET 
                elo = ?,
                coins = ?,
                level = ?,
                xp = ?,
                math_best = ?,
                iq_best = ?
            WHERE id = ?
        `, [newElo, newCoins, newLevel, newXp, mathElo, iqElo, userId]);
    });
}

// Start Server
server.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});
