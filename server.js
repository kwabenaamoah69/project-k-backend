const express = require('express');
const cors = require('cors');
const http = require('http'); 
const { Server } = require('socket.io'); 
const db = require('./db'); 
const matchmaker = require('./matchmaker'); 
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken'); 

require('dotenv').config();

const app = express();
const server = http.createServer(app); 
const JWT_SECRET = "my_secret_key_123"; 

app.use(cors());
app.use(express.json()); 

const activeGames = {}; 

// --- 1. REGISTER ---
app.post('/register', async (req, res) => {
    try {
        const { username, phone, password } = req.body;
        const userCheck = await db.query("SELECT * FROM users WHERE phone = $1", [phone]);
        if (userCheck.rows.length > 0) return res.status(400).json({ error: "User already exists!" });

        const salt = await bcrypt.genSalt(10);
        const hashedPassword = await bcrypt.hash(password, salt);
        const friendCode = username.substring(0, 4).toUpperCase() + Math.floor(1000 + Math.random() * 9000);

        // FIX: Added 'phone' to the RETURNING list
        const newUser = await db.query(
            "INSERT INTO users (username, phone, password_hash, friend_code) VALUES ($1, $2, $3, $4) RETURNING id, username, phone, friend_code",
            [username, phone, hashedPassword, friendCode]
        );
        
        const token = jwt.sign({ id: newUser.rows[0].id }, JWT_SECRET);
        
        // FIX: Ensure the user object has the phone number
        const userToSend = {
            ...newUser.rows[0],
            balance: 0
        };

        res.json({ message: "Welcome!", user: userToSend, token: token });

    } catch (err) {
        console.error(err);
        res.status(500).json({ error: "Server Error" });
    }
});

// --- 2. LOGIN ---
app.post('/login', async (req, res) => {
    try {
        const { phone, password } = req.body;
        
        const userResult = await db.query("SELECT * FROM users WHERE phone = $1", [phone]);
        if (userResult.rows.length === 0) return res.status(400).json({ error: "User not found" });

        const user = userResult.rows[0];

        const validPass = await bcrypt.compare(password, user.password_hash);
        if (!validPass) return res.status(400).json({ error: "Invalid Password" });

        const token = jwt.sign({ id: user.id }, JWT_SECRET);

        // FIX: Added 'phone' here too so the frontend knows it
        res.json({ 
            message: "Login Successful", 
            token: token,
            user: { 
                id: user.id, 
                username: user.username, 
                phone: user.phone, // <--- CRITICAL FIX
                balance: parseFloat(user.deposit_balance) + parseFloat(user.winning_balance) 
            }
        });

    } catch (err) {
        console.error(err);
        res.status(500).json({ error: "Server Error" });
    }
});

// --- 3. ME (Check Balance) ---
app.get('/me', async (req, res) => {
    try {
        const token = req.headers.authorization;
        if (!token) return res.status(401).json({ error: "No token provided" });

        const decoded = jwt.verify(token, JWT_SECRET);
        const userResult = await db.query("SELECT id, username, phone, friend_code, deposit_balance, winning_balance FROM users WHERE id = $1", [decoded.id]);
        
        if (userResult.rows.length === 0) return res.status(404).json({ error: "User not found" });

        const user = userResult.rows[0];
        // Combine balances for display
        const userData = {
            ...user,
            balance: parseFloat(user.deposit_balance) + parseFloat(user.winning_balance)
        };
        
        res.json(userData);

    } catch (err) {
        res.status(401).json({ error: "Invalid Token" });
    }
});

