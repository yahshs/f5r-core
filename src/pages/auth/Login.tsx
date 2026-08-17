import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { motion } from 'framer-motion';
import { Mail, Lock, Eye, EyeOff, User, ArrowRight, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { useLogin, useDemoLogin } from '@/hooks/useApi';
import { toast } from '@/hooks/use-toast';
import logoUrl from '/client_ratings/LOGO F5R T 1 yellow.png';

export default function LoginPage() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const isRTL = i18n.language === 'ar';
  const [showPassword, setShowPassword] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  const loginMutation = useLogin();
  const demoLoginMutation = useDemoLogin();

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const { user } = await loginMutation.mutateAsync({ email, password });
      toast({ title: 'Welcome back!', description: 'Login successful' });
      navigate(user.role === 'seller' ? '/seller/account' : user.role === 'admin' ? '/admin' : '/account');
    } catch (error: any) {
      toast({ title: 'Error', description: error.message, variant: 'destructive' });
    }
  };

  const handleDemoLogin = async (role: 'seller' | 'admin') => {
    try {
      await demoLoginMutation.mutateAsync(role);
      toast({ title: 'Welcome!', description: `Logged in as demo ${role}` });
      navigate(role === 'admin' ? '/admin' : '/seller/account');
    } catch (error: any) {
      toast({ title: 'Error', description: error.message, variant: 'destructive' });
    }
  };

  return (
    <div className="relative min-h-screen flex items-center justify-center overflow-hidden bg-gradient-hero p-4">
      {/* Animated Background */}
      <div className="absolute inset-0 overflow-hidden">
        <motion.div
          className="absolute -top-40 -left-40 h-80 w-80 rounded-full bg-primary/20 blur-3xl"
          animate={{ scale: [1, 1.2, 1], x: [0, 50, 0], y: [0, 30, 0] }}
          transition={{ duration: 8, repeat: Infinity }}
        />
        <motion.div
          className="absolute -bottom-40 -right-40 h-96 w-96 rounded-full bg-accent/20 blur-3xl"
          animate={{ scale: [1, 1.3, 1], x: [0, -30, 0], y: [0, -50, 0] }}
          transition={{ duration: 10, repeat: Infinity }}
        />
        <motion.div
          className="absolute top-1/2 left-1/2 h-64 w-64 -translate-x-1/2 -translate-y-1/2 rounded-full bg-primary/10 blur-2xl"
          animate={{ scale: [1, 1.5, 1] }}
          transition={{ duration: 6, repeat: Infinity }}
        />
      </div>

      {/* Login Card */}
      <motion.div
        initial={{ opacity: 0, y: 40, scale: 0.95 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.5, type: 'spring' }}
        className="relative w-full max-w-md"
      >
        {/* Logo */}
        <motion.div 
          className="mb-8 text-center"
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2 }}
        >
          <Link to="/" className="inline-flex items-center gap-2">
            <img src={logoUrl} alt="F5R" className="h-16 w-16 rounded-xl object-contain shadow-lg" loading="eager" decoding="async" />
            <span className="text-2xl font-bold sr-only">F5R</span>
          </Link>
        </motion.div>

        <Card className="border-0 bg-card/80 backdrop-blur-xl shadow-2xl">
          <CardHeader className="text-center pb-2">
            <CardTitle className="text-2xl">{t('auth.login.title')}</CardTitle>
            <CardDescription>{t('auth.login.subtitle')}</CardDescription>
          </CardHeader>
          <CardContent className="p-6 pt-4">
            <form onSubmit={handleLogin} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="email">{t('auth.login.email')}</Label>
                <div className="relative">
                  <Mail className="absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    id="email"
                    type="email"
                    placeholder="you@example.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="pl-10 h-12"
                    required
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="password">{t('auth.login.password')}</Label>
                <div className="relative">
                  <Lock className="absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    id="password"
                    type={showPassword ? 'text' : 'password'}
                    placeholder="••••••••"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="pl-10 pr-10 h-12"
                    required
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  >
                    {showPassword ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
                  </button>
                </div>
              </div>

              <div className="flex items-center justify-between">
                <div className="flex items-center space-x-2">
                  <Checkbox id="remember" />
                  <Label htmlFor="remember" className="text-sm font-normal">
                    {t('auth.login.remember')}
                  </Label>
                </div>
                <Link to="/auth/forgot-password" className="text-sm text-primary hover:underline">
                  {t('auth.login.forgot')}
                </Link>
              </div>

              <Button
                type="submit"
                className="w-full h-12 btn-primary text-base"
                disabled={loginMutation.isPending}
              >
                {loginMutation.isPending ? t('common.loading') : t('auth.login.submit')}
                <ArrowRight className="ml-2 h-5 w-5" />
              </Button>
            </form>

            {/* Divider */}
            <div className="relative my-6">
              <div className="absolute inset-0 flex items-center">
                <div className="w-full border-t border-border" />
              </div>
              <div className="relative flex justify-center text-xs uppercase">
                <span className="bg-card px-2 text-muted-foreground">{t('common.or')}</span>
              </div>
            </div>

            {/* Demo Logins */}
            <div className="space-y-3">
              <Button
                variant="outline"
                className="w-full h-11 gap-2 border-2 border-primary/40 hover:border-primary hover:bg-primary/5"
                onClick={() => handleDemoLogin('seller')}
                disabled={demoLoginMutation.isPending}
              >
                <Sparkles className="h-4 w-4 text-primary" />
                {t('auth.demo.seller')}
              </Button>
              <Button
                variant="outline"
                className="w-full h-11 gap-2 border-2 border-accent/50 hover:border-accent hover:bg-accent/5"
                onClick={() => handleDemoLogin('admin')}
                disabled={demoLoginMutation.isPending}
              >
                <Sparkles className="h-4 w-4 text-accent" />
                {t('auth.demo.admin')}
              </Button>
            </div>

            <p className="mt-6 text-center text-sm text-muted-foreground">
              {t('auth.login.noAccount')}{' '}
              <Link to="/auth/register" className="text-primary font-medium hover:underline">
                {t('auth.login.signUp')}
              </Link>
            </p>
          </CardContent>
        </Card>
      </motion.div>
    </div>
  );
}
