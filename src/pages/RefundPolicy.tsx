import { useTranslation } from 'react-i18next';
import { motion } from 'framer-motion';
import { RefreshCw } from 'lucide-react';
import { MainLayout } from '@/components/layout';
import { Card, CardContent } from '@/components/ui/card';

export default function RefundPolicyPage() {
  const { t } = useTranslation();

  return (
    <MainLayout>
      <section className="relative overflow-hidden bg-gradient-hero py-16">
        <div className="section-container relative">
          <motion.div
            initial={{ opacity: 0, y: 30 }}
            animate={{ opacity: 1, y: 0 }}
            className="mx-auto max-w-2xl text-center"
          >
            <div className="mx-auto mb-6 flex h-16 w-16 items-center justify-center rounded-2xl bg-primary/10">
              <RefreshCw className="h-8 w-8 text-primary" />
            </div>
            <h1 className="text-4xl font-bold">{t('footer.refund')}</h1>
          </motion.div>
        </div>
      </section>

      <section className="py-12">
        <div className="section-container">
          <Card className="mx-auto max-w-3xl">
            <CardContent className="prose prose-slate dark:prose-invert max-w-none p-8">
              <h2>Refund Policy</h2>
              <p>We strive for 100% customer satisfaction. Our refund policy covers the following scenarios:</p>
              
              <h3>Eligible for Refund</h3>
              <ul>
                <li>Order not started within 24 hours</li>
                <li>Significant under-delivery (less than 50% of ordered quantity)</li>
                <li>Duplicate orders (accidental double payment)</li>
              </ul>
              
              <h3>Not Eligible for Refund</h3>
              <ul>
                <li>Orders that have been fully or partially delivered</li>
                <li>Account suspension or deletion by the platform</li>
                <li>Incorrect link provided by customer</li>
                <li>Private accounts (when public access is required)</li>
              </ul>
              
              <h3>Refill Guarantee</h3>
              <p>Many services include a refill guarantee. If drops occur within the guarantee period, we will refill at no extra cost.</p>
              
              <h3>How to Request a Refund</h3>
              <p>Contact our support team with your order ID and reason for refund. We aim to respond within 24 hours.</p>
            </CardContent>
          </Card>
        </div>
      </section>
    </MainLayout>
  );
}
