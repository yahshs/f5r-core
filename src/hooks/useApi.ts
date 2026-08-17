import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { ordersApi } from '@/api/orders';
import { authApi } from '@/api/auth';
import { ticketsApi } from '@/api/tickets';
import { paymentsApi } from '@/api/payments';
import { smmProvidersApi } from '@/api/smmProviders';
import { sellerProductsApi } from '@/api/sellerProducts';
import { sellerSallaApi } from '@/api/sellerSalla';
import { adminUsersApi } from '@/api/adminUsers';
import { adminProvidersApi } from '@/api/adminProviders';
import { adminProductsApi } from '@/api/adminProducts';
import { adminSallaApi } from '@/api/adminSalla';
import { adminAuditLogsApi } from '@/api/adminAuditLogs';
import { adminSettingsApi } from '@/api/adminSettings';
import { adminCategoriesApi } from '@/api/adminCategories';
import { adminSummaryApi } from '@/api/adminSummary';
import { adminAnalyticsApi } from '@/api/adminAnalytics';
import { sellerAnalyticsApi } from '@/api/sellerAnalytics';
import { sellerSubscriptionApi } from '@/api/sellerSubscription';
import { sellerNotificationsApi } from '@/api/sellerNotifications';
import { adminSubscriptionRequestsApi } from '@/api/adminSubscriptionRequests';
import { OrderFilters, TicketPriority, UserRole } from '@/types';
import { useAuthStore } from '@/store';

// Orders Hooks
export const useUserOrders = (filters: OrderFilters = {}, page = 1, limit = 10) => {
  const { user } = useAuthStore();
  return useQuery({
    queryKey: ['orders', 'user', user?.id, filters, page, limit],
    queryFn: () => ordersApi.getUserOrders(user?.id || '', filters, page, limit),
    enabled: !!user?.id,
  });
};

export const useAllOrders = (filters: OrderFilters = {}, page = 1, limit = 10) => {
  return useQuery({
    queryKey: ['orders', 'all', filters, page, limit],
    queryFn: () => ordersApi.getAllOrders(filters, page, limit),
  });
};

export const useOrder = (orderId: string) => {
  return useQuery({
    queryKey: ['order', orderId],
    queryFn: () => ordersApi.getOrderById(orderId),
    enabled: !!orderId,
  });
};

export const useCreateOrder = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ordersApi.createOrder,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['orders'] });
    },
  });
};

export const useApproveOrder = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ordersApi.approveOrder,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['orders'] });
    },
  });
};

export const useRejectOrder = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ orderId, reason }: { orderId: string; reason: string }) =>
      ordersApi.rejectOrder(orderId, reason),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['orders'] });
    },
  });
};

// Auth Hooks
export const useLogin = () => {
  const { setUser, setToken, setLoading } = useAuthStore();
  return useMutation({
    mutationFn: ({ email, password }: { email: string; password: string }) =>
      authApi.login(email, password),
    onSuccess: ({ user, token }) => {
      setUser(user);
      setToken(token);
      setLoading(false);
    },
  });
};

export const useDemoLogin = () => {
  const { setUser, setToken, setLoading } = useAuthStore();
  return useMutation({
    mutationFn: (role: UserRole) => authApi.demoLogin(role),
    onSuccess: ({ user, token }) => {
      setUser(user);
      setToken(token);
      setLoading(false);
    },
  });
};

export const useRegister = () => {
  const { setUser, setToken, setLoading } = useAuthStore();
  return useMutation({
    mutationFn: authApi.register,
    onSuccess: ({ user, token }) => {
      setUser(user);
      setToken(token);
      setLoading(false);
    },
  });
};

export const useLogout = () => {
  const { logout } = useAuthStore();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: authApi.logout,
    onSuccess: () => {
      logout();
      queryClient.clear();
    },
  });
};

export const useCurrentUser = () => {
  const { setUser, setLoading, token } = useAuthStore();
  return useQuery({
    queryKey: ['currentUser', token],
    queryFn: async () => {
      if (!token) {
        setUser(null);
        setLoading(false);
        return null;
      }
      try {
        const user = await authApi.getCurrentUser();
        setUser(user);
        return user;
      } catch {
        setUser(null);
        return null;
      } finally {
        setLoading(false);
      }
    },
    staleTime: Infinity,
    retry: false,
  });
};

