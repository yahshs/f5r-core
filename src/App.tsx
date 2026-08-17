import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import '@/i18n';

// Pages
import HomePage from "./pages/Home";
import FAQPage from "./pages/FAQ";
import ContactPage from "./pages/Contact";
import TermsPage from "./pages/Terms";
import PrivacyPage from "./pages/Privacy";
import RefundPolicyPage from "./pages/RefundPolicy";
import LoginPage from "./pages/auth/Login";
import RegisterPage from "./pages/auth/Register";
import ForgotPasswordPage from "./pages/auth/ForgotPassword";
import AccountLayout from "./pages/account/AccountLayout";
import AccountOverview from "./pages/account/AccountOverview";
import AccountProfilePage from "./pages/account/Profile";
import AccountOrdersPage from "./pages/account/Orders";
import AccountBillingPage from "./pages/account/Billing";
import AccountTicketsPage from "./pages/account/Tickets";
import AdminLayout from "./pages/admin/AdminLayout";
import AdminDashboardPage from "./pages/admin/Dashboard";
import AdminAnalyticsPage from "./pages/admin/Analytics";
import AdminOrdersPage from "./pages/admin/Orders";
import AdminUsersPage from "./pages/admin/Users";
import AdminProvidersPage from "./pages/admin/Providers";
import AdminSettingsPage from "./pages/admin/Settings";
import AdminSallaConnectionsPage from "./pages/admin/SallaConnections";
import AdminSubscriptionRequestsPage from "./pages/admin/SubscriptionRequests";
import SellerLayout from "./pages/seller/SellerLayout";
import SellerDashboardPage from "./pages/seller/Dashboard";
import SellerAnalyticsPage from "./pages/seller/Analytics";
import SellerSmmProvidersPage from "./pages/seller/SmmProviders";
import SellerOrdersPage from "./pages/seller/Orders";
import SellerProductsPage from "./pages/seller/Products";
import SellerSallaIntegrationPage from "./pages/seller/Salla";
import SellerAccountPage from "./pages/seller/Account";
import NotFound from "./pages/NotFound";
import RequireRole from "./components/auth/RequireRole";
import { useCurrentUser } from "./hooks/useApi";

const queryClient = new QueryClient();

const AppContent = () => {
  useCurrentUser();
  return (
    <BrowserRouter>
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
              <RequireRole>
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
            <Route index element={<Navigate to="account" replace />} />
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
