const express = require('express');
const bcrypt = require('bcrypt');
const router = express.Router();
const pool = require('../config/db');
const keystroke = require('../lib/keystroke');

// Parses the JSON timing array the browser sends alongside email/password.
// Returns null if it's missing or malformed, so keystroke scoring can be
// skipped gracefully (e.g. JS disabled) rather than breaking login.
function parseKeystrokeEvents(raw) {
  if (!raw) return null;
  try {
    const events = JSON.parse(raw);
    return Array.isArray(events) && events.length > 0 ? events : null;
  } catch {
    return null;
  }
}

async function getOrCreateProfile(customerId) {
  const [rows] = await pool.query(
    'SELECT * FROM keystroke_profiles WHERE customer_id = ?',
    [customerId]
  );
  if (rows[0]) {
    return {
      sample_count: rows[0].sample_count,
      mean_json: rows[0].mean_json,
      m2_json: rows[0].m2_json,
      enrolled: !!rows[0].enrolled
    };
  }
  return keystroke.blankProfile();
}

async function saveProfile(customerId, profile) {
  await pool.query(
    `INSERT INTO keystroke_profiles (customer_id, sample_count, mean_json, m2_json, enrolled)
     VALUES (?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE sample_count = ?, mean_json = ?, m2_json = ?, enrolled = ?`,
    [
      customerId, profile.sample_count, JSON.stringify(profile.mean_json), JSON.stringify(profile.m2_json), profile.enrolled,
      profile.sample_count, JSON.stringify(profile.mean_json), JSON.stringify(profile.m2_json), profile.enrolled
    ]
  );
}

// GET /login - home page / login screen (4.1.1)
router.get('/login', (req, res) => {
  res.render('login', { error: null });
});

// POST /login - email+password check, plus keystroke-dynamics scoring
// once a customer's typing baseline has finished enrolling (lib/keystroke.js).
// The keystroke result is a secondary signal only - a mismatch is logged,
// not used to block a login that already passed the password check. That
// mirrors how the rule-based transaction risk engine works: flag for
// review rather than silently fail the user.
router.post('/login', async (req, res) => {
  const { email, password } = req.body;
  const [rows] = await pool.query('SELECT * FROM customers WHERE email = ?', [email]);
  const customer = rows[0];

  if (customer && await bcrypt.compare(password, customer.password_hash)) {
    req.session.customer_id = customer.customer_id;

    const events = parseKeystrokeEvents(req.body.keystroke_events);
    if (events) {
      const features = keystroke.extractFeatures(events);
      let profile = await getOrCreateProfile(customer.customer_id);

      if (profile.enrolled) {
        const { avgZ, flagged } = keystroke.scoreAttempt(profile, features);
        await pool.query(
          `INSERT INTO keystroke_attempts (customer_id, features_json, avg_z_score, flagged)
           VALUES (?, ?, ?, ?)`,
          [customer.customer_id, JSON.stringify(features), avgZ, flagged]
        );
      } else {
        profile = keystroke.updateBaseline(profile, features);
        await saveProfile(customer.customer_id, profile);
      }
    }

    return res.redirect('/dashboard');
  }
  res.render('login', { error: 'Incorrect email or password.' });
});

// GET /register - new customer signup form (4.1.2)
router.get('/register', (req, res) => {
  res.render('register', { error: null });
});

// POST /register - creates account, checks for duplicate email first,
// every new customer starts with a demo balance of KES 10,000. The first
// typing sample (if captured) seeds their keystroke baseline.
router.post('/register', async (req, res) => {
  const { name, email, password } = req.body;

  const [existing] = await pool.query('SELECT customer_id FROM customers WHERE email = ?', [email]);
  if (existing.length > 0) {
    return res.render('register', { error: 'An account with that email already exists.' });
  }

  const password_hash = await bcrypt.hash(password, 10);
  const [result] = await pool.query(
    'INSERT INTO customers (name, email, password_hash, balance) VALUES (?, ?, ?, 10000.00)',
    [name, email, password_hash]
  );
  await pool.query(
    'INSERT INTO savings_accounts (customer_id, balance) VALUES (?, 0.00)',
    [result.insertId]
  );

  const events = parseKeystrokeEvents(req.body.keystroke_events);
  if (events) {
    const features = keystroke.extractFeatures(events);
    const profile = keystroke.updateBaseline(keystroke.blankProfile(), features);
    await saveProfile(result.insertId, profile);
  }

  res.redirect('/login');
});

// GET /logout
router.get('/logout', (req, res) => {
  req.session.destroy(() => res.redirect('/login'));
});

module.exports = router;