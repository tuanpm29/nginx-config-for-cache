const express = require('express');
const database = require('../database');
const refundService = require('../services/refund');

const router = express.Router();

// Get all subscriptions with their transaction history
router.get('/subscriptions', async (req, res) => {
  try {
    const subscriptions = await new Promise((resolve, reject) => {
      database.db.all(`
        SELECT s.*, 
               COUNT(t.id) as transaction_count,
               SUM(CASE WHEN t.type = 'refund' THEN t.amount ELSE 0 END) as total_refunds
        FROM subscriptions s
        LEFT JOIN transactions t ON s.id = t.subscription_id
        GROUP BY s.id
        ORDER BY s.created_at DESC
      `, (err, rows) => {
        if (err) reject(err);
        else resolve(rows || []);
      });
    });
    
    res.json(subscriptions);
  } catch (error) {
    console.error('Error fetching subscriptions:', error);
    res.status(500).json({ error: 'Failed to fetch subscriptions' });
  }
});

// Get detailed transaction history for a subscription
router.get('/subscriptions/:id/transactions', async (req, res) => {
  try {
    const { id } = req.params;
    const transactions = await database.getTransactionsBySubscription(id);
    
    // Parse metadata JSON for better display
    const parsedTransactions = transactions.map(t => ({
      ...t,
      metadata: t.metadata ? JSON.parse(t.metadata) : {}
    }));
    
    res.json(parsedTransactions);
  } catch (error) {
    console.error('Error fetching transactions:', error);
    res.status(500).json({ error: 'Failed to fetch transactions' });
  }
});

// Get refund attempts for monitoring
router.get('/refund-attempts', async (req, res) => {
  try {
    const attempts = await new Promise((resolve, reject) => {
      database.db.all(`
        SELECT ra.*, s.customer_id, s.amount as subscription_amount, s.status as subscription_status
        FROM refund_attempts ra
        JOIN subscriptions s ON ra.subscription_id = s.id
        ORDER BY ra.created_at DESC
        LIMIT 100
      `, (err, rows) => {
        if (err) reject(err);
        else resolve(rows || []);
      });
    });
    
    res.json(attempts);
  } catch (error) {
    console.error('Error fetching refund attempts:', error);
    res.status(500).json({ error: 'Failed to fetch refund attempts' });
  }
});

// Get failed refunds that need attention
router.get('/failed-refunds', async (req, res) => {
  try {
    const failedRefunds = await database.getFailedRefundAttempts();
    res.json(failedRefunds);
  } catch (error) {
    console.error('Error fetching failed refunds:', error);
    res.status(500).json({ error: 'Failed to fetch failed refunds' });
  }
});

// Manually retry a failed refund
router.post('/retry-refund/:subscriptionId', async (req, res) => {
  try {
    const { subscriptionId } = req.params;
    
    // Get subscription details
    const subscription = await database.getSubscription(subscriptionId);
    if (!subscription) {
      return res.status(404).json({ error: 'Subscription not found' });
    }
    
    // Convert database format back to Stripe format for processing
    const stripeSubscription = {
      id: subscription.id,
      customer: subscription.customer_id,
      status: subscription.status,
      current_period_start: subscription.current_period_start,
      current_period_end: subscription.current_period_end,
      currency: subscription.currency,
      canceled_at: Math.floor(Date.now() / 1000), // Use current time for retry
      items: {
        data: [{
          price: {
            unit_amount: subscription.amount,
            recurring: { interval: subscription.billing_cycle }
          }
        }]
      }
    };
    
    const result = await refundService.handleSubscriptionCancellation(stripeSubscription);
    res.json(result);
    
  } catch (error) {
    console.error('Error retrying refund:', error);
    res.status(500).json({ error: 'Failed to retry refund' });
  }
});

// Get system statistics
router.get('/stats', async (req, res) => {
  try {
    const stats = await new Promise((resolve, reject) => {
      database.db.all(`
        SELECT 
          COUNT(DISTINCT s.id) as total_subscriptions,
          COUNT(DISTINCT CASE WHEN s.status = 'canceled' THEN s.id END) as canceled_subscriptions,
          COUNT(DISTINCT CASE WHEN t.type = 'refund' THEN t.subscription_id END) as refunded_subscriptions,
          SUM(CASE WHEN t.type = 'refund' THEN t.amount ELSE 0 END) as total_refund_amount,
          COUNT(CASE WHEN ra.status = 'failed' THEN 1 END) as failed_refund_attempts,
          COUNT(CASE WHEN ra.status = 'success' THEN 1 END) as successful_refund_attempts
        FROM subscriptions s
        LEFT JOIN transactions t ON s.id = t.subscription_id
        LEFT JOIN refund_attempts ra ON s.id = ra.subscription_id
      `, (err, rows) => {
        if (err) reject(err);
        else resolve(rows && rows[0] ? rows[0] : {
          total_subscriptions: 0,
          canceled_subscriptions: 0,
          refunded_subscriptions: 0,
          total_refund_amount: 0,
          failed_refund_attempts: 0,
          successful_refund_attempts: 0
        });
      });
    });
    
    res.json(stats);
  } catch (error) {
    console.error('Error fetching stats:', error);
    res.status(500).json({ error: 'Failed to fetch statistics' });
  }
});

