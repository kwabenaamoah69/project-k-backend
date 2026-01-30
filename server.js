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
app.get('/', (req, res) => res.send('Server Online'));

// RESET DB (Use this if things get stuck)
app.get('/reset', async (req, res) => {
  await pool.query('DROP TABLE IF EXISTS users');
  await pool.query(`CREATE TABLE users (id SERIAL PRIMARY KEY, username VARCHAR(50), phone VARCHAR(20) UNIQUE, password VARCHAR(200), balance NUMERIC DEFAULT 50)`);
  res.send("Database Reset.");
});

app.post('/register', async (req, res) => {
  const { username, phone, password } = req.body;
  try {
    const hashedPassword = await bcrypt.hash(password, 10);
    const newUser = await pool.query('INSERT INTO users (username, phone, password, balance) VALUES ($1, $2, $3, 50) RETURNING *', [username, phone, hashedPassword]);
    res.json(newUser.rows[0]);
  } catch (err) { res.status(500).json({ error: "User exists" }); }
});

app.post('/login', async (req, res) => {
  const { phone, password } = req.body;
  try {
    const user = await pool.query('SELECT * FROM users WHERE phone = $1', [phone]);
    if (user.rows.length === 0) return res.status(400).json({ error: "User not found" });
    if (await bcrypt.compare(password, user.rows[0].password)) {
      res.json({ user: user.rows[0] });
    } else {
      res.status(400).json({ error: "Wrong password" });
    }
  } catch (err) { res.status(500).json({ error: "Error" }); }
});

app.post('/balance-update', async (req, res) => {
  const { phone, amount, type } = req.body;
  try {
    const user = await pool.query('SELECT * FROM users WHERE phone = $1', [phone]);
    let newBalance = parseFloat(user.rows[0].balance);
    const value = parseFloat(amount);

    if (type === 'deposit') newBalance += value;
    if (type === 'withdraw') {
       if (newBalance < value) return res.status(400).json({ success: false, message: "Insufficient Funds" });
       newBalance -= value;
    }

    await pool.query('UPDATE users SET balance = $1 WHERE phone = $2', [newBalance, phone]);
    res.json({ success: true, newBalance });
  } catch (err) { res.status(500).json({ success: false, message: "Error" }); }
});

// --- STRICT GAME LOGIC ---
const io = new Server(server, { cors: { origin: "*" } });
let queue = [];
let matches = {};

io.on('connection', (socket) => {
  console.log('User connected:', socket.id);

  socket.on('FIND_MATCH', async ({ phone }) => {
    // Check funds first
    const user = await pool.query('SELECT balance FROM users WHERE phone = $1', [phone]);
    if (parseFloat(user.rows[0].balance) < 10) {
      socket.emit('ERROR', { message: "You need 10 GHS to play!" });
      return;
    }

    queue.push({ id: socket.id, phone });

    if (queue.length >= 2) {
      const p1 = queue.shift();
      const p2 = queue.shift();
      const matchId = 'm_' + Date.now();

      // Deduct Entry Fee (10 GHS)
      await pool.query('UPDATE users SET balance = balance - 10 WHERE phone = $1', [p1.phone]);
      await pool.query('UPDATE users SET balance = balance - 10 WHERE phone = $1', [p2.phone]);

      matches[matchId] = { p1, p2, rolls: {} };

      io.to(p1.id).emit('GAME_START', { matchId, opponent: "Player 2" });
      io.to(p2.id).emit('GAME_START', { matchId, opponent: "Player 1" });
    }
  });

  socket.on('ROLL_DICE', async ({ matchId }) => {
    const match = matches[matchId];
    if (!match) return;

    // Prevent double rolling
    if (match.rolls[socket.id]) return;

    const roll = Math.floor(Math.random() * 6) + 1;
    match.rolls[socket.id] = roll;

    // Tell everyone someone rolled (but hide number)
    io.to(match.p1.id).emit('OPPONENT_ROLLED', { playerId: socket.id });
    io.to(match.p2.id).emit('OPPONENT_ROLLED', { playerId: socket.id });

    // Show roll to self
    socket.emit('MY_ROLL', { roll });

    // IF BOTH ROLLED -> FINISH GAME
    if (Object.keys(match.rolls).length === 2) {
      const p1Roll = match.rolls[match.p1.id];
      const p2Roll = match.rolls[match.p2.id];
      
      let winnerPhone = null;
      if (p1Roll > p2Roll) winnerPhone = match.p1.phone;
      if (p2Roll > p1Roll) winnerPhone = match.p2.phone;

      if (winnerPhone) {
        await pool.query('UPDATE users SET balance = balance + 20 WHERE phone = $1', [winnerPhone]);
      } else {
        // Draw - Refund
        await pool.query('UPDATE users SET balance = balance + 10 WHERE phone = $1', [match.p1.phone]);
        await pool.query('UPDATE users SET balance = balance + 10 WHERE phone = $1', [match.p2.phone]);
      }

      // Send Results
      io.to(match.p1.id).emit('GAME_RESULT', { p1Roll, p2Roll, winner: winnerPhone });
      io.to(match.p2.id).emit('GAME_RESULT', { p1Roll, p2Roll, winner: winnerPhone });
      
      delete matches[matchId];
    }
  });
});

const PORT = process.env.PORT || 10000;
server.listen(PORT, () => console.log(`Running on ${PORT}`));
