require('dotenv').config();
const express = require('express');
const session = require('express-session');
const path = require('path');

const authRoutes = require('./routes/auth');
const customerRoutes = require('./routes/customer');
const socRoutes = require('./routes/soc');

const app = express();

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

app.use(session({
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false
}));

// Home page is the login screen - Sentinel-Guard has no public content (4.1.1)
app.get('/', (req, res) => res.redirect('/login'));

app.use('/', authRoutes);
app.use('/', customerRoutes);
app.use('/', socRoutes);

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Sentinel-Guard running at http://localhost:${PORT}`);
});