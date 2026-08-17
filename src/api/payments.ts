import { Payment } from '@/types';

const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

// Mock payments
const mockPayments: Payment[] = [];

export const paymentsApi = {
  // Process payment
  processPayment: async (data: {
    orderId: string;
    amount: number;
    method: Payment['method'];
  }): Promise<Payment> => {
    await delay(1500); // Simulate payment processing

    const payment: Payment = {
      id: `PAY-${Date.now()}`,
      userId: 'user-1', // Would come from auth
      orderId: data.orderId,
      amount: data.amount,
      currency: 'SAR',
      method: data.method,
      status: 'completed',
      transactionId: `TXN-${Date.now()}`,
      createdAt: new Date().toISOString(),
    };

    mockPayments.push(payment);
    return payment;
  },

  // Get user payments
  getUserPayments: async (userId: string): Promise<Payment[]> => {
    await delay(300);
    return mockPayments.filter(p => p.userId === userId);
  },

  // Get payment by ID
  getPaymentById: async (paymentId: string): Promise<Payment | null> => {
    await delay(200);
    return mockPayments.find(p => p.id === paymentId) || null;
  },

  // Refund payment
  refundPayment: async (paymentId: string): Promise<Payment> => {
    await delay(800);

    const paymentIndex = mockPayments.findIndex(p => p.id === paymentId);
    if (paymentIndex === -1) throw new Error('Payment not found');

    mockPayments[paymentIndex].status = 'refunded';
    return mockPayments[paymentIndex];
  },
};
