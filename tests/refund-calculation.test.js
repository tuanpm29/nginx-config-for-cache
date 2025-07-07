const refundService = require('../src/services/refund');

describe('Refund Calculation Tests', () => {

  describe('calculateProratedRefund', () => {
    test('should calculate correct prorated refund for mid-period cancellation', () => {
      const subscription = {
        current_period_start: Math.floor(Date.now() / 1000) - 86400 * 10, // 10 days ago
        current_period_end: Math.floor(Date.now() / 1000) + 86400 * 20, // 20 days from now
        amount: 3000 // $30.00
      };
      
      const cancellationDate = new Date(); // Cancel now (10 days into 30-day period)
      
      const refundAmount = refundService.calculateProratedRefund(subscription, cancellationDate);
      
      // Should refund for remaining 20 days out of 30 days = 66.67%
      // But need to account for grace period (24 hours)
      expect(refundAmount).toBeGreaterThan(1000); // At least $10
      expect(refundAmount).toBeLessThan(3000); // Less than full amount
    });

    test('should return 0 for cancellation within grace period', () => {
      const subscription = {
        current_period_start: Math.floor(Date.now() / 1000) - 3600, // 1 hour ago
        current_period_end: Math.floor(Date.now() / 1000) + 86400 * 29, // 29 days from now
        amount: 3000 // $30.00
      };
      
      const cancellationDate = new Date(); // Cancel now (within 24-hour grace period)
      
      const refundAmount = refundService.calculateProratedRefund(subscription, cancellationDate);
      
      expect(refundAmount).toBe(0);
    });

    test('should return 0 for cancellation after period end', () => {
      const subscription = {
        current_period_start: Math.floor(Date.now() / 1000) - 86400 * 30, // 30 days ago
        current_period_end: Math.floor(Date.now() / 1000) - 86400, // 1 day ago
        amount: 3000 // $30.00
      };
      
      const cancellationDate = new Date(); // Cancel now (after period ended)
      
      const refundAmount = refundService.calculateProratedRefund(subscription, cancellationDate);
      
      expect(refundAmount).toBe(0);
    });

    test('should return 0 for refund below minimum threshold', () => {
      const subscription = {
        current_period_start: Math.floor(Date.now() / 1000) - 86400 * 25, // 25 days ago
        current_period_end: Math.floor(Date.now() / 1000) + 86400 * 5, // 5 days from now
        amount: 300 // $3.00
      };
      
      const cancellationDate = new Date(); // Cancel now (small remaining amount)
      
      const refundAmount = refundService.calculateProratedRefund(subscription, cancellationDate);
      
      // Prorated amount would be very small, below $1.00 minimum
      expect(refundAmount).toBe(0);
    });

    test('should handle yearly subscription correctly', () => {
      const oneYearAgo = Math.floor(Date.now() / 1000) - (86400 * 180); // 6 months ago
      const sixMonthsFromNow = Math.floor(Date.now() / 1000) + (86400 * 180); // 6 months from now
      
      const subscription = {
        current_period_start: oneYearAgo,
        current_period_end: sixMonthsFromNow,
        amount: 12000 // $120.00 yearly
      };
      
      const cancellationDate = new Date(); // Cancel at midpoint
      
      const refundAmount = refundService.calculateProratedRefund(subscription, cancellationDate);
      
      // Should refund approximately half (6 months remaining)
      expect(refundAmount).toBeGreaterThan(5000); // More than $50
      expect(refundAmount).toBeLessThan(7000); // Less than $70
    });
  });
});