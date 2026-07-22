const express = require('express');
const bcrypt = require('bcrypt');
const router = express.Router();
const pool = require('../config/db');
const { requireAnalyst } = require('../middleware/auth');

// GET /soc/login - separate SOC analyst login screen
router.get('/soc/login', (req, res) => {
  res.render('soc_login', { error: null });
});

router.post('/soc/login', async (req, res) => {
  const { email, password } = req.body;
  const [rows] = await pool.query('SELECT * FROM analysts WHERE email = ?', [email]);
  const analyst = rows[0];

  if (analyst && await bcrypt.compare(password, analyst.password_hash)) {
    req.session.analyst_id = analyst.analyst_id;
    return res.redirect('/soc/dashboard');
  }
  res.render('soc_login', { error: 'Incorrect email or password.' });
});

// GET /soc/dashboard - single queue of flagged transactions (4.1.4).
// No separate case-detail page in this simplified build, same as the PHP version.
router.get('/soc/dashboard', requireAnalyst, async (req, res) => {
  const [alerts] = await pool.query(
    `SELECT a.alert_id, a.resolution, t.transaction_id, t.recipient, t.amount, t.created_at,
            c.name AS customer_name
     FROM alerts a
     JOIN transactions t ON a.transaction_id = t.transaction_id
     JOIN customers c ON t.customer_id = c.customer_id
     ORDER BY a.created_at DESC`
  );
  res.render('soc_dashboard', { alerts });
});

// POST /soc/resolve - analyst marks a case confirmed fraud or false positive (4.3.3)
router.post('/soc/resolve', requireAnalyst, async (req, res) => {
  const { alert_id, resolution } = req.body;
  await pool.query('UPDATE alerts SET resolution = ? WHERE alert_id = ?', [resolution, alert_id]);
  res.redirect('/soc/dashboard');
});

router.get('/soc/logout', (req, res) => {
  req.session.destroy(() => res.redirect('/soc/login'));
});

module.exports = router;