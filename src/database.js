const sqlite3 = require('sqlite3').verbose();
const path = require('path');

class Database {
  constructor() {
    this.db = null;
  }

  initialize() {
    const dbPath = process.env.DATABASE_PATH || './data/transactions.db';
    this.db = new sqlite3.Database(dbPath, (err) => {
      if (err) {
        console.error('Database connection error:', err);
        throw err;
      }
      console.log('Connected to SQLite database');
      this.createTables();
    });
  }

  createTables() {
    const queries = [
      `CREATE TABLE IF NOT EXISTS subscriptions (
        id TEXT PRIMARY KEY,
        customer_id TEXT NOT NULL,
        status TEXT NOT NULL,
        current_period_start INTEGER NOT NULL,
        current_period_end INTEGER NOT NULL,
        amount INTEGER NOT NULL,
        currency TEXT NOT NULL,
        billing_cycle TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )`,
      
      `CREATE TABLE IF NOT EXISTS transactions (
        id TEXT PRIMARY KEY,
        subscription_id TEXT NOT NULL,
        customer_id TEXT NOT NULL,
        type TEXT NOT NULL CHECK (type IN ('payment', 'refund', 'cancellation')),
        amount INTEGER NOT NULL,
        currency TEXT NOT NULL,
        stripe_payment_intent_id TEXT,
        stripe_refund_id TEXT,
        status TEXT NOT NULL,
        metadata TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (subscription_id) REFERENCES subscriptions (id)
      )`,
      
      `CREATE TABLE IF NOT EXISTS refund_attempts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        subscription_id TEXT NOT NULL,
        transaction_id TEXT NOT NULL,
        attempt_number INTEGER NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('pending', 'success', 'failed')),
        error_message TEXT,
        retry_at DATETIME,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (subscription_id) REFERENCES subscriptions (id),
        FOREIGN KEY (transaction_id) REFERENCES transactions (id)
      )`
    ];

    queries.forEach(query => {
      this.db.run(query, (err) => {
        if (err) {
          console.error('Error creating table:', err);
        }
      });
    });
  }

  // Subscription operations
  async createSubscription(subscription) {
    return new Promise((resolve, reject) => {
      const query = `INSERT INTO subscriptions 
        (id, customer_id, status, current_period_start, current_period_end, amount, currency, billing_cycle) 
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)`;
      
      this.db.run(query, [
        subscription.id,
        subscription.customer_id,
        subscription.status,
        subscription.current_period_start,
        subscription.current_period_end,
        subscription.amount,
        subscription.currency,
        subscription.billing_cycle
      ], function(err) {
        if (err) reject(err);
        else resolve(this.lastID);
      });
    });
  }

  async getSubscription(id) {
    return new Promise((resolve, reject) => {
      this.db.get('SELECT * FROM subscriptions WHERE id = ?', [id], (err, row) => {
        if (err) reject(err);
        else resolve(row);
      });
    });
  }

  async updateSubscriptionStatus(id, status) {
    return new Promise((resolve, reject) => {
      this.db.run(
        'UPDATE subscriptions SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
        [status, id],
        function(err) {
          if (err) reject(err);
          else resolve(this.changes);
        }
      );
    });
  }

  // Transaction operations
  async createTransaction(transaction) {
    return new Promise((resolve, reject) => {
      const query = `INSERT INTO transactions 
        (id, subscription_id, customer_id, type, amount, currency, stripe_payment_intent_id, stripe_refund_id, status, metadata) 
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;
      
      this.db.run(query, [
        transaction.id,
        transaction.subscription_id,
        transaction.customer_id,
        transaction.type,
        transaction.amount,
        transaction.currency,
        transaction.stripe_payment_intent_id || null,
        transaction.stripe_refund_id || null,
        transaction.status,
        JSON.stringify(transaction.metadata || {})
      ], function(err) {
        if (err) reject(err);
        else resolve(this.lastID);
      });
    });
  }

  async getTransactionsBySubscription(subscriptionId) {
    return new Promise((resolve, reject) => {
      this.db.all(
        'SELECT * FROM transactions WHERE subscription_id = ? ORDER BY created_at DESC',
        [subscriptionId],
        (err, rows) => {
          if (err) reject(err);
          else resolve(rows);
        }
      );
    });
  }

  // Refund attempt operations
  async createRefundAttempt(attempt) {
    return new Promise((resolve, reject) => {
      const query = `INSERT INTO refund_attempts 
        (subscription_id, transaction_id, attempt_number, status, error_message, retry_at) 
        VALUES (?, ?, ?, ?, ?, ?)`;
      
      this.db.run(query, [
        attempt.subscription_id,
        attempt.transaction_id,
        attempt.attempt_number,
        attempt.status,
        attempt.error_message || null,
        attempt.retry_at || null
      ], function(err) {
        if (err) reject(err);
        else resolve(this.lastID);
      });
    });
  }

  async updateRefundAttempt(id, status, errorMessage = null) {
    return new Promise((resolve, reject) => {
      this.db.run(
        'UPDATE refund_attempts SET status = ?, error_message = ? WHERE id = ?',
        [status, errorMessage, id],
        function(err) {
          if (err) reject(err);
          else resolve(this.changes);
        }
      );
    });
  }

  async getFailedRefundAttempts() {
    return new Promise((resolve, reject) => {
      this.db.all(
        `SELECT ra.*, s.customer_id, s.amount as subscription_amount 
         FROM refund_attempts ra 
         JOIN subscriptions s ON ra.subscription_id = s.id 
         WHERE ra.status = 'failed' AND ra.retry_at <= datetime('now')`,
        (err, rows) => {
          if (err) reject(err);
          else resolve(rows);
        }
      );
    });
  }

  close() {
    if (this.db) {
      this.db.close();
    }
  }
}

module.exports = new Database();