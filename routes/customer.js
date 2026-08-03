const express = require('express');
const router = express.Router();
const pool = require('../config/db');
const { requireCustomer } = require('../middleware/auth');
const ml = require('../lib/transaction_ml');

// GET /dashboard - checking balance, tabbed sections (4.1.3)
router.get('/dashboard', requireCustomer, async (req, res) => {
  const customerId = req.session.customer_id;

  const [[customer]] = await pool.query(
    'SELECT * FROM customers WHERE customer_id = ?',
    [customerId]
  );

  let [[savings]] = await pool.query(
    'SELECT * FROM savings_accounts WHERE customer_id = ?',
    [customerId]
  );
  if (!savings) {
    // Safety net for accounts created before savings_accounts existed.
    await pool.query(
      'INSERT INTO savings_accounts (customer_id, balance) VALUES (?, 0.00)',
      [customerId]
    );
    savings = { balance: 0 };
  }

  const [transactions] = await pool.query(
    'SELECT * FROM transactions WHERE customer_id = ? ORDER BY created_at DESC',
    [customerId]
  );
  const [deposits] = await pool.query(
    'SELECT * FROM deposits WHERE customer_id = ? ORDER BY created_at DESC',
    [customerId]
  );
  const [savingsHistory] = await pool.query(
    'SELECT * FROM savings_transfers WHERE customer_id = ? ORDER BY created_at DESC',
    [customerId]
  );

  res.render('dashboard', {
    customer,
    savings,
    transactions,
    deposits,
    savingsHistory,
    activeTab: req.query.tab || 'overview',
    errors: {
      transfer: req.query.transfer_error || null,
      deposit: req.query.deposit_error || null,
      savings: req.query.savings_error || null
    }
  });
});

// POST /transfer - the core fraud-detection loop (4.3.2).
// Rule-based risk check: flagged if more than 3x the customer's average
// approved transaction size, or over a fixed ceiling of KES 50,000.
// Same transparent, explainable rule as the PHP version - not a trained
// machine-learning model, which is out of scope for this project's timeframe.
//
// As of this version, a second, independent signal runs alongside the fixed
// rule: unsupervised anomaly detection (lib/transaction_ml.js), which learns
// each customer's normal transaction pattern from their own history rather
// than a hard-coded threshold. Either signal flagging a transfer is enough
// to route it to SOC review.
router.post('/transfer', requireCustomer, async (req, res) => {
  const { recipient, amount } = req.body;
  const customerId = req.session.customer_id;
  const numericAmount = parseFloat(amount);

  if (!recipient || !numericAmount || numericAmount <= 0) {
    return res.redirect('/dashboard?transfer_error=' + encodeURIComponent('Enter a recipient and a valid amount.'));
  }

  const [[{ avg_amount }]] = await pool.query(
    `SELECT AVG(amount) AS avg_amount FROM transactions
     WHERE customer_id = ? AND status = 'approved'`,
    [customerId]
  );

  let ruleFlagged = false;
  if (avg_amount && numericAmount > avg_amount * 3) {
    ruleFlagged = true;
  } else if (numericAmount > 50000) {
    ruleFlagged = true;
  }

  // --- Transaction anomaly detection (unsupervised ML signal) ---
  const [[customer]] = await pool.query('SELECT balance FROM customers WHERE customer_id = ?', [customerId]);
  const [[recipientSeen]] = await pool.query(
    `SELECT 1 AS seen FROM transactions WHERE customer_id = ? AND recipient = ? AND status = 'approved' LIMIT 1`,
    [customerId, recipient]
  );
  const [[lastTransfer]] = await pool.query(
    'SELECT MAX(created_at) AS last_at FROM transactions WHERE customer_id = ?',
    [customerId]
  );

  const hoursSinceLastTransfer = lastTransfer.last_at
    ? (Date.now() - new Date(lastTransfer.last_at).getTime()) / 3600000
    : 720; // no prior transfers - treat as "long time since last activity"

  const features = ml.buildFeatureVector({
    amount: numericAmount,
    hourOfDay: new Date().getHours(),
    isNewRecipient: !recipientSeen,
    hoursSinceLastTransfer,
    amountToBalanceRatio: numericAmount / (Number(customer.balance) || 1)
  });

  let [txProfileRow] = await pool.query('SELECT * FROM transaction_profiles WHERE customer_id = ?', [customerId]);
  let txProfile = txProfileRow[0]
    ? { sample_count: txProfileRow[0].sample_count, mean_json: txProfileRow[0].mean_json, m2_json: txProfileRow[0].m2_json, enrolled: !!txProfileRow[0].enrolled }
    : ml.blankProfile();

  let mlFlagged = false;
  let mlScore = 0;
  if (txProfile.enrolled) {
    const result = ml.scoreAttempt(txProfile, features);
    mlFlagged = result.flagged;
    mlScore = result.avgZ;
  }

  const isSuspicious = ruleFlagged || mlFlagged;
  const status = isSuspicious ? 'flagged' : 'approved';

  const [result] = await pool.query(
    'INSERT INTO transactions (customer_id, recipient, amount, status) VALUES (?, ?, ?, ?)',
    [customerId, recipient, numericAmount, status]
  );

  // Log the anomaly score for review, and only fold this transfer into the
  // baseline if it was approved - training on flagged transfers would let
  // anomalies pull the "normal" baseline toward themselves over time.
  await pool.query(
    `INSERT INTO transaction_anomaly_scores (transaction_id, customer_id, features_json, avg_z_score, flagged)
     VALUES (?, ?, ?, ?, ?)`,
    [result.insertId, customerId, JSON.stringify(features), mlScore, mlFlagged]
  );
  if (status === 'approved') {
    const updated = ml.updateBaseline(txProfile, features);
    await pool.query(
      `INSERT INTO transaction_profiles (customer_id, sample_count, mean_json, m2_json, enrolled)
       VALUES (?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE sample_count = ?, mean_json = ?, m2_json = ?, enrolled = ?`,
      [
        customerId, updated.sample_count, JSON.stringify(updated.mean_json), JSON.stringify(updated.m2_json), updated.enrolled,
        updated.sample_count, JSON.stringify(updated.mean_json), JSON.stringify(updated.m2_json), updated.enrolled
      ]
    );
  }

  if (status === 'approved') {
    // Balance only moves for approved transfers - a flagged one leaves the
    // balance untouched until an SOC analyst resolves it.
    await pool.query(
      'UPDATE customers SET balance = balance - ? WHERE customer_id = ?',
      [numericAmount, customerId]
    );
  } else {
    // Flagged transaction: write a row to alerts so it appears in the SOC queue.
    await pool.query(
      'INSERT INTO alerts (transaction_id) VALUES (?)',
      [result.insertId]
    );
  }

  res.redirect('/dashboard?tab=overview');
});

