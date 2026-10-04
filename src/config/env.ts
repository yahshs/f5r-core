import { normalizeApiBaseUrl } from './apiBaseUrl';

// Environment configuration
// Replace these with actual values when connecting to backend

export const config = {
  API_BASE_URL: normalizeApiBaseUrl(import.meta.env.VITE_API_BASE_URL),
  APP_NAME: 'F5R',
  APP_DESCRIPTION: 'Premium Provider Marketplace',
  DEFAULT_LANGUAGE: 'en',
  SUPPORTED_LANGUAGES: ['en', 'ar'] as const,
  CURRENCY: 'SAR',
  CURRENCY_SYMBOL: '﷼',

  // Feature flags
  FEATURES: {
    WALLET: false,
    TICKETS: false,
    REFUND: false,
    MULTI_PAYMENT: false,
  },

  // Payment methods (placeholders)
  PAYMENT_METHODS: {
    APPLE_PAY: false,
    MADA: false,
    VISA: false,
    MASTERCARD: false,
  },
} as const;

export type SupportedLanguage = typeof config.SUPPORTED_LANGUAGES[number];
