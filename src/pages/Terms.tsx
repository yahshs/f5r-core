import { useTranslation } from 'react-i18next';
import { motion } from 'framer-motion';
import { FileText } from 'lucide-react';
import { MainLayout } from '@/components/layout';
import { Card, CardContent } from '@/components/ui/card';

export default function TermsPage() {
  const { t, i18n } = useTranslation();
  const isRTL = i18n.language === 'ar';

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
              <FileText className="h-8 w-8 text-primary" />
            </div>
            <h1 className="text-4xl font-bold">{t('footer.terms')}</h1>
          </motion.div>
        </div>
      </section>

      <section className="py-12">
        <div className="section-container">
          <Card className="mx-auto max-w-3xl">
            <CardContent className="prose prose-slate dark:prose-invert max-w-none p-8">
              {isRTL ? (
                <>
                  <h2>شروط الخدمة – F5R</h2>
                  <p>باستخدامك منصة F5R، فإنك تقرّ وتوافق على الشروط التالية:</p>

                  <h3>1. طبيعة الخدمة</h3>
                  <ul>
                    <li>F5R منصة تقنية توفّر لوحة تحكم لربط متاجر سلة بمزوّدي الخدمات وتنفيذ الطلبات بشكل تلقائي.</li>
                    <li>F5R لا تبيع خدمات متابعين مباشرة ولا تضمن نتائج الخدمات المقدّمة من المزوّدين الخارجيين.</li>
                  </ul>

                  <h3>2. مسؤولية المستخدم</h3>
                  <p>المستخدم مسؤول عن:</p>
                  <ul>
                    <li>اختيار المزوّد المناسب.</li>
                    <li>إعداد الخدمات والكميات بشكل صحيح.</li>
                    <li>التأكد من توافق الخدمات مع سياسات المنصات (تيك توك، إنستقرام، وغيرها).</li>
                    <li>أي خطأ في الإعداد أو الربط يتحمّل المستخدم مسؤوليته كاملة.</li>
                  </ul>

                  <h3>3. التنفيذ التلقائي</h3>
                  <ul>
                    <li>يتم تنفيذ الطلبات تلقائيًا بناءً على إعدادات المستخدم والبيانات الواردة من سلة.</li>
                    <li>F5R غير مسؤولة عن:</li>
                    <li>تأخير التنفيذ الناتج عن المزوّدين.</li>
                    <li>توقف أو أخطاء API من الطرف الثالث.</li>
                    <li>نقص أو فشل الخدمة ما لم يكن ناتجًا عن خلل مباشر في المنصة نفسها.</li>
                  </ul>

                  <h3>4. الضمانات</h3>
                  <p>لا يوجد ضمان على:</p>
                  <ul>
                    <li>ثبات الأعداد.</li>
                    <li>سرعة التنفيذ.</li>
                    <li>جودة الحسابات.</li>
                  </ul>
                  <p>إلا في حال كان الضمان مقدّمًا من المزوّد نفسه وليس من F5R.</p>

                  <h3>5. الدفع والاشتراكات</h3>
                  <ul>
                    <li>جميع المدفوعات مقابل الاشتراكات غير قابلة للاسترجاع بعد التفعيل.</li>
                    <li>في حال إساءة الاستخدام أو مخالفة الشروط، يحق لـ F5R إيقاف الحساب بدون تعويض.</li>
                  </ul>

                  <h3>6. الإيقاف والتعليق</h3>
                  <p>يحق لـ F5R:</p>
                  <ul>
                    <li>إيقاف أو تعليق أي حساب:</li>
                    <li>يستخدم المنصة لأغراض مخالفة.</li>
                    <li>يسبّب ضغطًا غير طبيعي أو إساءة استخدام للأنظمة.</li>
                    <li>يحاول التحايل أو اختراق النظام.</li>
                  </ul>

                  <h3>7. حدود المسؤولية</h3>
                  <p>F5R غير مسؤولة عن أي:</p>
                  <ul>
                    <li>خسائر مالية.</li>
                    <li>إيقاف حسابات المستخدم لدى المنصات الاجتماعية.</li>
                    <li>مخالفات ناتجة عن استخدام الخدمات.</li>
                  </ul>

                  <h3>8. التعديلات</h3>
                  <p>يحق لـ F5R تعديل شروط الخدمة في أي وقت، ويُعتبر استمرار استخدام المنصة موافقة ضمنية على التحديثات.</p>
                </>
              ) : (
                <>
                  <h2>1. Introduction</h2>
                  <p>Welcome to F5R. By using our services, you agree to these terms.</p>

                  <h2>2. Services</h2>
                  <p>F5R provides a platform that connects stores to external providers delivering followers, likes, views, comments, and related services across various platforms.</p>

                  <h2>3. User Responsibilities</h2>
                  <p>Users are responsible for providing accurate information and ensuring their use complies with platform terms of service.</p>

                  <h2>4. Payments</h2>
                  <p>All payments are processed securely. Prices are in Saudi Riyals (SAR).</p>

                  <h2>5. Refunds</h2>
                  <p>Refunds are available according to our refund policy. Please see our refund policy page for details.</p>

                  <h2>6. Limitation of Liability</h2>
                  <p>F5R is not liable for any issues arising from third-party platform policy changes.</p>

                  <h2>7. Contact</h2>
                  <p>For questions about these terms, contact support@f5s.sa</p>
                </>
              )}
            </CardContent>
          </Card>
        </div>
      </section>
    </MainLayout>
  );
}
