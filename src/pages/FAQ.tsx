import { useTranslation } from 'react-i18next';
import { motion } from 'framer-motion';
import { HelpCircle, Plus, Minus } from 'lucide-react';
import { MainLayout } from '@/components/layout';
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion';

export default function FAQPage() {
  const { t } = useTranslation();

  const faqs = [
    { q: t('faq.q1'), a: t('faq.a1') },
    { q: t('faq.q2'), a: t('faq.a2') },
    { q: t('faq.q3'), a: t('faq.a3') },
    { q: t('faq.q4'), a: t('faq.a4') },
    { q: t('faq.q5'), a: t('faq.a5') },
  ];

  const containerVariants = {
    hidden: { opacity: 0 },
    visible: {
      opacity: 1,
      transition: { staggerChildren: 0.1 }
    }
  };

  const itemVariants = {
    hidden: { opacity: 0, y: 20 },
    visible: { opacity: 1, y: 0 }
  };

  return (
    <MainLayout>
      {/* Hero */}
      <section className="relative overflow-hidden bg-gradient-hero py-16 lg:py-24">
        <div className="absolute inset-0">
          <motion.div
            className="absolute top-20 left-1/4 h-64 w-64 rounded-full bg-primary/10 blur-3xl"
            animate={{ scale: [1, 1.2, 1], rotate: [0, 180, 360] }}
            transition={{ duration: 20, repeat: Infinity }}
          />
          <motion.div
            className="absolute bottom-10 right-1/4 h-48 w-48 rounded-full bg-accent/10 blur-3xl"
            animate={{ scale: [1, 1.3, 1] }}
            transition={{ duration: 15, repeat: Infinity }}
          />
        </div>
        <div className="section-container relative">
          <motion.div
            initial={{ opacity: 0, y: 30 }}
            animate={{ opacity: 1, y: 0 }}
            className="mx-auto max-w-2xl text-center"
          >
            <motion.div
              initial={{ scale: 0, rotate: -180 }}
              animate={{ scale: 1, rotate: 0 }}
              transition={{ delay: 0.2, type: 'spring', stiffness: 100 }}
              className="mx-auto mb-6 flex h-20 w-20 items-center justify-center rounded-2xl bg-primary/10"
            >
              <HelpCircle className="h-10 w-10 text-primary" />
            </motion.div>
            <h1 className="text-4xl font-bold lg:text-5xl">
              <span className="gradient-text">{t('faq.title')}</span>
            </h1>
            <p className="mt-4 text-lg text-muted-foreground">{t('faq.subtitle')}</p>
          </motion.div>
        </div>
      </section>

      {/* FAQ List */}
      <section className="py-12 lg:py-20">
        <div className="section-container">
          <motion.div
            variants={containerVariants}
            initial="hidden"
            animate="visible"
            className="mx-auto max-w-3xl"
          >
            <Accordion type="single" collapsible className="space-y-4">
              {faqs.map((faq, i) => (
                <motion.div key={i} variants={itemVariants}>
                  <AccordionItem
                    value={`item-${i}`}
                    className="rounded-xl border bg-card px-6 shadow-sm transition-shadow hover:shadow-md"
                  >
                    <AccordionTrigger className="text-left hover:no-underline py-5">
                      <span className="font-semibold pr-4">{faq.q}</span>
                    </AccordionTrigger>
                    <AccordionContent className="pb-5 text-muted-foreground">
                      {faq.a}
                    </AccordionContent>
                  </AccordionItem>
                </motion.div>
              ))}
            </Accordion>
          </motion.div>
        </div>
      </section>
    </MainLayout>
  );
}
