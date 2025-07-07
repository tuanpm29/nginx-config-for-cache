const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const database = require('../database');

class RefundService {
  constructor() {
    this.minimumRefundAmount = parseFloat(process.env.MINIMUM_REFUND_AMOUNT) || 1.00;
    this.gracePeriodHours = parseInt(process.env.GRACE_PERIOD_HOURS) || 24;
    this.maxRetryAttempts = parseInt(process.env.MAX_RETRY_ATTEMPTS) || 3;
  }

  /**
   * Calculate prorated refund amount based on remaining subscription time
   * @param {Object} subscription - Subscription object
   * @param {Date} cancellationDate - Date when subscription was canceled
   * @returns {number} Refund amount in cents
   */
  calculateProratedRefund(subscription, cancellationDate) {
    const periodStart = new Date(subscription.current_period_start * 1000);
    const periodEnd = new Date(subscription.current_period_end * 1000);
    const cancellation = new Date(cancellationDate);

    // Total period duration in milliseconds
    const totalPeriod = periodEnd.getTime() - periodStart.getTime();
    
    // Remaining time from cancellation to period end
    const remainingTime = periodEnd.getTime() - cancellation.getTime();

    // If already past the period end or in grace period, no refund
    if (remainingTime <= 0) {
      return 0;
    }

    // Check if within grace period
    const gracePeriodMs = this.gracePeriodHours * 60 * 60 * 1000;
    const timeSincePeriodStart = cancellation.getTime() - periodStart.getTime();
    
    if (timeSincePeriodStart <= gracePeriodMs) {
      // Within grace period, no refund
      return 0;
    }

    // Calculate prorated amount
    const proratedPercentage = remainingTime / totalPeriod;
    const refundAmount = Math.floor(subscription.amount * proratedPercentage);

    // Apply minimum refund threshold
    return refundAmount >= (this.minimumRefundAmount * 100) ? refundAmount : 0;
  }

  /**
   * Process refund through Stripe API
   * @param {string} subscriptionId - Stripe subscription ID
   * @param {number} refundAmount - Amount to refund in cents
   * @param {string} paymentIntentId - Original payment intent ID
   * @returns {Object} Refund result
   */
  async processStripeRefund(subscriptionId, refundAmount, paymentIntentId) {
    try {
      const refund = await stripe.refunds.create({
        payment_intent: paymentIntentId,
        amount: refundAmount,
        metadata: {
          subscription_id: subscriptionId,
          refund_type: 'prorated_cancellation'
        }
      });

      return {
        success: true,
        refund_id: refund.id,
        amount: refund.amount,
        status: refund.status,
        metadata: refund.metadata
      };
    } catch (error) {
      console.error('Stripe refund error:', error);
      return {
        success: false,
        error: error.message,
        error_code: error.code,
        error_type: error.type
      };
    }
  }

