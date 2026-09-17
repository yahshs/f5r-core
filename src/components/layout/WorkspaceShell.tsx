import { useState, type ReactNode } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import type { LucideIcon } from 'lucide-react';
import { Globe2, LogOut, Menu, Radio, ShieldCheck } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet';
import { cn } from '@/lib/utils';
import { useLogout } from '@/hooks/useApi';
import { useAuthStore, useLanguageStore } from '@/store';
import logoUrl from '/client_ratings/LOGO F5R T 1 yellow.png';

export type WorkspaceNavItem = {
  path: string;
  icon: LucideIcon;
  label: string;
  exact?: boolean;
};

type WorkspaceShellProps = {
  children: ReactNode;
  navItems: WorkspaceNavItem[];
  workspaceLabel: string;
  workspaceHint: string;
};

function WorkspaceBrand({ workspaceLabel }: { workspaceLabel: string }) {
  return (
    <div className="flex items-center gap-3">
      <span className="relative grid h-12 w-12 shrink-0 place-items-center overflow-hidden rounded-[15px] border border-primary/25 bg-primary/[0.075] shadow-[0_12px_38px_hsl(var(--primary)/0.16)]">
        <img src={logoUrl} alt="F5R" className="h-10 w-10 object-contain" />
        <span className="pointer-events-none absolute inset-x-2 bottom-0 h-px bg-gradient-to-r from-transparent via-primary/80 to-transparent" />
      </span>
      <span className="min-w-0 leading-tight">
        <strong className="block truncate text-sm font-semibold tracking-[0.08em] text-foreground">F5R CORE</strong>
        <small className="mt-1 block truncate text-[11px] text-muted-foreground">{workspaceLabel}</small>
      </span>
    </div>
  );
}

