const { Pool } = require('pg');
require('dotenv').config();

const isProduction = process.env.NODE_ENV === 'production';

// If we are on Render (Production), use the special Cloud URL
const connectionString = process.env.DATABASE_URL;

const pool = new Pool({
  connectionString: isProduction ? connectionString : undefined,
  // If not production, fallback to local settings (you can keep yours here if you want, or just rely on defaults)
  user: 'postgres',
  host: 'localhost',
  database: 'project-k',
  password: 'admin', // Update if your local password is different
  port: 5432,
  ssl: isProduction ? { rejectUnauthorized: false } : false // Cloud requires SSL
});

module.exports = {
  query: (text, params) => pool.query(text, params),
};