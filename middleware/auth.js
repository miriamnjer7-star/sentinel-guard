// Route guards. Same idea as the PHP version's per-page session check:
// every protected page checks for its matching session variable before
// showing any data, and redirects back to the relevant login page if missing.

function requireCustomer(req, res, next) {
  if (!req.session.customer_id) {
    return res.redirect('/login');
  }
  next();
}

function requireAnalyst(req, res, next) {
  if (!req.session.analyst_id) {
    return res.redirect('/soc/login');
  }
  next();
}

module.exports = { requireCustomer, requireAnalyst };