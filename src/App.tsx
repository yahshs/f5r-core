import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { lazy, Suspense } from "react";
import '@/i18n';

// Pages
const HomePage = lazy(() => import("./pages/Home"));
const FAQPage = lazy(() => import("./pages/FAQ"));
const ContactPage = lazy(() => import("./pages/Contact"));
const TermsPage = lazy(() => import("./pages/Terms"));
const PrivacyPage = lazy(() => import("./pages/Privacy"));
const RefundPolicyPage = lazy(() => import("./pages/RefundPolicy"));
const LoginPage = lazy(() => import("./pages/auth/Login"));
const RegisterPage = lazy(() => import("./pages/auth/Register"));
const ForgotPasswordPage = lazy(() => import("./pages/auth/ForgotPassword"));
const AccountLayout = lazy(() => import("./pages/account/AccountLayout"));
const AccountOverview = lazy(() => import("./pages/account/AccountOverview"));
const AccountProfilePage = lazy(() => import("./pages/account/Profile"));
const AccountOrdersPage = lazy(() => import("./pages/account/Orders"));
const AccountBillingPage = lazy(() => import("./pages/account/Billing"));
const AccountTicketsPage = lazy(() => import("./pages/account/Tickets"));
const AdminLayout = lazy(() => import("./pages/admin/AdminLayout"));
const AdminDashboardPage = lazy(() => import("./pages/admin/Dashboard"));
const AdminAnalyticsPage = lazy(() => import("./pages/admin/Analytics"));
const AdminOrdersPage = lazy(() => import("./pages/admin/Orders"));
const AdminUsersPage = lazy(() => import("./pages/admin/Users"));
const AdminProvidersPage = lazy(() => import("./pages/admin/Providers"));
const AdminSettingsPage = lazy(() => import("./pages/admin/Settings"));
const AdminSallaConnectionsPage = lazy(() => import("./pages/admin/SallaConnections"));
const AdminSubscriptionRequestsPage = lazy(() => import("./pages/admin/SubscriptionRequests"));
const SellerLayout = lazy(() => import("./pages/seller/SellerLayout"));
const SellerDashboardPage = lazy(() => import("./pages/seller/Dashboard"));
const SellerAnalyticsPage = lazy(() => import("./pages/seller/Analytics"));
const SellerSmmProvidersPage = lazy(() => import("./pages/seller/SmmProviders"));
const SellerOrdersPage = lazy(() => import("./pages/seller/Orders"));
const SellerProductsPage = lazy(() => import("./pages/seller/Products"));
const SellerSallaIntegrationPage = lazy(() => import("./pages/seller/Salla"));
const SellerAccountPage = lazy(() => import("./pages/seller/Account"));
const NotFound = lazy(() => import("./pages/NotFound"));
import RequireRole from "./components/auth/RequireRole";
import { useCurrentUser } from "./hooks/useApi";

const queryClient = new QueryClient();

const AppPageFallback = () => (
  <div className="flex min-h-screen items-center justify-center bg-background" role="status" aria-live="polite">
    <div className="flex flex-col items-center gap-3">
      <div className="h-9 w-9 animate-spin rounded-full border-[3px] border-primary/20 border-t-primary" />
      <span className="sr-only">Loading</span>
    </div>
  </div>
);

const AppContent = () => {
  useCurrentUser();
  return (
    <BrowserRouter>
      <Suspense fallback={<AppPageFallback />}>
        <Routes>
          {/* Public Routes */}
          <Route path="/" element={<HomePage />} />
          <Route path="/faq" element={<FAQPage />} />
          <Route path="/contact" element={<ContactPage />} />
          <Route path="/terms" element={<TermsPage />} />
          <Route path="/privacy" element={<PrivacyPage />} />
          <Route path="/refund-policy" element={<RefundPolicyPage />} />
          
          {/* Auth Routes */}
          <Route path="/auth/login" element={<LoginPage />} />
          <Route path="/auth/register" element={<RegisterPage />} />
          <Route path="/auth/forgot-password" element={<ForgotPasswordPage />} />
          
          {/* Account Routes */}
          <Route
            path="/account"
            element={
              <RequireRole roles={["user"]}>
                <AccountLayout />
              </RequireRole>
            }
          >
            <Route index element={<AccountOverview />} />
            <Route path="profile" element={<AccountProfilePage />} />
            <Route path="orders" element={<AccountOrdersPage />} />
            <Route path="orders/:orderId" element={<AccountOrdersPage />} />
            <Route path="billing" element={<AccountBillingPage />} />
            <Route path="tickets" element={<AccountTicketsPage />} />
            <Route path="tickets/new" element={<AccountTicketsPage />} />
            <Route path="tickets/:ticketId" element={<AccountTicketsPage />} />
          </Route>
          
          {/* Admin Routes */}
          <Route
            path="/admin"
            element={
              <RequireRole roles={["admin"]}>
                <AdminLayout />
              </RequireRole>
            }
          >
            <Route index element={<AdminDashboardPage />} />
            <Route path="analytics" element={<AdminAnalyticsPage />} />
            <Route path="orders" element={<AdminOrdersPage />} />
            <Route path="orders/:orderId" element={<AdminOrdersPage />} />
            <Route path="providers" element={<AdminProvidersPage />} />
            <Route path="users" element={<AdminUsersPage />} />
            <Route path="salla-connections" element={<AdminSallaConnectionsPage />} />
            <Route path="subscription-requests" element={<AdminSubscriptionRequestsPage />} />
            <Route path="settings" element={<AdminSettingsPage />} />
          </Route>

          {/* Seller Routes */}
          <Route
            path="/seller"
            element={
              <RequireRole roles={["seller"]}>
                <SellerLayout />
              </RequireRole>
            }
          >
            <Route index element={<Navigate to="dashboard" replace />} />
            <Route path="dashboard" element={<SellerDashboardPage />} />
            <Route path="analytics" element={<SellerAnalyticsPage />} />
            <Route path="orders" element={<SellerOrdersPage />} />
            <Route path="products" element={<SellerProductsPage />} />
            <Route path="smm-providers" element={<SellerSmmProvidersPage />} />
            <Route path="salla" element={<SellerSallaIntegrationPage />} />
            <Route path="account" element={<SellerAccountPage />} />
          </Route>
          
          {/* Catch-all */}
          <Route path="*" element={<NotFound />} />
        </Routes>
      </Suspense>
    </BrowserRouter>
  );
};

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <AppContent />
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
