import { Ticket, TicketReply, TicketStatus, TicketPriority, PaginatedResponse } from '@/types';

const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

// Mock tickets
let mockTickets: Ticket[] = [
  {
    id: 'TKT-001',
    userId: 'user-1',
    orderId: 'ORD-000001',
    subject: 'Order not started',
    message: 'My order has been pending for 2 hours. Please check.',
    status: 'open',
    priority: 'medium',
    replies: [
      {
        id: 'reply-1',
        ticketId: 'TKT-001',
        userId: 'admin-1',
        message: 'We are looking into this. Your order should start soon.',
        isAdmin: true,
        createdAt: new Date(Date.now() - 30 * 60 * 1000).toISOString(),
      },
    ],
    createdAt: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
    updatedAt: new Date(Date.now() - 30 * 60 * 1000).toISOString(),
  },
];

export const ticketsApi = {
  // Get user tickets
  getUserTickets: async (
    userId: string,
    page = 1,
    limit = 10
  ): Promise<PaginatedResponse<Ticket>> => {
    await delay(300);

    const filtered = mockTickets.filter(t => t.userId === userId);
    const total = filtered.length;
    const totalPages = Math.ceil(total / limit);
    const start = (page - 1) * limit;
    const data = filtered.slice(start, start + limit);

    return { data, total, page, limit, totalPages };
  },

  // Get ticket by ID
  getTicketById: async (ticketId: string): Promise<Ticket | null> => {
    await delay(200);
    return mockTickets.find(t => t.id === ticketId) || null;
  },

  // Create ticket
  createTicket: async (data: {
    subject: string;
    message: string;
    priority: TicketPriority;
    orderId?: string;
  }): Promise<Ticket> => {
    await delay(500);

    const newTicket: Ticket = {
      id: `TKT-${String(mockTickets.length + 1).padStart(3, '0')}`,
      userId: 'user-1', // Would come from auth
      orderId: data.orderId,
      subject: data.subject,
      message: data.message,
      status: 'open',
      priority: data.priority,
      replies: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    mockTickets = [newTicket, ...mockTickets];
    return newTicket;
  },

  // Add reply
  addReply: async (ticketId: string, message: string, isAdmin = false): Promise<TicketReply> => {
    await delay(400);

    const ticketIndex = mockTickets.findIndex(t => t.id === ticketId);
    if (ticketIndex === -1) throw new Error('Ticket not found');

    const reply: TicketReply = {
      id: `reply-${Date.now()}`,
      ticketId,
      userId: isAdmin ? 'admin-1' : 'user-1',
      message,
      isAdmin,
      createdAt: new Date().toISOString(),
    };

    mockTickets[ticketIndex].replies.push(reply);
    mockTickets[ticketIndex].updatedAt = new Date().toISOString();

    return reply;
  },

  // Update ticket status
  updateTicketStatus: async (ticketId: string, status: TicketStatus): Promise<Ticket> => {
    await delay(300);

    const ticketIndex = mockTickets.findIndex(t => t.id === ticketId);
    if (ticketIndex === -1) throw new Error('Ticket not found');

    mockTickets[ticketIndex].status = status;
    mockTickets[ticketIndex].updatedAt = new Date().toISOString();

    if (status === 'resolved') {
      mockTickets[ticketIndex].resolvedAt = new Date().toISOString();
    }

    return mockTickets[ticketIndex];
  },
};
