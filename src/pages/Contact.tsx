import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { motion } from 'framer-motion';
import { Mail, Phone, Clock, Send, MessageSquare, MapPin } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Card, CardContent } from '@/components/ui/card';
import { MainLayout } from '@/components/layout';
import { toast } from '@/hooks/use-toast';

export default function ContactPage() {
  const { t } = useTranslation();
  const [isLoading, setIsLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    await new Promise(resolve => setTimeout(resolve, 1000));
    setIsLoading(false);
    toast({ title: 'Message sent!', description: 'We\'ll get back to you soon.' });
    (e.target as HTMLFormElement).reset();
  };

  const contactInfo = [
    { icon: Mail, title: 'Email', value: t('contact.info.email'), href: 'mailto:support@f5s.sa' },
    { icon: Phone, title: 'Phone', value: t('contact.info.phone'), href: 'tel:+966500000000' },
    { icon: Clock, title: 'Hours', value: t('contact.info.hours'), href: null },
  ];

  return (
    <MainLayout>
      {/* Hero */}
      <section className="relative overflow-hidden bg-gradient-hero py-16 lg:py-24">
        <div className="absolute inset-0">
          <motion.div
            className="absolute -top-20 -left-20 h-80 w-80 rounded-full bg-primary/10 blur-3xl"
            animate={{ scale: [1, 1.2, 1], x: [0, 40, 0] }}
            transition={{ duration: 10, repeat: Infinity }}
          />
          <motion.div
            className="absolute -bottom-20 -right-20 h-96 w-96 rounded-full bg-accent/10 blur-3xl"
            animate={{ scale: [1, 1.3, 1], y: [0, -40, 0] }}
            transition={{ duration: 12, repeat: Infinity }}
          />
        </div>
        <div className="section-container relative">
          <motion.div
            initial={{ opacity: 0, y: 30 }}
            animate={{ opacity: 1, y: 0 }}
            className="mx-auto max-w-2xl text-center"
          >
            <motion.div
              initial={{ scale: 0 }}
              animate={{ scale: 1 }}
              transition={{ delay: 0.2, type: 'spring' }}
              className="mx-auto mb-6 flex h-20 w-20 items-center justify-center rounded-2xl bg-primary/10"
            >
              <MessageSquare className="h-10 w-10 text-primary" />
            </motion.div>
            <h1 className="text-4xl font-bold lg:text-5xl">
              <span className="gradient-text">{t('contact.title')}</span>
            </h1>
            <p className="mt-4 text-lg text-muted-foreground">{t('contact.subtitle')}</p>
          </motion.div>
        </div>
      </section>

      {/* Contact Section */}
      <section className="py-12 lg:py-20">
        <div className="section-container">
          <div className="grid gap-8 lg:grid-cols-3">
            {/* Contact Info */}
            <motion.div
              initial={{ opacity: 0, x: -30 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: 0.2 }}
              className="space-y-6"
            >
              {contactInfo.map((item, i) => (
                <motion.div
                  key={item.title}
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.3 + i * 0.1 }}
                >
                  <Card className="transition-all hover:shadow-lg hover:-translate-y-1">
                    <CardContent className="flex items-center gap-4 p-6">
                      <div className="flex h-14 w-14 items-center justify-center rounded-xl bg-primary/10">
                        <item.icon className="h-6 w-6 text-primary" />
                      </div>
                      <div>
                        <p className="text-sm text-muted-foreground">{item.title}</p>
                        {item.href ? (
                          <a href={item.href} className="font-semibold hover:text-primary transition-colors">
                            {item.value}
                          </a>
                        ) : (
                          <p className="font-semibold">{item.value}</p>
                        )}
                      </div>
                    </CardContent>
                  </Card>
                </motion.div>
              ))}

              {/* Map placeholder */}
              <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.6 }}
              >
                <Card className="overflow-hidden">
                  <CardContent className="p-0">
                    <div className="flex h-48 items-center justify-center bg-muted">
                      <div className="text-center">
                        <MapPin className="mx-auto h-8 w-8 text-muted-foreground" />
                        <p className="mt-2 text-sm text-muted-foreground">Riyadh, Saudi Arabia</p>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </motion.div>
            </motion.div>

            {/* Contact Form */}
            <motion.div
              initial={{ opacity: 0, x: 30 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: 0.3 }}
              className="lg:col-span-2"
            >
              <Card className="shadow-xl">
                <CardContent className="p-8">
                  <form onSubmit={handleSubmit} className="space-y-6">
                    <div className="grid gap-6 sm:grid-cols-2">
                      <div className="space-y-2">
                        <Label htmlFor="name">{t('contact.form.name')}</Label>
                        <Input id="name" placeholder="John Doe" className="h-12" required />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="email">{t('contact.form.email')}</Label>
                        <Input id="email" type="email" placeholder="you@example.com" className="h-12" required />
                      </div>
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="subject">{t('contact.form.subject')}</Label>
                      <Input id="subject" placeholder="How can we help?" className="h-12" required />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="message">{t('contact.form.message')}</Label>
                      <Textarea
                        id="message"
                        placeholder="Your message..."
                        className="min-h-[160px] resize-none"
                        required
                      />
                    </div>
                    <Button type="submit" size="lg" className="w-full btn-primary" disabled={isLoading}>
                      {isLoading ? t('common.loading') : (
                        <>
                          <Send className="mr-2 h-5 w-5" />
                          {t('contact.form.submit')}
                        </>
                      )}
                    </Button>
                  </form>
                </CardContent>
              </Card>
            </motion.div>
          </div>
        </div>
      </section>
    </MainLayout>
  );
}
