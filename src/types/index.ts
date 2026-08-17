// Core Types for F5R SMM Marketplace

export type Platform = 'tiktok' | 'instagram' | 'youtube' | 'snapchat' | 'twitter' | 'facebook';

export type ServiceType = 'followers' | 'likes' | 'views' | 'comments' | 'shares' | 'saves';

export type OrderStatus = 
  | 'pending' 
  | 'approved' 
  | 'submitted' 
  | 'in_progress' 
  | 'completed' 
  | 'partial' 
  | 'failed' 
  | 'refunded' 
  | 'cancelled';

export type TicketStatus = 'open' | 'pending' | 'resolved' | 'closed';

export type TicketPriority = 'low' | 'medium' | 'high' | 'urgent';

export type UserRole = 'user' | 'admin' | 'seller';

export interface Category {
  id: string;
  name: string;
  nameAr: string;
  slug: string;
  platform: Platform;
  icon: string;
  description?: string;
  descriptionAr?: string;
  servicesCount: number;
  order: number;
  enabled: boolean;
}

export interface RequiredField {
  name: string;
  label: string;
  labelAr: string;
  type: 'text' | 'url' | 'textarea' | 'number' | 'select';
  placeholder?: string;
  placeholderAr?: string;
  required: boolean;
  validation?: string;
  options?: { value: string; label: string; labelAr: string }[];
}

export interface Service {
  id: string;
  name: string;
  nameAr: string;
  description: string;
  descriptionAr: string;
  platform: Platform;
  type: ServiceType;
  categoryId: string;
  pricePerThousand: number;
  minOrder: number;
  maxOrder: number;
  avgTimeMinutes: number;
  refillSupported: boolean;
  refillDays?: number;
  rating: number;
  totalOrders: number;
  requiredFields: RequiredField[];
  startTimeMinutes: number;
  cancelAllowed: boolean;
  enabled: boolean;
  featured: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface User {
  id: string;
  email: string;
  name: string;
  role: UserRole;
  phone?: string;
  avatar?: string;
  createdAt: string;
  lastLoginAt: string;
  emailVerified: boolean;
  subscription?: { plan: string; status: string; renewAt: string | null };
}

export interface Order {
  id: string;
  userId: string;
  serviceId: string;
  service?: Service;
  quantity: number;
  totalPrice: number;
  status: OrderStatus;
  link: string;
  customFields?: Record<string, string>;
  startCount?: number;
  currentCount?: number;
  remains?: number;
  providerOrderId?: string;
  createdAt: string;
  updatedAt: string;
  approvedAt?: string;
  submittedAt?: string;
  completedAt?: string;
  timeline: OrderTimelineEvent[];
}

export interface OrderTimelineEvent {
  id: string;
  status: OrderStatus;
  message: string;
  messageAr: string;
  timestamp: string;
  actor?: string;
}

export interface Ticket {
  id: string;
  userId: string;
  orderId?: string;
  subject: string;
  message: string;
  status: TicketStatus;
  priority: TicketPriority;
  replies: TicketReply[];
  createdAt: string;
  updatedAt: string;
  resolvedAt?: string;
}

export interface TicketReply {
  id: string;
  ticketId: string;
  userId: string;
  message: string;
  isAdmin: boolean;
  createdAt: string;
}

export interface Payment {
  id: string;
  userId: string;
  orderId: string;
  amount: number;
  currency: string;
  method: 'apple_pay' | 'mada' | 'visa' | 'mastercard' | 'wallet';
  status: 'pending' | 'completed' | 'failed' | 'refunded';
  transactionId?: string;
  createdAt: string;
}

export interface AuditLog {
  id: string;
  userId: string;
  userName?: string;
  action: string;
  entityType: 'order' | 'service' | 'user' | 'ticket' | 'category';
  entityId: string;
  details: string;
  oldValue?: string;
  newValue?: string;
  createdAt: string;
}

export interface DashboardStats {
  totalOrders: number;
  activeOrders: number;
  completedOrders: number;
  totalRevenue: number;
  pendingOrders: number;
  activeUsers: number;
}

export interface Testimonial {
  id: string;
  name: string;
  nameAr: string;
  avatar: string;
  rating: number;
  text: string;
  textAr: string;
  platform: Platform;
}

export type SmmProviderTestStatus = 'SUCCESS' | 'FAIL' | null;

export interface SmmProviderConnection {
  id: string;
  name: string;
  base_url: string;
  api_key_last4?: string;
  cost_currency?: string | null;
  fx_rate_to_store?: number | null;
  low_balance_threshold?: number | null;
  is_active: boolean;
  is_default: boolean;
  last_tested_at: string | null;
  last_test_status: SmmProviderTestStatus;
  last_test_message?: string | null;
  created_at: string;
  updated_at: string;
}

// API Response types
export interface ApiResponse<T> {
  data: T;
  success: boolean;
  message?: string;
}

export interface PaginatedResponse<T> {
  data: T[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export interface ServiceFilters {
  platform?: Platform;
  type?: ServiceType;
  categoryId?: string;
  minPrice?: number;
  maxPrice?: number;
  refill?: boolean;
  search?: string;
  sortBy?: 'popular' | 'price_asc' | 'price_desc' | 'fastest' | 'newest';
}

export interface OrderFilters {
  status?: OrderStatus;
  platform?: Platform;
  dateFrom?: string;
  dateTo?: string;
  amountFrom?: number;
  amountTo?: number;
  userId?: string;
}