// Tickets Hooks
export const useUserTickets = (page = 1, limit = 10) => {
  const { user } = useAuthStore();
  return useQuery({
    queryKey: ['tickets', 'user', user?.id, page, limit],
    queryFn: () => ticketsApi.getUserTickets(user?.id || '', page, limit),
    enabled: !!user?.id,
  });
};

export const useTicket = (ticketId: string) => {
  return useQuery({
    queryKey: ['ticket', ticketId],
    queryFn: () => ticketsApi.getTicketById(ticketId),
    enabled: !!ticketId,
  });
};

export const useCreateTicket = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: { subject: string; message: string; priority: TicketPriority; orderId?: string }) =>
      ticketsApi.createTicket(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tickets'] });
    },
  });
};

export const useAddTicketReply = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ ticketId, message, isAdmin }: { ticketId: string; message: string; isAdmin?: boolean }) =>
      ticketsApi.addReply(ticketId, message, isAdmin),
    onSuccess: (_, { ticketId }) => {
      queryClient.invalidateQueries({ queryKey: ['ticket', ticketId] });
      queryClient.invalidateQueries({ queryKey: ['tickets'] });
    },
  });
};

// Payments Hooks
export const useProcessPayment = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: paymentsApi.processPayment,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['payments'] });
      queryClient.invalidateQueries({ queryKey: ['orders'] });
    },
  });
};

export const useDeleteOrder = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (orderId: string) => ordersApi.deleteOrder(orderId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['orders'] });
    },
  });
};

// Seller SMM Providers
export const useSellerSmmProviders = () => {
  const { user } = useAuthStore();
  return useQuery({
    queryKey: ['seller', 'smmProviders', user?.id],
    queryFn: smmProvidersApi.list,
    enabled: !!user?.id && user?.role === 'seller',
  });
};

export const useSellerAnalytics = (days = 14) => {
  return useQuery({
    queryKey: ['seller', 'analytics', days],
    queryFn: () => sellerAnalyticsApi.get(days),
  });
};

export const useAdminAnalytics = (days = 14) => {
  return useQuery({
    queryKey: ['admin', 'analytics', days],
    queryFn: () => adminAnalyticsApi.get(days),
  });
};

export const useAdminAnalyticsRange = (range: 'day' | 'week' | 'month' | 'all') => {
  return useQuery({
    queryKey: ['admin', 'analytics', 'range', range],
    queryFn: () => adminAnalyticsApi.getRange(range),
  });
};

export const useCreateSellerSmmProvider = () => {
  const queryClient = useQueryClient();
  const { user } = useAuthStore();
  return useMutation({
    mutationFn: smmProvidersApi.create,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['seller', 'smmProviders', user?.id] });
    },
  });
};

export const useUpdateSellerSmmProvider = () => {
  const queryClient = useQueryClient();
  const { user } = useAuthStore();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: Parameters<typeof smmProvidersApi.update>[1] }) =>
      smmProvidersApi.update(id, input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['seller', 'smmProviders', user?.id] });
    },
  });
};

export const useDeleteSellerSmmProvider = () => {
  const queryClient = useQueryClient();
  const { user } = useAuthStore();
  return useMutation({
    mutationFn: smmProvidersApi.remove,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['seller', 'smmProviders', user?.id] });
    },
  });
};

export const useTestSellerSmmProvider = () => {
  const queryClient = useQueryClient();
  const { user } = useAuthStore();
  return useMutation({
    mutationFn: smmProvidersApi.test,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['seller', 'smmProviders', user?.id] });
    },
  });
};

// Seller Subscription / Upgrade requests
export const useSellerSubscription = () => {
  const { user } = useAuthStore();
  return useQuery({
    queryKey: ['seller', 'subscription', user?.id],
    queryFn: sellerSubscriptionApi.get,
    enabled: !!user?.id && user?.role === 'seller',
  });
};

export const useRequestSubscriptionUpgrade = () => {
  const queryClient = useQueryClient();
  const { user } = useAuthStore();
  return useMutation({
    mutationFn: (requestedPlan: Parameters<typeof sellerSubscriptionApi.requestUpgrade>[0]) =>
      sellerSubscriptionApi.requestUpgrade(requestedPlan),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['seller', 'subscription', user?.id] });
    },
  });
};