// Simple admin dashboard HTML
router.get('/', (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html>
    <head>
        <title>Subscription Refund Admin</title>
        <style>
            body { font-family: Arial, sans-serif; margin: 20px; }
            .section { margin: 20px 0; padding: 15px; border: 1px solid #ddd; border-radius: 5px; }
            .stats { display: flex; gap: 20px; }
            .stat-box { padding: 10px; background: #f5f5f5; border-radius: 3px; }
            table { width: 100%; border-collapse: collapse; margin: 10px 0; }
            th, td { padding: 8px; text-align: left; border-bottom: 1px solid #ddd; }
            th { background-color: #f2f2f2; }
            .status-success { color: green; }
            .status-failed { color: red; }
            .status-pending { color: orange; }
            button { padding: 5px 10px; margin: 2px; cursor: pointer; }
        </style>
    </head>
    <body>
        <h1>Subscription Refund Administration</h1>
        
        <div class="section">
            <h2>System Statistics</h2>
            <div id="stats" class="stats">Loading...</div>
        </div>
        
        <div class="section">
            <h2>Failed Refunds</h2>
            <div id="failed-refunds">Loading...</div>
        </div>
        
        <div class="section">
            <h2>Recent Refund Attempts</h2>
            <div id="refund-attempts">Loading...</div>
        </div>

        <script>
            // Load statistics
            fetch('/admin/stats')
                .then(res => res.json())
                .then(data => {
                    document.getElementById('stats').innerHTML = \`
                        <div class="stat-box">Total Subscriptions: \${data.total_subscriptions || 0}</div>
                        <div class="stat-box">Canceled: \${data.canceled_subscriptions || 0}</div>
                        <div class="stat-box">Refunded: \${data.refunded_subscriptions || 0}</div>
                        <div class="stat-box">Total Refunds: $\${(data.total_refund_amount || 0) / 100}</div>
                        <div class="stat-box">Failed Attempts: \${data.failed_refund_attempts || 0}</div>
                        <div class="stat-box">Successful Attempts: \${data.successful_refund_attempts || 0}</div>
                    \`;
                });

            // Load failed refunds
            fetch('/admin/failed-refunds')
                .then(res => res.json())
                .then(data => {
                    if (data.length === 0) {
                        document.getElementById('failed-refunds').innerHTML = '<p>No failed refunds to retry.</p>';
                        return;
                    }
                    
                    let html = '<table><tr><th>Subscription ID</th><th>Customer</th><th>Attempt</th><th>Error</th><th>Actions</th></tr>';
                    data.forEach(item => {
                        html += \`<tr>
                            <td>\${item.subscription_id}</td>
                            <td>\${item.customer_id}</td>
                            <td>\${item.attempt_number}</td>
                            <td>\${item.error_message || 'N/A'}</td>
                            <td><button onclick="retryRefund('\${item.subscription_id}')">Retry</button></td>
                        </tr>\`;
                    });
                    html += '</table>';
                    document.getElementById('failed-refunds').innerHTML = html;
                });

            // Load recent refund attempts
            fetch('/admin/refund-attempts')
                .then(res => res.json())
                .then(data => {
                    if (data.length === 0) {
                        document.getElementById('refund-attempts').innerHTML = '<p>No refund attempts found.</p>';
                        return;
                    }
                    
                    let html = '<table><tr><th>Subscription ID</th><th>Customer</th><th>Status</th><th>Attempt</th><th>Created</th></tr>';
                    data.slice(0, 20).forEach(item => {
                        const statusClass = \`status-\${item.status}\`;
                        html += \`<tr>
                            <td>\${item.subscription_id}</td>
                            <td>\${item.customer_id}</td>
                            <td class="\${statusClass}">\${item.status}</td>
                            <td>\${item.attempt_number}</td>
                            <td>\${new Date(item.created_at).toLocaleString()}</td>
                        </tr>\`;
                    });
                    html += '</table>';
                    document.getElementById('refund-attempts').innerHTML = html;
                });

            function retryRefund(subscriptionId) {
                if (confirm('Retry refund for subscription ' + subscriptionId + '?')) {
                    fetch('/admin/retry-refund/' + subscriptionId, { method: 'POST' })
                        .then(res => res.json())
                        .then(data => {
                            alert('Retry result: ' + (data.success ? 'Success' : data.error));
                            location.reload();
                        })
                        .catch(err => alert('Error: ' + err.message));
                }
            }
        </script>
    </body>
    </html>
  `);
});

module.exports = router;