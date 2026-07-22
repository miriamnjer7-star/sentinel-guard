// Run once after setting up the database to create a demo SOC analyst
// account: node seed_analyst.js
// Equivalent to visiting seed_analyst.php once in the PHP version.

require('dotenv').config();
const bcrypt = require('bcrypt');
const pool = require('./config/db');

async function seed() {
  const email = 'analyst@sentinelguard.test';
  const password = 'analyst123';
  const password_hash = await bcrypt.hash(password, 10);

  const [existing] = await pool.query('SELECT analyst_id FROM analysts WHERE email = ?', [email]);
  if (existing.length > 0) {
    console.log('Demo analyst already exists.');
    process.exit(0);
  }

  await pool.query(
    'INSERT INTO analysts (name, email, password_hash) VALUES (?, ?, ?)',
    ['Demo Analyst', email, password_hash]
  );
  console.log(`Demo analyst created - email: ${email}, password: ${password}`);
  process.exit(0);
}

seed();