// db.js (version CommonJS, recommandée pour ton projet)
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }, // OK pour Neon
});

module.exports = pool;
