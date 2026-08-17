// Environment configuration
// Replace these with actual values when connecting to backend

export const config = {
  API_BASE_URL: import.meta.env.VITE_API_BASE_URL || '/api',
  APP_NAME: 'F5R',
  APP_DESCRIPTION: 'Premium Provider Marketplace',
  DEFAULT_LANGUAGE: 'en',
  SUPPORTED_LANGUAGES: ['en', 'ar'] as const,
  CURRENCY: 'SAR',
  CURRENCY_SYMBOL: '﷼',
  
  // Feature flags
  FEATURES: {
    WALLET: true,
    TICKETS: true,
    REFUND: true,
    MULTI_PAYMENT: true,
  },
  
  // Payment methods (placeholders)
  PAYMENT_METHODS: {
    APPLE_PAY: true,
    MADA: true,
    VISA: true,
    MASTERCARD: true,
  },
} as const;

export type SupportedLanguage = typeof config.SUPPORTED_LANGUAGES[number];
