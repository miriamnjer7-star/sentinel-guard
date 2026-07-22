// Database connection pool.
// Equivalent role to config.php in the PHP version: every route pulls a
// connection from here rather than opening its own.

require('dotenv').config();
const mysql = require('mysql2/promise');

const pool = mysql.createPool({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  waitForConnections: true,
  connectionLimit: 10
});

// All queries use parameterized placeholders (?), which is what protects
// every query in the system from SQL injection - the same protection the
// PHP version got from PDO prepared statements.
module.exports = pool;