  /**
   * Handle subscription cancellation and process refund
   * @param {Object} subscription - Stripe subscription object
   * @returns {Object} Processing result
   */
  async handleSubscriptionCancellation(subscription) {
    try {
      console.log(`Processing cancellation for subscription: ${subscription.id}`);

      // Get the latest payment intent for this subscription
      const charges = await stripe.charges.list({
        customer: subscription.customer,
        limit: 10
      });

      const relevantCharge = charges.data.find(charge => 
        charge.metadata?.subscription_id === subscription.id ||
        charge.invoice && charge.invoice.subscription === subscription.id
      );

      if (!relevantCharge || !relevantCharge.payment_intent) {
        throw new Error('No payment intent found for subscription');
      }

      // Store subscription info
      const subscriptionData = {
        id: subscription.id,
        customer_id: subscription.customer,
        status: subscription.status,
        current_period_start: subscription.current_period_start,
        current_period_end: subscription.current_period_end,
        amount: subscription.items.data[0]?.price?.unit_amount || 0,
        currency: subscription.currency,
        billing_cycle: subscription.items.data[0]?.price?.recurring?.interval || 'month'
      };

      await database.createSubscription(subscriptionData);

      // Record cancellation transaction
      const cancellationTransaction = {
        id: `cancel_${subscription.id}_${Date.now()}`,
        subscription_id: subscription.id,
        customer_id: subscription.customer,
        type: 'cancellation',
        amount: 0,
        currency: subscription.currency,
        status: 'completed',
        metadata: {
          canceled_at: subscription.canceled_at,
          cancellation_details: subscription.cancellation_details
        }
      };

      await database.createTransaction(cancellationTransaction);

      // Calculate refund amount
      const cancellationDate = subscription.canceled_at ? 
        new Date(subscription.canceled_at * 1000) : new Date();
      
      const refundAmount = this.calculateProratedRefund(subscriptionData, cancellationDate);

      if (refundAmount === 0) {
        console.log(`No refund due for subscription ${subscription.id} (amount: $${refundAmount/100})`);
        return {
          success: true,
          refund_processed: false,
          reason: 'Below minimum threshold or within grace period'
        };
      }

      // Process refund
      const refundResult = await this.processStripeRefund(
        subscription.id,
        refundAmount,
        relevantCharge.payment_intent
      );

      // Create refund attempt record
      const refundAttempt = {
        subscription_id: subscription.id,
        transaction_id: cancellationTransaction.id,
        attempt_number: 1,
        status: refundResult.success ? 'success' : 'failed',
        error_message: refundResult.success ? null : refundResult.error
      };

      const attemptId = await database.createRefundAttempt(refundAttempt);

      if (refundResult.success) {
        // Record successful refund transaction
        const refundTransaction = {
          id: `refund_${subscription.id}_${Date.now()}`,
          subscription_id: subscription.id,
          customer_id: subscription.customer,
          type: 'refund',
          amount: refundAmount,
          currency: subscription.currency,
          stripe_refund_id: refundResult.refund_id,
          status: 'completed',
          metadata: {
            refund_type: 'prorated_cancellation',
            original_amount: subscriptionData.amount,
            refund_percentage: (refundAmount / subscriptionData.amount * 100).toFixed(2)
          }
        };

        await database.createTransaction(refundTransaction);

        console.log(`Refund processed successfully: $${refundAmount/100} for subscription ${subscription.id}`);
        
        return {
          success: true,
          refund_processed: true,
          refund_amount: refundAmount,
          refund_id: refundResult.refund_id,
          attempt_id: attemptId
        };
      } else {
        // Schedule retry if not exceeded max attempts
        if (refundAttempt.attempt_number < this.maxRetryAttempts) {
          const retryDate = new Date();
          retryDate.setHours(retryDate.getHours() + 1); // Retry in 1 hour
          
          await database.createRefundAttempt({
            ...refundAttempt,
            attempt_number: refundAttempt.attempt_number + 1,
            status: 'pending',
            retry_at: retryDate.toISOString(),
            error_message: null
          });
        }

        throw new Error(`Refund failed: ${refundResult.error}`);
      }

    } catch (error) {
      console.error('Error processing subscription cancellation:', error);
      return {
        success: false,
        error: error.message,
        refund_processed: false
      };
    }
  }

  /**
   * Retry failed refund attempts
   */
  async retryFailedRefunds() {
    try {
      const failedAttempts = await database.getFailedRefundAttempts();
      console.log(`Found ${failedAttempts.length} failed refund attempts to retry`);

      for (const attempt of failedAttempts) {
        if (attempt.attempt_number >= this.maxRetryAttempts) {
          console.log(`Max retry attempts reached for subscription ${attempt.subscription_id}`);
          continue;
        }

        console.log(`Retrying refund for subscription ${attempt.subscription_id}, attempt ${attempt.attempt_number + 1}`);

        // This would involve re-processing the refund with updated attempt numbers
        // Implementation depends on storing payment intent IDs and other required data
      }
    } catch (error) {
      console.error('Error retrying failed refunds:', error);
    }
  }
}

module.exports = new RefundService();