export const useSellerNotifications = () => {
  const { user } = useAuthStore();
  return useQuery({
    queryKey: ['seller', 'notifications', user?.id],
    queryFn: sellerNotificationsApi.get,
    enabled: !!user?.id && user?.role === 'seller',
  });
};

export const useUpdateSellerNotifications = () => {
  const queryClient = useQueryClient();
  const { user } = useAuthStore();
  return useMutation({
    mutationFn: sellerNotificationsApi.update,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['seller', 'notifications', user?.id] });
    },
  });
};

export const useRegenerateSellerNotificationLink = () => {
  const queryClient = useQueryClient();
  const { user } = useAuthStore();
  return useMutation({
    mutationFn: sellerNotificationsApi.regenerateLink,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['seller', 'notifications', user?.id] });
    },
  });
};

export const useUnlinkSellerTelegram = () => {
  const queryClient = useQueryClient();
  const { user } = useAuthStore();
  return useMutation({
    mutationFn: sellerNotificationsApi.unlink,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['seller', 'notifications', user?.id] });
    },
  });
};

// Admin subscription upgrade requests
export const useAdminSubscriptionRequests = (input?: { status?: 'PENDING' | 'APPROVED' | 'REJECTED'; limit?: number }) => {
  const { user } = useAuthStore();
  return useQuery({
    queryKey: ['admin', 'subscriptionRequests', input],
    queryFn: () => adminSubscriptionRequestsApi.list(input),
    enabled: !!user?.id && user?.role === 'admin',
  });
};

export const useReviewAdminSubscriptionRequest = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: { status: 'APPROVED' | 'REJECTED'; note?: string } }) =>
      adminSubscriptionRequestsApi.review(id, patch),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'subscriptionRequests'] });
    },
  });
};

// Seller Salla (manual webhook config)
export const useSellerSallaStatus = () => {
  const { user } = useAuthStore();
  return useQuery({
    queryKey: ['seller', 'salla', 'status', user?.id],
    queryFn: sellerSallaApi.status,
    enabled: !!user?.id && user?.role === 'seller',
  });
};

export const useSaveSellerSallaConfig = () => {
  const queryClient = useQueryClient();
  const { user } = useAuthStore();
  return useMutation({
    mutationFn: sellerSallaApi.saveConfig,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['seller', 'salla', 'status', user?.id] });
      queryClient.invalidateQueries({ queryKey: ['seller', 'salla', 'webhookInfo', user?.id] });
    },
  });
};

export const useStartSellerSallaConnect = () => {
  return useMutation({
    mutationFn: sellerSallaApi.connectStart,
  });
};

export const useDisconnectSellerSalla = () => {
  const queryClient = useQueryClient();
  const { user } = useAuthStore();
  return useMutation({
    mutationFn: sellerSallaApi.disconnect,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['seller', 'salla', 'status', user?.id] });
      queryClient.invalidateQueries({ queryKey: ['seller', 'salla', 'webhookInfo', user?.id] });
      queryClient.invalidateQueries({ queryKey: ['seller', 'salla', 'metrics', user?.id] });
      queryClient.invalidateQueries({ queryKey: ['seller', 'salla', 'recentActivity', user?.id] });
    },
  });
};

export const useRotateSellerSallaToken = () => {
  const queryClient = useQueryClient();
  const { user } = useAuthStore();
  return useMutation({
    mutationFn: sellerSallaApi.rotateToken,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['seller', 'salla', 'status', user?.id] });
      queryClient.invalidateQueries({ queryKey: ['seller', 'salla', 'webhookInfo', user?.id] });
    },
  });
};

export const useSellerSallaWebhookInfo = () => {
  const { user } = useAuthStore();
  return useQuery({
    queryKey: ['seller', 'salla', 'webhookInfo', user?.id],
    queryFn: sellerSallaApi.webhookInfo,
    enabled: !!user?.id && user?.role === 'seller',
  });
};

export const useSellerSallaMetrics = () => {
  const { user } = useAuthStore();
  return useQuery({
    queryKey: ['seller', 'salla', 'metrics', user?.id],
    queryFn: sellerSallaApi.metrics,
    enabled: !!user?.id && user?.role === 'seller',
    refetchInterval: 5000,
  });
};

