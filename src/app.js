const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
require('dotenv').config();

const webhookHandler = require('./webhooks/stripe');
const database = require('./database');
const adminRoutes = require('./routes/admin');

const app = express();
const PORT = process.env.PORT || 3000;

// Initialize database
database.initialize();

// Security middleware
app.use(helmet());
app.use(cors());

// Stripe webhook endpoint (raw body needed for signature verification)
app.use('/webhook/stripe', express.raw({ type: 'application/json' }), webhookHandler);

// JSON middleware for other routes
app.use(express.json());

// Admin routes
app.use('/admin', adminRoutes);

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'healthy', timestamp: new Date().toISOString() });
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('Error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

// 404 handler
app.use('*', (req, res) => {
  res.status(404).json({ error: 'Not found' });
});

app.listen(PORT, () => {
  console.log(`Subscription refund service running on port ${PORT}`);
});

module.exports = app;