const express = require('express');
const bcrypt = require('bcrypt');
const router = express.Router();
const pool = require('../config/db');

// GET /login - home page / login screen (4.1.1)
router.get('/login', (req, res) => {
  res.render('login', { error: null });
});

// POST /login - single email+password check.
// Same simplification as the PHP prototype: this is a straightforward
// credential check rather than the full multi-factor flow described in
// Chapter Three. That's a deliberate scope decision, not the final design.
router.post('/login', async (req, res) => {
  const { email, password } = req.body;
  const [rows] = await pool.query('SELECT * FROM customers WHERE email = ?', [email]);
  const customer = rows[0];

  if (customer && await bcrypt.compare(password, customer.password_hash)) {
    req.session.customer_id = customer.customer_id;
    return res.redirect('/dashboard');
  }
  res.render('login', { error: 'Incorrect email or password.' });
});

// GET /register - new customer signup form (4.1.2)
router.get('/register', (req, res) => {
  res.render('register', { error: null });
});

// POST /register - creates account, checks for duplicate email first,
// every new customer starts with a demo balance of KES 10,000.
router.post('/register', async (req, res) => {
  const { name, email, password } = req.body;

  const [existing] = await pool.query('SELECT customer_id FROM customers WHERE email = ?', [email]);
  if (existing.length > 0) {
    return res.render('register', { error: 'An account with that email already exists.' });
  }

  const password_hash = await bcrypt.hash(password, 10);
  await pool.query(
    'INSERT INTO customers (name, email, password_hash, balance) VALUES (?, ?, ?, 10000.00)',
    [name, email, password_hash]
  );
  res.redirect('/login');
});

// GET /logout
router.get('/logout', (req, res) => {
  req.session.destroy(() => res.redirect('/login'));
});

module.exports = router;