export const useSellerSallaRecentActivity = () => {
  const { user } = useAuthStore();
  return useQuery({
    queryKey: ['seller', 'salla', 'recentActivity', user?.id],
    queryFn: sellerSallaApi.recentActivity,
    enabled: !!user?.id && user?.role === 'seller',
    refetchInterval: 5000,
  });
};

export const useSimulateSellerSallaCreateOrder = () => {
  const queryClient = useQueryClient();
  const { user } = useAuthStore();
  return useMutation({
    mutationFn: sellerSallaApi.simulateCreateOrder,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['seller', 'salla', 'metrics', user?.id] });
      queryClient.invalidateQueries({ queryKey: ['seller', 'salla', 'recentActivity', user?.id] });
    },
  });
};

// Seller Products + SMM Rules
export const useSellerProducts = () => {
  const { user } = useAuthStore();
  return useQuery({
    queryKey: ['seller', 'products', user?.id],
    queryFn: sellerProductsApi.listProducts,
    enabled: !!user?.id && user?.role === 'seller',
  });
};

export const useCreateSellerProduct = () => {
  const queryClient = useQueryClient();
  const { user } = useAuthStore();
  return useMutation({
    mutationFn: sellerProductsApi.createProduct,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['seller', 'products', user?.id] }),
  });
};

export const useUpdateSellerProduct = () => {
  const queryClient = useQueryClient();
  const { user } = useAuthStore();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: Parameters<typeof sellerProductsApi.updateProduct>[1] }) =>
      sellerProductsApi.updateProduct(id, input),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['seller', 'products', user?.id] }),
  });
};

export const useDeleteSellerProduct = () => {
  const queryClient = useQueryClient();
  const { user } = useAuthStore();
  return useMutation({
    mutationFn: sellerProductsApi.deleteProduct,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['seller', 'products', user?.id] }),
  });
};

export const useSellerProductRules = (productId: string | null) => {
  const { user } = useAuthStore();
  return useQuery({
    queryKey: ['seller', 'productRules', user?.id, productId],
    queryFn: () => sellerProductsApi.listRules(productId!),
    enabled: !!user?.id && user?.role === 'seller' && !!productId,
  });
};

// Admin
export const useAdminSummary = () => {
  const { user } = useAuthStore();
  return useQuery({
    queryKey: ['admin', 'summary'],
    queryFn: () => adminSummaryApi.get(),
    enabled: user?.role === 'admin',
  });
};

export const useAdminUsers = (params?: { role?: string; q?: string }) => {
  const { user } = useAuthStore();
  return useQuery({
    queryKey: ['admin', 'users', params],
    queryFn: () => adminUsersApi.list(params),
    enabled: user?.role === 'admin',
  });
};

export const useUpdateAdminUser = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: Parameters<typeof adminUsersApi.update>[1] }) =>
      adminUsersApi.update(id, input),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['admin', 'users'] }),
  });
};

export const useResetAdminUserPassword = () => {
  return useMutation({
    mutationFn: ({ id, password }: { id: string; password: string }) =>
      adminUsersApi.resetPassword(id, password),
  });
};

export const useDeleteAdminUser = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => adminUsersApi.remove(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['admin', 'users'] }),
  });
};

export const useAdminProviders = () => {
  const { user } = useAuthStore();
  return useQuery({
    queryKey: ['admin', 'providers'],
    queryFn: adminProvidersApi.list,
    enabled: user?.role === 'admin',
  });
};

export const useUpdateAdminProvider = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: Parameters<typeof adminProvidersApi.update>[1] }) =>
      adminProvidersApi.update(id, input),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['admin', 'providers'] }),
  });
};

export const useDeleteAdminProvider = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => adminProvidersApi.remove(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['admin', 'providers'] }),
  });
};

export const useAdminProducts = () => {
  const { user } = useAuthStore();
  return useQuery({
    queryKey: ['admin', 'products'],
    queryFn: adminProductsApi.list,
    enabled: user?.role === 'admin',
  });
};

export const useUpdateAdminProduct = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: Parameters<typeof adminProductsApi.update>[1] }) =>
      adminProductsApi.update(id, input),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['admin', 'products'] }),
  });
};

