import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { motion } from 'framer-motion';
import { ArrowRight, Check, Headphones, RefreshCw, Shield, Star, Zap } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { MainLayout } from '@/components/layout';
import { mockTestimonials, platformConfig } from '@/api/mockData';
import { cn } from '@/lib/utils';

export default function HomePage() {
  const { t, i18n } = useTranslation();
  const isRTL = i18n.language === 'ar';

  const trustFeatures = [
    { icon: Shield, titleKey: 'home.trust.secure.title', descKey: 'home.trust.secure.description' },
    { icon: Headphones, titleKey: 'home.trust.support.title', descKey: 'home.trust.support.description' },
    { icon: Zap, titleKey: 'home.trust.fast.title', descKey: 'home.trust.fast.description' },
    { icon: RefreshCw, titleKey: 'home.trust.refill.title', descKey: 'home.trust.refill.description' },
  ];

  const steps = [
    { num: '01', titleKey: 'home.howItWorks.step1.title', descKey: 'home.howItWorks.step1.description' },
    { num: '02', titleKey: 'home.howItWorks.step2.title', descKey: 'home.howItWorks.step2.description' },
    { num: '03', titleKey: 'home.howItWorks.step3.title', descKey: 'home.howItWorks.step3.description' },
  ];

  return (
    <MainLayout>
      {/* Hero Section */}
      <section className="relative overflow-hidden bg-gradient-hero py-20 lg:py-32">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_30%_20%,hsl(var(--primary)/0.1),transparent_50%)]" />
        <div className="section-container relative">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6 }}
            className="mx-auto max-w-3xl text-center"
          >
            <h1 className="text-4xl font-bold tracking-tight sm:text-5xl lg:text-6xl">
              <span className="gradient-text">{t('home.hero.title')}</span>
            </h1>
            <p className="mt-6 text-lg text-muted-foreground sm:text-xl">
              {t('home.hero.subtitle')}
            </p>
            <div className="mt-10 flex flex-col items-center justify-center gap-4 sm:flex-row">
              <Button asChild size="lg" className="btn-primary min-w-[180px]">
                <Link to="/auth/register">
                  {t('auth.register.submit')}
                  <ArrowRight className={cn("h-4 w-4", isRTL ? "mr-2 rotate-180" : "ml-2")} />
                </Link>
              </Button>
              <Button asChild size="lg" variant="outline" className="min-w-[180px]">
                <Link to="/auth/login">{t('nav.login')}</Link>
              </Button>
            </div>
          </motion.div>
        </div>
      </section>

      {/* How It Works */}
      <section className="bg-muted/50 py-16 lg:py-24">
        <div className="section-container">
          <div className="text-center">
            <h2 className="text-3xl font-bold">{t('home.howItWorks.title')}</h2>
            <p className="mt-2 text-muted-foreground">{t('home.howItWorks.subtitle')}</p>
          </div>
          <div className="mt-12 grid gap-8 md:grid-cols-3">
            {steps.map((step, i) => (
              <motion.div
                key={step.num}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.15 }}
                className="relative text-center"
              >
                <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-primary text-2xl font-bold text-primary-foreground">
                  {step.num}
                </div>
                <h3 className="text-xl font-semibold">{t(step.titleKey)}</h3>
                <p className="mt-2 text-muted-foreground">{t(step.descKey)}</p>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* Trust Features */}
      <section className="py-16 lg:py-24">
        <div className="section-container">
          <div className="text-center">
            <h2 className="text-3xl font-bold">{t('home.trust.title')}</h2>
          </div>
          <div className="mt-12 grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
            {trustFeatures.map((feature, i) => (
              <motion.div
                key={feature.titleKey}
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ delay: i * 0.1 }}
              >
                <Card className="h-full text-center">
                  <CardContent className="p-6">
                    <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-lg bg-primary/10 text-primary">
                      <feature.icon className="h-6 w-6" />
                    </div>
                    <h3 className="font-semibold">{t(feature.titleKey)}</h3>
                    <p className="mt-2 text-sm text-muted-foreground">{t(feature.descKey)}</p>
                  </CardContent>
                </Card>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* Pricing */}
      <section className="py-16 lg:py-24">
        <div className="section-container">
          <div className="text-center">
            <h2 className="text-3xl font-bold">{t('home.pricing.title')}</h2>
            <p className="mt-2 text-muted-foreground">{t('home.pricing.subtitle')}</p>
          </div>

          <div className="mt-12 grid gap-6 md:grid-cols-2 lg:grid-cols-4">
            {[
              { key: 'basic', highlight: false },
              { key: 'plus', highlight: true },
              { key: 'pro', highlight: false },
              { key: 'special', highlight: false },
            ].map((plan, idx) => (
              <motion.div
                key={plan.key}
                initial={{ opacity: 0, y: 16 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: idx * 0.08 }}
              >
                <Card className={cn("h-full", plan.highlight && "border-primary shadow-glow")}>
                  <CardContent className="flex h-full flex-col p-6">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="text-sm font-medium text-muted-foreground">{t(`home.pricing.plans.${plan.key}.tag`)}</p>
                        <h3 className="mt-1 text-xl font-semibold">{t(`home.pricing.plans.${plan.key}.name`)}</h3>
                      </div>
                      {plan.highlight ? (
                        <span className="rounded-full bg-primary/10 px-3 py-1 text-xs font-medium text-primary">
                          {t('home.pricing.mostPopular')}
                        </span>
                      ) : null}
                    </div>

                    <div className="mt-4">
                      <span className="text-3xl font-bold">{t(`home.pricing.plans.${plan.key}.price`)}</span>
                      <span className="text-sm text-muted-foreground"> {t('home.pricing.perMonth')}</span>
                    </div>

                    <ul className="mt-6 space-y-3 text-sm">
                      {[1, 2, 3, 4].map((n) => (
                        <li key={n} className="flex items-start gap-2">
                          <Check className="mt-0.5 h-4 w-4 text-emerald-600" />
                          <span>{t(`home.pricing.plans.${plan.key}.features.f${n}`)}</span>
                        </li>
                      ))}
                    </ul>

                    <div className="mt-8">
                      <Button asChild className={cn("w-full", plan.highlight && "btn-primary")}>
                        <Link to="/auth/register">{t('home.pricing.cta')}</Link>
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* Testimonials */}
      <section className="bg-muted/50 py-16 lg:py-24">
        <div className="section-container">
          <div className="text-center">
            <h2 className="text-3xl font-bold">{t('home.testimonials.title')}</h2>
            <p className="mt-2 text-muted-foreground">{t('home.testimonials.subtitle')}</p>
          </div>
          <div className="mt-12 grid gap-6 md:grid-cols-2 lg:grid-cols-4">
            {mockTestimonials.map((testimonial, i) => (
              <motion.div
                key={testimonial.id}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.1 }}
              >
                <Card className="h-full">
                  <CardContent className="p-6">
                    <div className="mb-4 flex items-center gap-1">
                      {[...Array(5)].map((_, j) => (
                        <Star key={j} className={cn("h-4 w-4", j < testimonial.rating ? "fill-accent text-accent" : "text-muted")} />
                      ))}
                    </div>
                    <p className="text-sm text-muted-foreground">{isRTL ? testimonial.textAr : testimonial.text}</p>
                    <div className="mt-4 flex items-center gap-3">
                      <img src={testimonial.avatar} alt="" className="h-10 w-10 rounded-full" />
                      <span className="font-medium">{isRTL ? testimonial.nameAr : testimonial.name}</span>
                    </div>
                  </CardContent>
                </Card>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="py-16 lg:py-24">
        <div className="section-container">
          <Card className="overflow-hidden bg-gradient-primary">
            <CardContent className="p-8 text-center lg:p-12">
              <h2 className="text-2xl font-bold text-primary-foreground lg:text-3xl">
                {t('home.hero.title')}
              </h2>
              <p className="mt-4 text-primary-foreground/80">
                {t('home.hero.subtitle')}
              </p>
              <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
                <Button asChild size="lg" variant="secondary">
                  <Link to="/auth/register">{t('auth.register.submit')}</Link>
                </Button>
                <Button asChild size="lg" variant="outline" className="bg-white/10 text-white hover:bg-white/20">
                  <Link to="/auth/login">{t('nav.login')}</Link>
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      </section>
    </MainLayout>
  );
}
