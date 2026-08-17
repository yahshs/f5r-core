import { useTranslation } from 'react-i18next';
import { motion } from 'framer-motion';
import { Shield } from 'lucide-react';
import { MainLayout } from '@/components/layout';
import { Card, CardContent } from '@/components/ui/card';

export default function PrivacyPage() {
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
              <Shield className="h-8 w-8 text-primary" />
            </div>
            <h1 className="text-4xl font-bold">{t('footer.privacy')}</h1>
          </motion.div>
        </div>
      </section>

      <section className="py-12">
        <div className="section-container">
          <Card className="mx-auto max-w-3xl">
            <CardContent className="prose prose-slate dark:prose-invert max-w-none p-8">
              <h2>1. Information We Collect</h2>
              <p>We collect information you provide directly, including name, email, and payment information.</p>
              
              <h2>2. How We Use Information</h2>
              <p>Your information is used to process orders, provide customer support, and improve our services.</p>
              
              <h2>3. Data Security</h2>
              <p>We use industry-standard encryption to protect your data.</p>
              
              <h2>4. Third-Party Sharing</h2>
              <p>We do not sell your personal information. Data may be shared with payment processors as necessary.</p>
              
              <h2>5. Your Rights</h2>
              <p>You have the right to access, correct, or delete your personal data.</p>
              
              <h2>6. Contact</h2>
              <p>For privacy inquiries, contact privacy@f5s.sa</p>
            </CardContent>
          </Card>
        </div>
      </section>
    </MainLayout>
  );
}
