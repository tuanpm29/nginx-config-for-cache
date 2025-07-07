const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const refundService = require('../services/refund');

const endpointSecret = process.env.STRIPE_WEBHOOK_SECRET;

async function handleStripeWebhook(req, res) {
  const sig = req.headers['stripe-signature'];

  let event;

  try {
    // Verify webhook signature
    event = stripe.webhooks.constructEvent(req.body, sig, endpointSecret);
  } catch (err) {
    console.error('Webhook signature verification failed:', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  console.log(`Received webhook event: ${event.type}`);

  // Handle the event
  try {
    switch (event.type) {
      case 'customer.subscription.deleted':
        await handleSubscriptionDeleted(event.data.object);
        break;
        
      case 'customer.subscription.updated':
        await handleSubscriptionUpdated(event.data.object);
        break;
        
      case 'invoice.payment_succeeded':
        await handlePaymentSucceeded(event.data.object);
        break;
        
      default:
        console.log(`Unhandled event type: ${event.type}`);
    }
  } catch (error) {
    console.error(`Error handling webhook event ${event.type}:`, error);
    return res.status(500).json({ error: 'Webhook processing failed' });
  }

  res.json({ received: true });
}

async function handleSubscriptionDeleted(subscription) {
  console.log('Processing subscription deletion:', subscription.id);
  
  try {
    const result = await refundService.handleSubscriptionCancellation(subscription);
    
    if (result.success && result.refund_processed) {
      console.log(`Refund processed successfully for subscription ${subscription.id}: $${result.refund_amount/100}`);
    } else if (result.success && !result.refund_processed) {
      console.log(`No refund processed for subscription ${subscription.id}: ${result.reason}`);
    } else {
      console.error(`Failed to process refund for subscription ${subscription.id}: ${result.error}`);
    }
  } catch (error) {
    console.error('Error in handleSubscriptionDeleted:', error);
  }
}

async function handleSubscriptionUpdated(subscription) {
  console.log('Processing subscription update:', subscription.id);
  
  // Handle subscription updates that might affect refund eligibility
  if (subscription.cancel_at_period_end) {
    console.log(`Subscription ${subscription.id} marked for cancellation at period end`);
    // Could track this for future processing
  }
}

async function handlePaymentSucceeded(invoice) {
  console.log('Processing successful payment:', invoice.id);
  
  // Record payment transaction for audit trail
  if (invoice.subscription) {
    try {
      // This could store payment information for refund calculations
      console.log(`Payment succeeded for subscription ${invoice.subscription}: $${invoice.amount_paid/100}`);
    } catch (error) {
      console.error('Error recording payment:', error);
    }
  }
}

module.exports = handleStripeWebhook;