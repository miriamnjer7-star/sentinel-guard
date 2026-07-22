-- Sentinel-Guard database schema (Node/Express version)
-- Core entities from Chapter 3 (ERD): customers, transactions, analysts, alerts.
-- Added for the dashboard tabs: savings_accounts, deposits, savings_transfers.

CREATE DATABASE IF NOT EXISTS sentinel_guard;
USE sentinel_guard;

CREATE TABLE IF NOT EXISTS customers (
    customer_id     INT AUTO_INCREMENT PRIMARY KEY,
    name            VARCHAR(100) NOT NULL,
    email           VARCHAR(150) NOT NULL UNIQUE,
    password_hash   VARCHAR(255) NOT NULL,
    balance         DECIMAL(12,2) NOT NULL DEFAULT 10000.00,
    created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS analysts (
    analyst_id      INT AUTO_INCREMENT PRIMARY KEY,
    name            VARCHAR(100) NOT NULL,
    email           VARCHAR(150) NOT NULL UNIQUE,
    password_hash   VARCHAR(255) NOT NULL
);

CREATE TABLE IF NOT EXISTS transactions (
    transaction_id  INT AUTO_INCREMENT PRIMARY KEY,
    customer_id     INT NOT NULL,
    recipient       VARCHAR(150) NOT NULL,
    amount          DECIMAL(12,2) NOT NULL,
    status          ENUM('approved','flagged') NOT NULL,
    created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (customer_id) REFERENCES customers(customer_id)
);

CREATE TABLE IF NOT EXISTS alerts (
    alert_id        INT AUTO_INCREMENT PRIMARY KEY,
    transaction_id  INT NOT NULL,
    resolution      ENUM('confirmed_fraud','false_positive') DEFAULT NULL,
    created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (transaction_id) REFERENCES transactions(transaction_id)
);

-- One savings account per customer. Kept separate from the checking
-- balance in `customers` so the two are never confused in a query.
CREATE TABLE IF NOT EXISTS savings_accounts (
    customer_id     INT PRIMARY KEY,
    balance         DECIMAL(12,2) NOT NULL DEFAULT 0.00,
    created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (customer_id) REFERENCES customers(customer_id)
);

-- Cash/cheque deposits into the checking account. Deposits add funds
-- rather than send them out, so they are not passed through the
-- outbound fraud rule the way transfers are.
CREATE TABLE IF NOT EXISTS deposits (
    deposit_id      INT AUTO_INCREMENT PRIMARY KEY,
    customer_id     INT NOT NULL,
    amount          DECIMAL(12,2) NOT NULL,
    method          ENUM('cash','cheque','bank_transfer') NOT NULL DEFAULT 'cash',
    created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (customer_id) REFERENCES customers(customer_id)
);

-- Internal moves between a customer's own checking and savings balance.
CREATE TABLE IF NOT EXISTS savings_transfers (
    transfer_id     INT AUTO_INCREMENT PRIMARY KEY,
    customer_id     INT NOT NULL,
    direction       ENUM('to_savings','to_checking') NOT NULL,
    amount          DECIMAL(12,2) NOT NULL,
    created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (customer_id) REFERENCES customers(customer_id)
);