function WorkspaceNav({
  items,
  onNavigate,
}: {
  items: WorkspaceNavItem[];
  onNavigate?: () => void;
}) {
  const location = useLocation();

  return (
    <nav className="space-y-1.5" aria-label="Workspace navigation">
      {items.map((item) => {
        const active = item.exact
          ? location.pathname === item.path
          : location.pathname === item.path || location.pathname.startsWith(`${item.path}/`);
        return (
          <Link
            key={item.path}
            to={item.path}
            onClick={onNavigate}
            aria-current={active ? 'page' : undefined}
            className={cn(
              'group relative flex min-h-11 items-center gap-3 overflow-hidden rounded-xl px-3.5 py-2.5 text-sm font-medium transition-all duration-200',
              active
                ? 'bg-gradient-to-l from-primary/[0.18] via-primary/[0.085] to-transparent text-primary shadow-[inset_-2px_0_hsl(var(--primary)),0_10px_30px_hsl(var(--primary)/0.055)]'
                : 'text-muted-foreground hover:bg-white/[0.04] hover:text-foreground',
            )}
          >
            <item.icon className={cn('h-[18px] w-[18px] shrink-0 transition-transform', !active && 'group-hover:scale-105')} />
            <span className="truncate">{item.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}

function WorkspaceStatus({ compact = false, isRTL }: { compact?: boolean; isRTL: boolean }) {
  return (
    <div className={cn('rounded-2xl border border-white/[0.07] bg-white/[0.025]', compact ? 'p-3' : 'p-3.5')}>
      <div className="flex items-center gap-2 text-xs text-primary">
        <span className="h-2 w-2 rounded-full bg-primary shadow-[0_0_0_4px_hsl(var(--primary)/0.09),0_0_18px_hsl(var(--primary)/0.28)]" />
        <span>{isRTL ? 'واجهة SIGNATURE' : 'SIGNATURE UI'}</span>
      </div>
      {!compact && (
        <>
          <strong className="mt-2.5 block text-sm font-medium text-foreground">{isRTL ? 'مركز التشغيل' : 'Operations center'}</strong>
          <small className="mt-1 block text-[11px] text-muted-foreground">Salla · Provider · Telegram</small>
        </>
      )}
    </div>
  );
}

export default function WorkspaceShell({ children, navItems, workspaceLabel, workspaceHint }: WorkspaceShellProps) {
  const { i18n } = useTranslation();
  const navigate = useNavigate();
  const { user } = useAuthStore();
  const { language, setLanguage } = useLanguageStore();
  const logoutMutation = useLogout();
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const isRTL = i18n.dir() === 'rtl';
  const firstName = user?.name?.trim().split(/\s+/)[0] || workspaceLabel;

  const toggleLanguage = () => {
    const nextLanguage = language === 'ar' ? 'en' : 'ar';
    setLanguage(nextLanguage);
    void i18n.changeLanguage(nextLanguage);
  };

  const handleLogout = async () => {
    await logoutMutation.mutateAsync();
    navigate('/auth/login');
  };

  return (
    <div className="dark f5r-workspace min-h-[100dvh] bg-background text-foreground" dir={isRTL ? 'rtl' : 'ltr'}>
      <div className="f5r-workspace-grid min-h-[100dvh] lg:grid lg:grid-cols-[248px_minmax(0,1fr)]">
        <aside
          className={cn(
            'f5r-workspace-sidebar hidden min-h-[100dvh] flex-col px-4 py-5 lg:sticky lg:top-0 lg:flex lg:h-[100dvh]',
            isRTL ? 'border-l' : 'border-r',
          )}
        >
          <WorkspaceBrand workspaceLabel={workspaceLabel} />
          <div className="my-5 h-px bg-gradient-to-r from-transparent via-white/[0.08] to-transparent" />
          <WorkspaceNav items={navItems} />
          <div className="mt-auto space-y-3 pt-6">
            <WorkspaceStatus isRTL={isRTL} />
            <div className="flex items-center gap-2 px-1">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={toggleLanguage}
                className="h-9 flex-1 justify-start gap-2 rounded-xl text-xs text-muted-foreground hover:bg-white/[0.04] hover:text-foreground"
              >
                <Globe2 className="h-4 w-4" />
                {language === 'ar' ? 'English' : 'العربية'}
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={handleLogout}
                disabled={logoutMutation.isPending}
                className="h-9 w-9 rounded-xl text-muted-foreground hover:bg-rose-400/[0.08] hover:text-rose-300"
                aria-label="تسجيل الخروج"
              >
                <LogOut className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </aside>

        <div className="min-w-0">
          <header className="f5r-workspace-topbar sticky top-0 z-40 flex min-h-[72px] items-center justify-between gap-3 px-3 sm:px-5 lg:px-7 xl:px-9">
            <div className="flex min-w-0 items-center gap-3">
              <Sheet open={mobileNavOpen} onOpenChange={setMobileNavOpen}>
                <SheetTrigger asChild>
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    className="h-10 w-10 shrink-0 rounded-xl border-primary/20 bg-primary/[0.06] lg:hidden"
                    aria-label="فتح القائمة"
                  >
                    <Menu className="h-5 w-5" />
                  </Button>
                </SheetTrigger>
                <SheetContent
                  side={isRTL ? 'right' : 'left'}
                  className="dark flex w-[290px] flex-col border-primary/10 bg-[#0b0e0f] p-0 text-foreground"
                >
                  <SheetHeader className="border-b border-white/[0.07] p-5 text-start">
                    <SheetTitle className="sr-only">{workspaceLabel}</SheetTitle>
                    <WorkspaceBrand workspaceLabel={workspaceLabel} />
                  </SheetHeader>
                  <div className="flex min-h-0 flex-1 flex-col overflow-y-auto p-4">
                    <WorkspaceNav items={navItems} onNavigate={() => setMobileNavOpen(false)} />
                    <div className="mt-auto space-y-3 pt-6">
                      <WorkspaceStatus isRTL={isRTL} />
                      <Button
                        type="button"
                        variant="outline"
                        onClick={toggleLanguage}
                        className="w-full justify-start gap-2 rounded-xl border-white/[0.08] bg-white/[0.025]"
                      >
                        <Globe2 className="h-4 w-4" />
                        {language === 'ar' ? 'English' : 'العربية'}
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        onClick={handleLogout}
                        disabled={logoutMutation.isPending}
                        className="w-full justify-start gap-2 rounded-xl border-rose-400/15 bg-rose-400/[0.045] text-rose-300 hover:bg-rose-400/[0.08] hover:text-rose-200"
                      >
                        <LogOut className="h-4 w-4" />
                        تسجيل الخروج
                      </Button>
                    </div>
                  </div>
                </SheetContent>
              </Sheet>

              <div className="min-w-0">
                <p className="truncate text-base font-semibold sm:text-lg">مرحبًا، {firstName}</p>
                <p className="mt-0.5 hidden truncate text-xs text-muted-foreground sm:block">{workspaceHint}</p>
              </div>
            </div>

            <div className="flex shrink-0 items-center gap-2 sm:gap-3">
              <span className="hidden items-center gap-1.5 rounded-full border border-emerald-400/15 bg-emerald-400/[0.055] px-3 py-1.5 text-[11px] text-emerald-300 sm:inline-flex">
                <Radio className="h-3.5 w-3.5" />
                SIGNATURE
              </span>
              <div className="hidden text-end md:block">
                <p className="max-w-40 truncate text-xs font-medium">{user?.name || workspaceLabel}</p>
                <p className="mt-0.5 max-w-40 truncate text-[10px] text-muted-foreground">{user?.email}</p>
              </div>
              <div className="relative grid h-10 w-10 place-items-center rounded-xl border border-primary/25 bg-primary/[0.075] font-semibold text-primary shadow-[0_8px_28px_hsl(var(--primary)/0.1)]">
                {(user?.name || 'F').charAt(0).toUpperCase()}
                <ShieldCheck className="absolute -bottom-1 -end-1 h-4 w-4 rounded-full bg-[#0b0e0f] p-0.5 text-emerald-400" />
              </div>
            </div>
          </header>

          <main className="f5r-workspace-main mx-auto w-full max-w-[1600px] px-3 py-4 sm:px-5 sm:py-6 lg:px-7 lg:py-7 xl:px-9">
            {children}
          </main>
        </div>
      </div>
    </div>
  );
}
