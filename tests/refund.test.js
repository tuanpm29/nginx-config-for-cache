const request = require('supertest');
const app = require('../src/app');
const database = require('../src/database');

describe('Refund Service Integration Tests', () => {
  let server;

  beforeAll(async () => {
    // Use test database
    process.env.DATABASE_PATH = ':memory:';
  });

  afterAll(async () => {
    if (server) {
      server.close();
    }
    database.close();
  });

  beforeEach(async () => {
    // Clean up database before each test
    await new Promise((resolve) => {
      database.db.serialize(() => {
        database.db.run('DELETE FROM refund_attempts');
        database.db.run('DELETE FROM transactions');
        database.db.run('DELETE FROM subscriptions', resolve);
      });
    });
  });

  describe('Health Check', () => {
    test('GET /health should return healthy status', async () => {
      const response = await request(app)
        .get('/health')
        .expect(200);

      expect(response.body.status).toBe('healthy');
      expect(response.body.timestamp).toBeDefined();
    });
  });

  describe('Admin API', () => {
    test('GET /admin/stats should return statistics', async () => {
      const response = await request(app)
        .get('/admin/stats')
        .expect(200);

      expect(response.body).toHaveProperty('total_subscriptions');
      expect(response.body).toHaveProperty('canceled_subscriptions');
      expect(response.body).toHaveProperty('total_refund_amount');
    });

    test('GET /admin/subscriptions should return empty array initially', async () => {
      const response = await request(app)
        .get('/admin/subscriptions')
        .expect(200);

      expect(Array.isArray(response.body)).toBe(true);
      expect(response.body.length).toBe(0);
    });

    test('GET /admin/refund-attempts should return empty array initially', async () => {
      const response = await request(app)
        .get('/admin/refund-attempts')
        .expect(200);

      expect(Array.isArray(response.body)).toBe(true);
      expect(response.body.length).toBe(0);
    });
  });

  describe('Database Operations', () => {
    test('should create and retrieve subscription', async () => {
      const subscription = {
        id: 'sub_test123',
        customer_id: 'cus_test123',
        status: 'active',
        current_period_start: Math.floor(Date.now() / 1000),
        current_period_end: Math.floor(Date.now() / 1000) + 2592000, // 30 days
        amount: 2000, // $20.00
        currency: 'usd',
        billing_cycle: 'month'
      };

      await database.createSubscription(subscription);
      const retrieved = await database.getSubscription('sub_test123');

      expect(retrieved).toBeDefined();
      expect(retrieved.id).toBe('sub_test123');
      expect(retrieved.customer_id).toBe('cus_test123');
      expect(retrieved.amount).toBe(2000);
    });

    test('should create and retrieve transaction', async () => {
      // First create a subscription
      const subscription = {
        id: 'sub_test123',
        customer_id: 'cus_test123',
        status: 'active',
        current_period_start: Math.floor(Date.now() / 1000),
        current_period_end: Math.floor(Date.now() / 1000) + 2592000,
        amount: 2000,
        currency: 'usd',
        billing_cycle: 'month'
      };
      await database.createSubscription(subscription);

      const transaction = {
        id: 'txn_test123',
        subscription_id: 'sub_test123',
        customer_id: 'cus_test123',
        type: 'payment',
        amount: 2000,
        currency: 'usd',
        status: 'completed',
        metadata: { test: true }
      };

      await database.createTransaction(transaction);
      const transactions = await database.getTransactionsBySubscription('sub_test123');

      expect(transactions.length).toBe(1);
      expect(transactions[0].id).toBe('txn_test123');
      expect(transactions[0].type).toBe('payment');
    });
  });
});