export const useDeleteAdminProduct = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => adminProductsApi.remove(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['admin', 'products'] }),
  });
};

export const useAdminProductRules = (productId: string | null) => {
  const { user } = useAuthStore();
  return useQuery({
    queryKey: ['admin', 'productRules', productId],
    queryFn: () => adminProductsApi.listRules(productId!),
    enabled: user?.role === 'admin' && !!productId,
  });
};

export const useUpdateAdminRule = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: Parameters<typeof adminProductsApi.updateRule>[1] }) =>
      adminProductsApi.updateRule(id, input),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['admin', 'productRules'] }),
  });
};

export const useDeleteAdminRule = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => adminProductsApi.removeRule(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['admin', 'productRules'] }),
  });
};

export const useAdminSallaConnections = () => {
  const { user } = useAuthStore();
  return useQuery({
    queryKey: ['admin', 'sallaConnections'],
    queryFn: adminSallaApi.list,
    enabled: user?.role === 'admin',
  });
};

export const useUpdateAdminSalla = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ sellerId, input }: { sellerId: string; input: Parameters<typeof adminSallaApi.update>[1] }) =>
      adminSallaApi.update(sellerId, input),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['admin', 'sallaConnections'] }),
  });
};

export const useRotateAdminSallaToken = () => {
  return useMutation({
    mutationFn: (sellerId: string) => adminSallaApi.rotateToken(sellerId),
  });
};

export const useAdminAuditLogs = (limit = 100) => {
  const { user } = useAuthStore();
  return useQuery({
    queryKey: ['admin', 'auditLogs', limit],
    queryFn: () => adminAuditLogsApi.list(limit),
    enabled: user?.role === 'admin',
  });
};

export const useAdminSettings = () => {
  const { user } = useAuthStore();
  return useQuery({
    queryKey: ['admin', 'settings'],
    queryFn: adminSettingsApi.list,
    enabled: user?.role === 'admin',
  });
};

export const useUpdateAdminSetting = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ key, value }: { key: string; value: string }) => adminSettingsApi.update(key, value),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['admin', 'settings'] }),
  });
};

export const useAdminNotificationSummary = () => {
  const { user } = useAuthStore();
  return useQuery({
    queryKey: ['admin', 'settings', 'notificationsSummary'],
    queryFn: adminSettingsApi.getNotificationSummary,
    enabled: user?.role === 'admin',
  });
};

export const useAdminCategories = () => {
  const { user } = useAuthStore();
  return useQuery({
    queryKey: ['admin', 'categories'],
    queryFn: adminCategoriesApi.list,
    enabled: user?.role === 'admin',
  });
};

export const useCreateAdminCategory = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: adminCategoriesApi.create,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['admin', 'categories'] }),
  });
};

export const useUpdateAdminCategory = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: Parameters<typeof adminCategoriesApi.update>[1] }) =>
      adminCategoriesApi.update(id, input),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['admin', 'categories'] }),
  });
};

export const useDeleteAdminCategory = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => adminCategoriesApi.remove(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['admin', 'categories'] }),
  });
};

export const useCreateSellerProductRule = () => {
  const queryClient = useQueryClient();
  const { user } = useAuthStore();
  return useMutation({
    mutationFn: ({ productId, input }: { productId: string; input: Parameters<typeof sellerProductsApi.createRule>[1] }) =>
      sellerProductsApi.createRule(productId, input),
    onSuccess: (_data, vars) => {
      queryClient.invalidateQueries({ queryKey: ['seller', 'productRules', user?.id, vars.productId] });
    },
  });
};

export const useUpdateSellerProductRule = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ ruleId, input }: { ruleId: string; input: Parameters<typeof sellerProductsApi.updateRule>[1] }) =>
      sellerProductsApi.updateRule(ruleId, input),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['seller', 'productRules'] }),
  });
};

export const useDeleteSellerProductRule = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: sellerProductsApi.deleteRule,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['seller', 'productRules'] }),
  });
};

export const useBulkUpdateSellerRuleService = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: sellerProductsApi.bulkUpdateRuleService,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['seller', 'productRules'] }),
  });
};

export const useBulkUpdateSellerRuleServiceByName = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: sellerProductsApi.bulkUpdateRuleServiceByName,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['seller', 'productRules'] }),
  });
};
