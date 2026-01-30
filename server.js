const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const { Pool } = require('pg'); // CRITICAL LINE
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
require('dotenv').config();

const app = express();
const server = http.createServer(app);

// 1. DATABASE CONNECTION (Defined GLOBALLY here)
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

// 2. MIDDLEWARE
app.use(cors());
app.use(express.json());

// 3. ROUTES
app.get('/', (req, res) => res.send('Server is Running!'));

// --- REGISTER ---
app.post('/register', async (req, res) => {
  const { username, phone, password } = req.body;
  try {
    const hashedPassword = await bcrypt.hash(password, 10);
    const newUser = await pool.query(
      'INSERT INTO users (username, phone, password, balance) VALUES ($1, $2, $3, 0) RETURNING *',
      [username, phone, hashedPassword]
    );
    res.json(newUser.rows[0]);
  } catch (err) {
    console.error("Register Error:", err);
    res.status(500).json({ error: "User already exists" });
  }
});

// --- LOGIN ---
app.post('/login', async (req, res) => {
  const { phone, password } = req.body;
  try {
    const user = await pool.query('SELECT * FROM users WHERE phone = $1', [phone]);
    if (user.rows.length === 0) return res.status(400).json({ error: "User not found" });

    const validPass = await bcrypt.compare(password, user.rows[0].password);
    if (!validPass) return res.status(400).json({ error: "Wrong password" });

    const token = jwt.sign({ id: user.rows[0].id }, 'SECRET_KEY');
    res.json({ token, user: user.rows[0] });
  } catch (err) {
    console.error("Login Error:", err);
    res.status(500).json({ error: "Login Error" });
  }
});

// --- GET USER INFO ---
app.get('/me', async (req, res) => {
  const token = req.headers['authorization'];
  if(!token) return res.status(401).json({error: "No token"});
  try {
    const decoded = jwt.verify(token, 'SECRET_KEY');
    const user = await pool.query('SELECT * FROM users WHERE id = $1', [decoded.id]);
    res.json(user.rows[0]);
  } catch (err) {
    res.status(401).json({ error: "Invalid Token" });
  }
});

// --- DEPOSIT ---
app.post('/deposit', async (req, res) => {
  const { phone, amount } = req.body;
  try {
    const user = await pool.query('SELECT * FROM users WHERE phone = $1', [phone]);
    const newBalance = parseFloat(user.rows[0].balance) + parseFloat(amount);
    await pool.query('UPDATE users SET balance = $1 WHERE phone = $2', [newBalance, phone]);
    res.json({ newBalance });
  } catch (err) {
    console.error("Deposit Error:", err);
    res.status(500).json({ error: "Deposit Failed" });
  }
});

// --- WITHDRAW (Fixed Logic) ---
app.post('/withdraw', async (req, res) => {
  console.log("Withdraw Request:", req.body);
  const { phone, amount } = req.body;
  
  // Validation
  if (!phone || !amount) return res.status(400).json({ success: false, message: "Missing data" });
  const withdrawAmount = parseFloat(amount);
  if (isNaN(withdrawAmount) || withdrawAmount <= 0) {
    return res.status(400).json({ success: false, message: "Invalid amount" });
  }

  try {
    // 1. Get User
    const user = await pool.query('SELECT * FROM users WHERE phone = $1', [phone]);
    if (user.rows.length === 0) return res.status(404).json({ success: false, message: "User not found" });

    const currentBalance = parseFloat(user.rows[0].balance);

    // 2. Check Balance
    if (currentBalance < withdrawAmount) {
      return res.status(400).json({ success: false, message: "Insufficient Funds" });
    }

    // 3. Update Balance
    const newBalance = currentBalance - withdrawAmount;
    await pool.query('UPDATE users SET balance = $1 WHERE phone = $2', [newBalance, phone]);
    
    console.log("Withdraw Success. New Balance:", newBalance);
    res.json({ success: true, newBalance, message: "Cash out successful!" });

  } catch (err) {
    console.error("WITHDRAW ERROR:", err);
    res.status(500).json({ success: false, message: "Server Error" });
  }
});

// 4. GAME LOGIC (Socket.io)
const io = new Server(server, { cors: { origin: "*" } });
let waitingPlayer = null;

io.on('connection', (socket) => {
  socket.on('FIND_MATCH', () => {
    if (waitingPlayer) {
      const matchId = 'match_' + Date.now();
      io.to(waitingPlayer.id).emit('GAME_START', { matchId });
      io.to(socket.id).emit('GAME_START', { matchId });
      waitingPlayer = null;
    } else {
      waitingPlayer = socket;
      socket.emit('WAITING');
    }
  });

  socket.on('ROLL_DICE', ({ matchId }) => {
    // Simple random roll logic
    const roll = Math.floor(Math.random() * 6) + 1;
    io.emit('ROLL_RESULT', { playerId: socket.id, roll }); 
  });
});

// 5. START
const PORT = process.env.PORT || 10000;
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));
