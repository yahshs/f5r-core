import { useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Menu,
  X,
  ChevronDown,
  Globe,
  Moon,
  LogOut,
  Settings,
  LayoutDashboard,
  Search,
  Server,
  Sun,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import logoUrl from '/client_ratings/LOGO F5R T 1 yellow.png';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useAuthStore, useLanguageStore } from '@/store';
import { useLogout } from '@/hooks/useApi';
import { cn } from '@/lib/utils';
import { useTheme } from 'next-themes';

export default function Navbar() {
  const { t, i18n } = useTranslation();
  const location = useLocation();
  const navigate = useNavigate();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const { user, isAuthenticated } = useAuthStore();
  const { language, setLanguage } = useLanguageStore();
  const logoutMutation = useLogout();
  const { theme, setTheme } = useTheme();

  const logoTo = !isAuthenticated
    ? "/"
    : user?.role === "admin"
      ? "/admin"
      : user?.role === "seller"
        ? "/seller/dashboard"
        : "/account";

  const toggleLanguage = () => {
    const newLang = language === 'en' ? 'ar' : 'en';
    setLanguage(newLang);
    i18n.changeLanguage(newLang);
  };

  const toggleTheme = () => {
    const next = theme === 'dark' ? 'light' : 'dark';
    setTheme(next);
  };

  const handleLogout = async () => {
    await logoutMutation.mutateAsync();
    navigate('/');
  };

  const navLinks = [
    { href: '/', label: t('nav.home') },
    { href: '/faq', label: t('nav.faq') },
    { href: '/contact', label: t('nav.contact') },
  ];

  const isActive = (path: string) => location.pathname === path;

  return (
    <header className="sticky top-0 z-50 w-full border-b border-border/40 bg-background/80 backdrop-blur-xl">
      <nav className="section-container">
        <div className="relative flex h-16 items-center justify-between">
          {/* Logo */}
          <Link to={logoTo} className="flex items-center gap-2">
            <img
              src={logoUrl}
              alt="F5R"
              className="h-11 w-11 rounded-lg object-contain"
              loading="eager"
              decoding="async"
            />
            <span className="text-xl font-bold tracking-tight sr-only">F5R</span>
          </Link>

          {/* Desktop Navigation */}
          <div className="hidden items-center gap-1 lg:flex absolute left-1/2 -translate-x-1/2">
            {navLinks.map((link) => (
              <Link
                key={link.href}
                to={link.href}
                className={cn(
                  'px-4 py-2 text-sm font-medium transition-colors rounded-lg',
                  isActive(link.href)
                    ? 'text-primary bg-primary/5'
                    : 'text-muted-foreground hover:text-foreground hover:bg-muted'
                )}
              >
                {link.label}
              </Link>
            ))}
          </div>

          {/* Right Actions */}
          <div className="flex items-center gap-2">
            {/* Language Switcher */}
            <Button
              variant="ghost"
              size="icon"
              onClick={toggleLanguage}
              className="hidden sm:flex"
              title={language === "en" ? "🇸🇦 العربية" : "🇺🇸 English"}
              aria-label={language === "en" ? "Switch to Arabic" : "Switch to English"}
            >
              <Globe className="h-5 w-5" />
              <span className="sr-only">Toggle language</span>
            </Button>

            {/* Theme Toggle */}
            <Button
              variant="ghost"
              size="icon"
              onClick={toggleTheme}
              className="hidden sm:flex"
            >
              {theme === 'dark' ? <Sun className="h-5 w-5" /> : <Moon className="h-5 w-5" />}
              <span className="sr-only">Toggle theme</span>
            </Button>

            {/* Auth Actions */}
            {isAuthenticated && user ? (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" className="gap-2">
                    <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary text-primary-foreground">
                      {user.name.charAt(0).toUpperCase()}
                    </div>
                    <span className="hidden sm:inline">{user.name.split(' ')[0]}</span>
                    <ChevronDown className="h-4 w-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-56">
                  <div className="px-2 py-1.5">
                    <p className="text-sm font-medium">{user.name}</p>
                    <p className="text-xs text-muted-foreground">{user.email}</p>
                  </div>
                  <DropdownMenuSeparator />
                  {user.role === 'seller' && (
                    <DropdownMenuItem asChild>
                      <Link to="/seller/smm-providers" className="cursor-pointer">
                        <Server className="mr-2 h-4 w-4" />
                        {t('seller.nav.smmProviders')}
                      </Link>
                    </DropdownMenuItem>
                  )}
                  {user.role === 'admin' && (
                    <>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem asChild>
                        <Link to="/admin" className="cursor-pointer">
                          <LayoutDashboard className="mr-2 h-4 w-4" />
                          {t('nav.admin')}
                        </Link>
                      </DropdownMenuItem>
                    </>
                  )}
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={handleLogout} className="cursor-pointer text-destructive">
                    <LogOut className="mr-2 h-4 w-4" />
                    {t('nav.logout')}
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            ) : (
              <div className="hidden items-center gap-2 sm:flex">
                <Button variant="ghost" asChild>
                  <Link to="/auth/login">{t('nav.login')}</Link>
                </Button>
                <Button asChild className="btn-primary">
                  <Link to="/auth/register">{t('nav.register')}</Link>
                </Button>
              </div>
            )}

            {/* Mobile Menu Button */}
            <Button
              variant="ghost"
              size="icon"
              className="lg:hidden"
              onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
            >
              {mobileMenuOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
            </Button>
          </div>
        </div>

        {/* Mobile Menu */}
        <AnimatePresence>
          {mobileMenuOpen && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              className="overflow-hidden lg:hidden"
            >
              <div className="space-y-1 pb-4 pt-2">
                {navLinks.map((link) => (
                  <Link
                    key={link.href}
                    to={link.href}
                    onClick={() => setMobileMenuOpen(false)}
                    className={cn(
                      'block px-4 py-2 text-sm font-medium transition-colors rounded-lg',
                      isActive(link.href)
                        ? 'text-primary bg-primary/5'
                        : 'text-muted-foreground hover:text-foreground hover:bg-muted'
                    )}
                  >
                    {link.label}
                  </Link>
                ))}

                <div className="mt-4 flex flex-col gap-2 px-4">
                  <Button variant="outline" onClick={toggleLanguage} className="w-full justify-start">
                    <Globe className="mr-2 h-4 w-4" />
                    <span className="font-medium">
                      {language === "en" ? (
                        <>
                          <span className="emoji">🇸🇦</span> العربية
                        </>
                      ) : (
                        <>
                          <span className="emoji">🇺🇸</span> English
                        </>
                      )}
                    </span>
                  </Button>

                  <Button variant="outline" onClick={toggleTheme} className="w-full justify-start">
                    {theme === 'dark' ? <Sun className="mr-2 h-4 w-4" /> : <Moon className="mr-2 h-4 w-4" />}
                    <span className="font-medium">{theme === 'dark' ? 'Light mode' : 'Dark mode'}</span>
                  </Button>

                  {!isAuthenticated && (
                    <>
                      <Button variant="outline" asChild className="w-full">
                        <Link to="/auth/login" onClick={() => setMobileMenuOpen(false)}>
                          {t('nav.login')}
                        </Link>
                      </Button>
                      <Button asChild className="btn-primary w-full">
                        <Link to="/auth/register" onClick={() => setMobileMenuOpen(false)}>
                          {t('nav.register')}
                        </Link>
                      </Button>
                    </>
                  )}
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </nav>
    </header>
  );
}
