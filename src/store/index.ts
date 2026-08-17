import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { User, Service } from '@/types';

// Auth Store
interface AuthState {
  user: User | null;
  token: string | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  setUser: (user: User | null) => void;
  setToken: (token: string | null) => void;
  setLoading: (loading: boolean) => void;
  logout: () => void;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      user: null,
      token: null,
      isAuthenticated: false,
      isLoading: true,
      setUser: (user) => set({ user, isAuthenticated: !!user }),
      setToken: (token) => set({ token }),
      setLoading: (isLoading) => set({ isLoading }),
      logout: () => set({ user: null, token: null, isAuthenticated: false }),
    }),
    {
      name: 'auth-storage',
      partialize: (state) => ({ user: state.user, token: state.token }),
    }
  )
);

// Checkout Store
interface CheckoutState {
  service: Service | null;
  quantity: number;
  link: string;
  customFields: Record<string, string>;
  step: number;
  setService: (service: Service | null) => void;
  setQuantity: (quantity: number) => void;
  setLink: (link: string) => void;
  setCustomField: (name: string, value: string) => void;
  setStep: (step: number) => void;
  reset: () => void;
}

export const useCheckoutStore = create<CheckoutState>((set) => ({
  service: null,
  quantity: 0,
  link: '',
  customFields: {},
  step: 0,
  setService: (service) => set({ service, quantity: service?.minOrder || 0 }),
  setQuantity: (quantity) => set({ quantity }),
  setLink: (link) => set({ link }),
  setCustomField: (name, value) =>
    set((state) => ({ customFields: { ...state.customFields, [name]: value } })),
  setStep: (step) => set({ step }),
  reset: () => set({ service: null, quantity: 0, link: '', customFields: {}, step: 0 }),
}));

// Language Store (synced with i18n)
interface LanguageState {
  language: 'en' | 'ar';
  direction: 'ltr' | 'rtl';
  setLanguage: (lang: 'en' | 'ar') => void;
}

export const useLanguageStore = create<LanguageState>()(
  persist(
    (set) => ({
      language: 'en',
      direction: 'ltr',
      setLanguage: (language) => {
        const direction = language === 'ar' ? 'rtl' : 'ltr';
        document.documentElement.dir = direction;
        document.documentElement.lang = language;
        set({ language, direction });
      },
    }),
    {
      name: 'language-storage',
    }
  )
);

// UI Store
interface UIState {
  sidebarOpen: boolean;
  mobileMenuOpen: boolean;
  setSidebarOpen: (open: boolean) => void;
  setMobileMenuOpen: (open: boolean) => void;
  toggleSidebar: () => void;
  toggleMobileMenu: () => void;
}

export const useUIStore = create<UIState>((set) => ({
  sidebarOpen: true,
  mobileMenuOpen: false,
  setSidebarOpen: (sidebarOpen) => set({ sidebarOpen }),
  setMobileMenuOpen: (mobileMenuOpen) => set({ mobileMenuOpen }),
  toggleSidebar: () => set((state) => ({ sidebarOpen: !state.sidebarOpen })),
  toggleMobileMenu: () => set((state) => ({ mobileMenuOpen: !state.mobileMenuOpen })),
}));
