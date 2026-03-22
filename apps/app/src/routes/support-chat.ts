/**
 * Support Chat Routes (Ticket System)
 * Each support request is a ticket with ID, subject, and open/closed status.
 * User-facing: create tickets, list own tickets.
 * Admin-facing: list all tickets, reply, close tickets.
 */

import { Router, Response } from 'express';
import rateLimit from 'express-rate-limit';
import { requireSuperAdmin } from '../middleware/auth';
import { asyncHandler } from '../middleware/errorHandler';
import { broadcast } from '../services/websocket';
import { logger } from '../services/logger';
import type { AuthenticatedRequest, ApiResponse, ChatConversation, ChatMessage } from '../types';

const MAX_OPEN_TICKETS_PER_ORG = 5;

// Rate limit: max 3 new tickets per 10 minutes per user
const ticketCreateLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 3,
  keyGenerator: (req: AuthenticatedRequest) => `ticket-create-${req.user?.userId || req.ip}`,
  message: { success: false, error: { code: 'TOO_MANY_TICKETS', message: 'Du kan maks opprette 3 saker per 10 minutter' } },
});


const userRouter: Router = Router();
const adminRouter: Router = Router();

interface SupportChatDbService {
  createSupportTicket(organizationId: number, subject: string): Promise<{ id: number }>;
  getOrgSupportTickets(organizationId: number): Promise<ChatConversation[]>;
  closeSupportTicket(conversationId: number): Promise<void>;
  reopenSupportTicket(conversationId: number): Promise<void>;
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
  getKlientById(id: number): Promise<{ id: number; navn: string; epost: string } | null>;
  deleteSupportTicket(conversationId: number): Promise<boolean>;
}

/**
 * Send email notification to ticket creator when superadmin replies.
 * Runs async — does not block the response.
 */
async function notifyTicketCreatorByEmail(conversationId: number, replyContent: string): Promise<void> {
  try {
    // Get first message to find the ticket creator
    const messages = await dbService.getSupportChatMessages(conversationId, 1);
    if (!messages || messages.length === 0) return;

    const creatorId = messages[0].sender_id;
    const creator = await dbService.getKlientById(creatorId);
    if (!creator?.epost) return;

    const { createEmailSender, baseTemplate } = await import('@skyplanner/email');
    const escapeHtml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    const emailSender = createEmailSender({
      resendApiKey: process.env.RESEND_API_KEY || '',
      fromEmail: process.env.EMAIL_FROM || 'noreply@skyplanner.no',
      fromName: 'Sky Planner Support',
    });

    const previewText = replyContent.substring(0, 100);
    const html = baseTemplate(`
      <h2 style="color: #e2e8f0; margin: 0 0 16px;">Nytt svar på din support-sak</h2>
      <p style="color: #94a3b8; margin: 0 0 20px;">Hei ${escapeHtml(creator.navn || 'bruker')},</p>
      <p style="color: #94a3b8; margin: 0 0 20px;">Du har fått svar på support-sak <strong>#${conversationId}</strong>:</p>
      <div style="background: rgba(99,102,241,0.1); border-left: 3px solid #6366f1; padding: 16px; border-radius: 8px; margin: 0 0 20px;">
        <p style="color: #e2e8f0; margin: 0; white-space: pre-wrap;">${escapeHtml(replyContent)}</p>
      </div>
      <p style="color: #94a3b8; margin: 0 0 8px;">Logg inn i Sky Planner for å svare.</p>
      <p style="color: #64748b; font-size: 13px; margin: 20px 0 0;">— Efffekt Support</p>
    `, { previewText });

    await emailSender.send({
      to: creator.epost,
      subject: `Svar på support-sak #${conversationId}`,
      html,
    });

    logger.info({ conversationId, creatorEmail: creator.epost }, 'Support reply email sent');
  } catch (e) {
    logger.error({ error: e, conversationId }, 'Failed to send support reply email');
  }
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
  ticketCreateLimiter,
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const { subject } = req.body;
    if (!subject || typeof subject !== 'string' || subject.trim().length === 0) {
      res.status(400).json({ success: false, error: { code: 'MISSING_SUBJECT', message: 'Emne er påkrevd' } });
      return;
    }

    // Sanitize and limit subject
    const sanitizedSubject = subject.trim()
      .substring(0, 200)
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');

    // Check max open tickets per org
    const existingTickets = await dbService.getOrgSupportTickets(req.organizationId!);
    const openCount = existingTickets.filter(t => t.status === 'open').length;
    if (openCount >= MAX_OPEN_TICKETS_PER_ORG) {
      res.status(429).json({ success: false, error: { code: 'MAX_TICKETS', message: `Maks ${MAX_OPEN_TICKETS_PER_ORG} åpne saker om gangen. Lukk en eksisterende sak først.` } });
      return;
    }

    const ticket = await dbService.createSupportTicket(req.organizationId!, sanitizedSubject);
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

/**
 * PUT /api/support-chat/tickets/:id/reopen
 * Reopen a closed ticket (user-facing)
 */
userRouter.put(
  '/tickets/:id/reopen',
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const conversationId = parseInt(req.params.id, 10);
    if (!conversationId || conversationId <= 0) {
      res.status(400).json({ success: false, error: { code: 'INVALID_ID', message: 'Ugyldig ID' } });
      return;
    }

    // Verify ticket belongs to user's org
    const tickets = await dbService.getOrgSupportTickets(req.organizationId!);
    const ticket = tickets.find(t => t.id === conversationId);
    if (!ticket) {
      res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Saken ble ikke funnet' } });
      return;
    }

    // Check max open tickets
    const openCount = tickets.filter(t => t.status === 'open').length;
    if (openCount >= MAX_OPEN_TICKETS_PER_ORG) {
      res.status(429).json({ success: false, error: { code: 'MAX_TICKETS', message: `Maks ${MAX_OPEN_TICKETS_PER_ORG} åpne saker om gangen.` } });
      return;
    }

    await dbService.reopenSupportTicket(conversationId);
    res.json({ success: true });
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

    // Send email notification to ticket creator (async, non-blocking)
    notifyTicketCreatorByEmail(conversationId, sanitizedContent).catch(() => {});

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
 * PUT /api/super-admin/support-chat/conversations/:id/reopen
 * Reopen a closed support ticket
 */
adminRouter.put(
  '/conversations/:id/reopen',
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const conversationId = parseInt(req.params.id, 10);
    if (!conversationId || conversationId <= 0) {
      res.status(400).json({ success: false, error: { code: 'INVALID_ID', message: 'Ugyldig ID' } });
      return;
    }
    await dbService.reopenSupportTicket(conversationId);

    const orgId = await dbService.getSupportConversationOrgId(conversationId);
    if (orgId) {
      broadcast(orgId, 'support_ticket_reopened', { conversationId });
    }

    res.json({ success: true });
  })
);

/**
 * DELETE /api/super-admin/support-chat/conversations/:id
 * Delete an entire support ticket and all its messages
 */
adminRouter.delete(
  '/conversations/:id',
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const conversationId = parseInt(req.params.id, 10);
    if (!conversationId || conversationId <= 0) {
      res.status(400).json({ success: false, error: { code: 'INVALID_ID', message: 'Ugyldig ID' } });
      return;
    }
    const deleted = await dbService.deleteSupportTicket(conversationId);
    if (!deleted) {
      res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Saken ble ikke funnet' } });
      return;
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
