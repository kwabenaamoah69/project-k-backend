const pool = require('./db');

const createTables = async () => {
    try {
        // 1. Create Users Table (With the Two Wallets)
        await pool.query(`
            CREATE TABLE IF NOT EXISTS users (
                id SERIAL PRIMARY KEY,
                username VARCHAR(50) UNIQUE NOT NULL,
                phone VARCHAR(15) UNIQUE NOT NULL,
                password_hash VARCHAR(255) NOT NULL,
                deposit_balance INTEGER DEFAULT 0,  -- Locked (Must be played)
                winning_balance INTEGER DEFAULT 0,  -- Unlocked (Can be withdrawn)
                friend_code VARCHAR(10) UNIQUE,     -- For the Social Feature
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        `);

        // 2. Create Games Table (To record match history)
        await pool.query(`
            CREATE TABLE IF NOT EXISTS games (
                id SERIAL PRIMARY KEY,
                match_id VARCHAR(50) UNIQUE NOT NULL,
                game_type VARCHAR(20) NOT NULL,     -- 'SPAR', 'LUDO'
                player1_id INTEGER REFERENCES users(id),
                player2_id INTEGER REFERENCES users(id),
                winner_id INTEGER REFERENCES users(id),
                stake_amount INTEGER NOT NULL,      -- The Bet (e.g., 10)
                house_fee INTEGER NOT NULL,         -- Your Profit (e.g., 2)
                played_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        `);

        console.log("✅ Tables Created Successfully!");
        process.exit(0); // Stop the script
    } catch (err) {
        console.error("❌ Error creating tables:", err);
        process.exit(1);
    }
};

createTables();