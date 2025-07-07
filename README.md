# Subscription Refund Service

This repository now includes an automatic subscription refund processing service that handles prorated refunds when users cancel their subscriptions.

## Features

- **Automatic Refund Processing**: Listens to Stripe `customer.subscription.deleted` webhook events
- **Prorated Refund Calculation**: Calculates refunds based on remaining subscription time
- **Transaction History**: Maintains complete audit trail of all financial transactions
- **Error Handling**: Implements retry mechanisms and comprehensive error handling
- **Admin Interface**: Web-based dashboard for monitoring and managing refunds

## Setup

1. **Install Dependencies**:
   ```bash
   npm install
   ```

2. **Environment Configuration**:
   ```bash
   cp .env.example .env
   # Edit .env with your Stripe keys and configuration
   ```

3. **Start the Service**:
   ```bash
   npm start
   ```

## Configuration

### Environment Variables

- `STRIPE_SECRET_KEY`: Your Stripe secret key
- `STRIPE_WEBHOOK_SECRET`: Stripe webhook endpoint secret
- `PORT`: Service port (default: 3000)
- `DATABASE_PATH`: SQLite database path
- `MINIMUM_REFUND_AMOUNT`: Minimum refund threshold (default: $1.00)
- `GRACE_PERIOD_HOURS`: Grace period for refunds (default: 24 hours)
- `MAX_RETRY_ATTEMPTS`: Maximum retry attempts for failed refunds (default: 3)

### Nginx Configuration

The service is configured to work with nginx as a reverse proxy. The nginx configuration includes:

- Webhook endpoint: `/webhook/stripe`
- Admin interface: `/admin`
- Health check: `/health`

## API Endpoints

### Webhook Endpoint
- `POST /webhook/stripe` - Stripe webhook handler

### Admin Interface
- `GET /admin` - Web dashboard
- `GET /admin/stats` - System statistics
- `GET /admin/subscriptions` - List all subscriptions
- `GET /admin/refund-attempts` - List refund attempts
- `POST /admin/retry-refund/:subscriptionId` - Retry failed refund

### Health Check
- `GET /health` - Service health status

## Business Rules

- **Prorated Refunds**: Calculated based on remaining subscription time
- **Grace Period**: No refunds within 24 hours of subscription start
- **Minimum Threshold**: Refunds must be at least $1.00
- **Retry Logic**: Failed refunds are retried up to 3 times
- **Billing Cycles**: Supports monthly and yearly subscriptions

## Database Schema

The service uses SQLite with three main tables:
- `subscriptions`: Subscription details
- `transactions`: Payment and refund history
- `refund_attempts`: Refund processing attempts

## Testing

Run tests with:
```bash
npm test
```

## Monitoring

The admin interface provides:
- Real-time statistics
- Failed refund monitoring
- Transaction history
- Manual retry capabilities

## Security

- Webhook signature verification
- CORS protection
- Security headers via nginx
- Input validation and sanitization