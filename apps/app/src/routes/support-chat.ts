/**
 * Support Chat Routes (Ticket System)
 * Each support request is a ticket with ID, subject, and open/closed status.
 * User-facing: create tickets, list own tickets.
 * Admin-facing: list all tickets, reply, close tickets.
 */

import { Router, Response } from 'express';
import { requireSuperAdmin } from '../middleware/auth';
import { asyncHandler } from '../middleware/errorHandler';
import { broadcast } from '../services/websocket';
import type { AuthenticatedRequest, ApiResponse, ChatConversation, ChatMessage } from '../types';

const userRouter: Router = Router();
const adminRouter: Router = Router();

interface SupportChatDbService {
  createSupportTicket(organizationId: number, subject: string): Promise<{ id: number }>;
  getOrgSupportTickets(organizationId: number): Promise<ChatConversation[]>;
  closeSupportTicket(conversationId: number): Promise<void>;
  getAllSupportConversations(adminUserId: number): Promise<Array<{
    id: number; organization_id: number; organization_name: string;
    subject?: string; status?: string;
    last_message?: ChatMessage; unread_count: number; created_at: string;
  }>>;
  getSupportChatMessages(conversationId: number, limit?: number, before?: number): Promise<ChatMessage[]>;
  createSupportChatMessage(conversationId: number, senderId: number, senderName: string, content: string): Promise<ChatMessage>;
  getSupportConversationOrgId(conversationId: number): Promise<number | null>;
  getSupportTotalUnread(adminUserId: number): Promise<number>;
  markChatAsRead(userId: number, conversationId: number, messageId: number): Promise<void>;
}

let dbService: SupportChatDbService;

export function initSupportChatRoutes(databaseService: SupportChatDbService): { userRouter: Router; adminRouter: Router } {
  dbService = databaseService;
  return { userRouter, adminRouter };
}

// ========================================
// USER-FACING ROUTES
// ========================================

/**
 * POST /api/support-chat/tickets
 * Create a new support ticket
 * Body: { subject: string }
 */
userRouter.post(
  '/tickets',
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const { subject } = req.body;
    if (!subject || typeof subject !== 'string' || subject.trim().length === 0) {
      res.status(400).json({ success: false, error: { code: 'MISSING_SUBJECT', message: 'Emne er påkrevd' } });
      return;
    }

    const ticket = await dbService.createSupportTicket(req.organizationId!, subject.trim());
    const response: ApiResponse<{ ticketId: number }> = {
      success: true,
      data: { ticketId: ticket.id },
    };
    res.json(response);
  })
);

/**
 * GET /api/support-chat/tickets
 * List support tickets for the user's org
 */
userRouter.get(
  '/tickets',
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const tickets = await dbService.getOrgSupportTickets(req.organizationId!);
    const response: ApiResponse<ChatConversation[]> = {
      success: true,
      data: tickets,
    };
    res.json(response);
  })
);

// ========================================
// ADMIN-FACING ROUTES
// ========================================

adminRouter.use(requireSuperAdmin);

/**
 * GET /api/super-admin/support-chat/conversations
 * List all support tickets across orgs
 */
adminRouter.get(
  '/conversations',
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const conversations = await dbService.getAllSupportConversations(req.user!.userId);
    res.json({ success: true, data: conversations });
  })
);

/**
 * GET /api/super-admin/support-chat/conversations/:id/messages
 */
adminRouter.get(
  '/conversations/:id/messages',
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const conversationId = parseInt(req.params.id, 10);
    if (!conversationId || conversationId <= 0) {
      res.status(400).json({ success: false, error: { code: 'INVALID_ID', message: 'Ugyldig samtale-ID' } });
      return;
    }
    const limit = Math.min(parseInt(req.query.limit as string, 10) || 50, 100);
    const before = parseInt(req.query.before as string, 10) || undefined;
    const messages = await dbService.getSupportChatMessages(conversationId, limit, before);
    res.json({ success: true, data: messages });
  })
);

/**
 * POST /api/super-admin/support-chat/conversations/:id/messages
 * Send message as superadmin
 */
adminRouter.post(
  '/conversations/:id/messages',
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const conversationId = parseInt(req.params.id, 10);
    if (!conversationId || conversationId <= 0) {
      res.status(400).json({ success: false, error: { code: 'INVALID_ID', message: 'Ugyldig samtale-ID' } });
      return;
    }

    const { content } = req.body;
    if (!content || typeof content !== 'string' || content.trim().length === 0) {
      res.status(400).json({ success: false, error: { code: 'EMPTY_MESSAGE', message: 'Meldingen kan ikke være tom' } });
      return;
    }
    if (content.length > 2000) {
      res.status(400).json({ success: false, error: { code: 'MESSAGE_TOO_LONG', message: 'Maks 2000 tegn' } });
      return;
    }

    const sanitizedContent = content.trim().replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const message = await dbService.createSupportChatMessage(conversationId, req.user!.userId, 'Efffekt Support', sanitizedContent);

    const orgId = await dbService.getSupportConversationOrgId(conversationId);
    if (orgId) {
      broadcast(orgId, 'chat_message', { ...message, conversationType: 'support' });
    }

    await dbService.markChatAsRead(req.user!.userId, conversationId, message.id);
    res.json({ success: true, data: message });
  })
);

/**
 * PUT /api/super-admin/support-chat/conversations/:id/read
 */
adminRouter.put(
  '/conversations/:id/read',
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const conversationId = parseInt(req.params.id, 10);
    if (!conversationId || conversationId <= 0) {
      res.status(400).json({ success: false, error: { code: 'INVALID_ID', message: 'Ugyldig ID' } });
      return;
    }
    const { messageId } = req.body;
    if (!messageId || typeof messageId !== 'number') {
      res.status(400).json({ success: false, error: { code: 'INVALID_MESSAGE_ID', message: 'Ugyldig meldings-ID' } });
      return;
    }
    await dbService.markChatAsRead(req.user!.userId, conversationId, messageId);
    res.json({ success: true });
  })
);

/**
 * PUT /api/super-admin/support-chat/conversations/:id/close
 * Close a support ticket
 */
adminRouter.put(
  '/conversations/:id/close',
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const conversationId = parseInt(req.params.id, 10);
    if (!conversationId || conversationId <= 0) {
      res.status(400).json({ success: false, error: { code: 'INVALID_ID', message: 'Ugyldig ID' } });
      return;
    }
    await dbService.closeSupportTicket(conversationId);

    // Notify org users that ticket is closed
    const orgId = await dbService.getSupportConversationOrgId(conversationId);
    if (orgId) {
      broadcast(orgId, 'support_ticket_closed', { conversationId });
    }

    res.json({ success: true });
  })
);

/**
 * GET /api/super-admin/support-chat/unread
 */
adminRouter.get(
  '/unread',
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const total = await dbService.getSupportTotalUnread(req.user!.userId);
    res.json({ success: true, data: { total } });
  })
);

export { userRouter as supportChatUserRouter, adminRouter as supportChatAdminRouter };
