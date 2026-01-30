const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const { Pool } = require('pg'); 
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
require('dotenv').config();

const app = express();
const server = http.createServer(app);

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

app.use(cors());
app.use(express.json());

// --- ROUTES ---

app.get('/', (req, res) => res.send('Server is Online!'));

app.post('/register', async (req, res) => {
  const { username, phone, password } = req.body;
  try {
    const hashedPassword = await bcrypt.hash(password, 10);
    const newUser = await pool.query(
      'INSERT INTO users (username, phone, password, balance) VALUES ($1, $2, $3, 50) RETURNING *',
      [username, phone, hashedPassword]
    );
    res.json(newUser.rows[0]);
  } catch (err) { res.status(500).json({ error: "User exists" }); }
});

app.post('/login', async (req, res) => {
  const { phone, password } = req.body;
  try {
    const user = await pool.query('SELECT * FROM users WHERE phone = $1', [phone]);
    if (user.rows.length === 0) return res.status(400).json({ error: "User not found" });
    const validPass = await bcrypt.compare(password, user.rows[0].password);
    if (!validPass) return res.status(400).json({ error: "Wrong password" });
    res.json({ user: user.rows[0] });
  } catch (err) { res.status(500).json({ error: "Login Error" }); }
});

// FIXED DEPOSIT ROUTE
app.post('/deposit', async (req, res) => {
  const { phone, amount } = req.body;
  if(!amount || amount <= 0) return res.status(400).json({message: "Invalid Amount"});
  
  try {
    const user = await pool.query('SELECT * FROM users WHERE phone = $1', [phone]);
    const newBalance = parseFloat(user.rows[0].balance) + parseFloat(amount);
    
    await pool.query('UPDATE users SET balance = $1 WHERE phone = $2', [newBalance, phone]);
    res.json({ success: true, newBalance, message: "Deposit Successful!" });
  } catch (err) {
    res.status(500).json({ success: false, message: "Deposit Failed" });
  }
});

// WITHDRAW ROUTE
app.post('/withdraw', async (req, res) => {
  const { phone, amount } = req.body;
  try {
    const user = await pool.query('SELECT * FROM users WHERE phone = $1', [phone]);
    const currentBal = parseFloat(user.rows[0].balance);
    const withdrawAmt = parseFloat(amount);

    if (currentBal < withdrawAmt) return res.status(400).json({ success: false, message: "Insufficient Funds" });

    const newBalance = currentBal - withdrawAmt;
    await pool.query('UPDATE users SET balance = $1 WHERE phone = $2', [newBalance, phone]);
    res.json({ success: true, newBalance });
  } catch (err) { res.status(500).json({ success: false, message: "Server Error" }); }
});

// --- GAME LOGIC (The Referee) ---
const io = new Server(server, { cors: { origin: "*" } });

let queue = []; // Waiting line
let matches = {}; // Active games

io.on('connection', (socket) => {
  console.log('Player connected:', socket.id);

  socket.on('FIND_MATCH', async ({ phone }) => {
    // 1. Check Balance before letting them play
    const userRes = await pool.query('SELECT balance FROM users WHERE phone = $1', [phone]);
    const balance = parseFloat(userRes.rows[0].balance);

    if (balance < 10) {
      socket.emit('ERROR', { message: "Insufficient Funds! You need 10 GHS." });
      return;
    }

    // 2. Add to Queue
    queue.push({ socketId: socket.id, phone: phone });

    // 3. If 2 players are ready, START MATCH
    if (queue.length >= 2) {
      const p1 = queue.shift();
      const p2 = queue.shift();
      const matchId = `match_${Date.now()}`;

      // Deduct 10 GHS from BOTH players
      await pool.query('UPDATE users SET balance = balance - 10 WHERE phone = $1', [p1.phone]);
      await pool.query('UPDATE users SET balance = balance - 10 WHERE phone = $1', [p2.phone]);

      // Save Match Info
      matches[matchId] = { 
        p1: { id: p1.socketId, phone: p1.phone, roll: null }, 
        p2: { id: p2.socketId, phone: p2.phone, roll: null } 
      };

      // Tell players game started
      io.to(p1.socketId).emit('GAME_START', { matchId, opponent: "Player 2" });
      io.to(p2.socketId).emit('GAME_START', { matchId, opponent: "Player 1" });
    }
  });

  socket.on('ROLL_DICE', async ({ matchId }) => {
    const match = matches[matchId];
    if (!match) return;

    const roll = Math.floor(Math.random() * 6) + 1;
    
    // Store the roll
    if (socket.id === match.p1.id) match.p1.roll = roll;
    else if (socket.id === match.p2.id) match.p2.roll = roll;

    // Show animation to both
    io.to(match.p1.id).emit('ROLL_ANIMATION', { roller: socket.id });
    io.to(match.p2.id).emit('ROLL_ANIMATION', { roller: socket.id });

    // IF BOTH HAVE ROLLED -> DECIDE WINNER
    if (match.p1.roll && match.p2.roll) {
      setTimeout(async () => {
        let winnerText = "";
        let winnerPhone = null;

        if (match.p1.roll > match.p2.roll) {
          winnerText = "Player 1 Wins!";
          winnerPhone = match.p1.phone;
        } else if (match.p2.roll > match.p1.roll) {
          winnerText = "Player 2 Wins!";
          winnerPhone = match.p2.phone;
        } else {
          winnerText = "It's a Draw! Money returned.";
        }

        // PAYOUT
        if (winnerPhone) {
          await pool.query('UPDATE users SET balance = balance + 20 WHERE phone = $1', [winnerPhone]);
        } else {
          // Draw: Refund 10 to both
          await pool.query('UPDATE users SET balance = balance + 10 WHERE phone = $1', [match.p1.phone]);
          await pool.query('UPDATE users SET balance = balance + 10 WHERE phone = $1', [match.p2.phone]);
        }

        // Send Final Results
        io.to(match.p1.id).emit('GAME_OVER', { 
          myRoll: match.p1.roll, 
          opRoll: match.p2.roll, 
          result: winnerText 
        });
        io.to(match.p2.id).emit('GAME_OVER', { 
          myRoll: match.p2.roll, 
          opRoll: match.p1.roll, 
          result: winnerText 
        });

        delete matches[matchId]; // Clear memory
      }, 2000); // Wait 2s for animation
    }
  });
});

const PORT = process.env.PORT || 10000;
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));