// POST /deposit - simulates a cash/cheque/bank-transfer deposit.
// Deposits add funds rather than send them out, so they are not passed
// through the outbound fraud rule.
router.post('/deposit', requireCustomer, async (req, res) => {
  const customerId = req.session.customer_id;
  const numericAmount = parseFloat(req.body.amount);
  const method = req.body.method || 'cash';
  const validMethods = ['cash', 'cheque', 'bank_transfer'];

  if (!numericAmount || numericAmount <= 0 || !validMethods.includes(method)) {
    return res.redirect('/dashboard?tab=deposit&deposit_error=' + encodeURIComponent('Enter a valid deposit amount.'));
  }

  await pool.query(
    'INSERT INTO deposits (customer_id, amount, method) VALUES (?, ?, ?)',
    [customerId, numericAmount, method]
  );
  await pool.query(
    'UPDATE customers SET balance = balance + ? WHERE customer_id = ?',
    [numericAmount, customerId]
  );

  res.redirect('/dashboard?tab=deposit');
});

// POST /savings-transfer - moves funds between checking and savings.
// Internal move between the customer's own two balances - not sent to a
// third party, so it isn't screened by the outbound fraud rule.
router.post('/savings-transfer', requireCustomer, async (req, res) => {
  const customerId = req.session.customer_id;
  const numericAmount = parseFloat(req.body.amount);
  const direction = req.body.direction;

  if (!numericAmount || numericAmount <= 0 || !['to_savings', 'to_checking'].includes(direction)) {
    return res.redirect('/dashboard?tab=savings&savings_error=' + encodeURIComponent('Enter a valid amount and direction.'));
  }

  const [[customer]] = await pool.query('SELECT * FROM customers WHERE customer_id = ?', [customerId]);
  const [[savings]] = await pool.query('SELECT * FROM savings_accounts WHERE customer_id = ?', [customerId]);

  if (direction === 'to_savings' && numericAmount > customer.balance) {
    return res.redirect('/dashboard?tab=savings&savings_error=' + encodeURIComponent('Insufficient checking balance.'));
  }
  if (direction === 'to_checking' && numericAmount > savings.balance) {
    return res.redirect('/dashboard?tab=savings&savings_error=' + encodeURIComponent('Insufficient savings balance.'));
  }

  if (direction === 'to_savings') {
    await pool.query('UPDATE customers SET balance = balance - ? WHERE customer_id = ?', [numericAmount, customerId]);
    await pool.query('UPDATE savings_accounts SET balance = balance + ? WHERE customer_id = ?', [numericAmount, customerId]);
  } else {
    await pool.query('UPDATE savings_accounts SET balance = balance - ? WHERE customer_id = ?', [numericAmount, customerId]);
    await pool.query('UPDATE customers SET balance = balance + ? WHERE customer_id = ?', [numericAmount, customerId]);
  }

  await pool.query(
    'INSERT INTO savings_transfers (customer_id, direction, amount) VALUES (?, ?, ?)',
    [customerId, direction, numericAmount]
  );

  res.redirect('/dashboard?tab=savings');
});

module.exports = router;