// --- 4. DEPOSIT ---
app.post('/deposit', async (req, res) => {
    try {
        const { phone, amount } = req.body;
        
        console.log("Processing deposit for:", phone); // Debug Log

        // Check if user exists
        const userCheck = await db.query("SELECT * FROM users WHERE phone = $1", [phone]);
        if (userCheck.rows.length === 0) return res.status(400).json({ error: "User not found" });

        // Update Balance
        const updateResult = await db.query(
            "UPDATE users SET deposit_balance = deposit_balance + $1 WHERE phone = $2 RETURNING deposit_balance, winning_balance",
            [amount, phone]
        );

        const updatedUser = updateResult.rows[0];
        const totalBalance = parseFloat(updatedUser.deposit_balance) + parseFloat(updatedUser.winning_balance);

        res.json({ message: "Deposit Successful", newBalance: totalBalance });

    } catch (err) {
        console.error(err);
        res.status(500).json({ error: "Deposit Failed" });
    }
});

// --- SOCKET.IO REAL-TIME ENGINE ---
const io = new Server(server, {
    cors: { origin: "*", methods: ["GET", "POST"] }
});

io.on('connection', (socket) => {
    console.log(`User Connected: ${socket.id}`);

    // MATCHMAKING
    socket.on('FIND_MATCH', async (data) => {
        const { gameType, stake, userId } = data;
        socket.userId = userId;

        const result = matchmaker.addPlayer(socket, gameType, stake);

        if (result.status === 'MATCH_FOUND') {
            const { matchId, player1, player2 } = result;
            player1.join(matchId);
            player2.join(matchId);
            
            console.log(`✅ MATCH START: User ${player1.userId} vs User ${player2.userId}`);

            // Deduct Money
            try {
                await db.query("UPDATE users SET deposit_balance = deposit_balance - $1 WHERE id = $2", [stake, player1.userId]);
                await db.query("UPDATE users SET deposit_balance = deposit_balance - $1 WHERE id = $2", [stake, player2.userId]);
            } catch (err) { console.error(err); }

            io.to(matchId).emit('GAME_START', { matchId, gameType, stake });
        } else {
            socket.emit('WAITING', { message: "Searching for opponent..." });
        }
    });

    // GAME LOGIC
    socket.on('ROLL_DICE', async (data) => {
        const { matchId } = data;
        const roll = Math.floor(Math.random() * 6) + 1; 

        if (!activeGames[matchId]) activeGames[matchId] = { player1: null, player2: null };
        
        if (!activeGames[matchId].player1 && socket.id !== activeGames[matchId].player2?.id) {
            activeGames[matchId].player1 = { id: socket.id, userId: socket.userId, roll: roll };
        } else if (!activeGames[matchId].player2 && socket.id !== activeGames[matchId].player1?.id) {
            activeGames[matchId].player2 = { id: socket.id, userId: socket.userId, roll: roll };
        }

        io.to(matchId).emit('ROLL_RESULT', { playerId: socket.id, roll: roll });

        const game = activeGames[matchId];
        if (game.player1 && game.player2) {
            let winnerId = null;
            let winnerUserId = null;
            let message = "It's a Draw!";

            if (game.player1.roll > game.player2.roll) {
                winnerId = game.player1.id; winnerUserId = game.player1.userId; message = "Player 1 Wins!";
            } else if (game.player2.roll > game.player1.roll) {
                winnerId = game.player2.id; winnerUserId = game.player2.userId; message = "Player 2 Wins!";
            }

            if (winnerUserId) {
                const winnings = 18; 
                try {
                    await db.query("UPDATE users SET winning_balance = winning_balance + $1 WHERE id = $2", [winnings, winnerUserId]);
                } catch (err) { console.error(err); }
            }

            io.to(matchId).emit('GAME_OVER', {
                winnerId: winnerId,
                message: message,
                p1_roll: game.player1.roll,
                p2_roll: game.player2.roll
            });
            delete activeGames[matchId];
        }
    });

    socket.on('disconnect', () => {
        matchmaker.removePlayer(socket.id);
    });
});

const PORT = process.env.PORT || 5000;
server.listen(PORT, () => {
    console.log(`SERVER RUNNING on Port ${PORT}`);
});