/**
 * Chat Routes
 * Internal messaging system for technicians within an organization.
 * Supports org-wide channel and 1-to-1 DMs with real-time delivery.
 */

import { Router, Response } from 'express';
import { requireTenantAuth } from '../middleware/auth';
import { asyncHandler } from '../middleware/errorHandler';
import { broadcast, sendToUser } from '../services/websocket';
import type { AuthenticatedRequest, ApiResponse, ChatConversation, ChatMessage } from '../types';

const router: Router = Router();

// Database service interface
interface ChatDbService {
  getOrCreateOrgConversation(organizationId: number): Promise<{ id: number }>;
  getOrCreateDmConversation(organizationId: number, userIds: [number, number]): Promise<{ id: number }>;
  getChatConversationsForUser(organizationId: number, userId: number): Promise<ChatConversation[]>;
  getChatMessages(conversationId: number, organizationId: number, limit: number, before?: number): Promise<ChatMessage[]>;
  createChatMessage(conversationId: number, organizationId: number, senderId: number, senderName: string, content: string): Promise<ChatMessage>;
  markChatAsRead(userId: number, conversationId: number, messageId: number): Promise<void>;
  getChatUnreadCounts(userId: number, organizationId: number): Promise<{ conversationId: number; count: number }[]>;
  getChatTotalUnread(userId: number, organizationId: number): Promise<number>;
  getChatConversationById(conversationId: number, organizationId: number): Promise<ChatConversation | null>;
  getChatConversationParticipants(conversationId: number): Promise<number[]>;
  getKlientById(id: number): Promise<{ id: number; navn: string; epost: string } | null>;
  getTeamMembers(organizationId: number): Promise<Array<{ id: number; navn: string; epost: string; rolle?: string; aktiv: boolean }>>;
}

let dbService: ChatDbService;

export function initChatRoutes(databaseService: ChatDbService): Router {
  dbService = databaseService;
  return router;
}

/**
 * Helper to get user's display name
 */
async function getSenderName(userId: number, fallbackEmail: string): Promise<string> {
  const user = await dbService.getKlientById(userId);
  return user?.navn || fallbackEmail.split('@')[0] || `Bruker ${userId}`;
}

/**
 * GET /api/chat/conversations
 * List all conversations for the current user (org channel + DMs)
 */
router.get(
  '/conversations',
  requireTenantAuth,
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const conversations = await dbService.getChatConversationsForUser(
      req.organizationId!,
      req.user!.userId
    );

    const response: ApiResponse<ChatConversation[]> = {
      success: true,
      data: conversations,
    };
    res.json(response);
  })
);

/**
 * GET /api/chat/conversations/:id/messages
 * Get messages for a conversation (paginated, newest first)
 * Query: ?limit=50&before=<messageId>
 */
router.get(
  '/conversations/:id/messages',
  requireTenantAuth,
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const conversationId = parseInt(req.params.id, 10);
    if (!conversationId || conversationId <= 0) {
      res.status(400).json({ success: false, error: { code: 'INVALID_ID', message: 'Ugyldig samtale-ID' } });
      return;
    }

    const limit = Math.min(parseInt(req.query.limit as string, 10) || 50, 100);
    const before = parseInt(req.query.before as string, 10) || undefined;

    const messages = await dbService.getChatMessages(
      conversationId,
      req.organizationId!,
      limit,
      before
    );

    const response: ApiResponse<ChatMessage[]> = {
      success: true,
      data: messages,
    };
    res.json(response);
  })
);

/**
 * POST /api/chat/conversations/:id/messages
 * Send a message to a conversation
 * Body: { content: string }
 */
router.post(
  '/conversations/:id/messages',
  requireTenantAuth,
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

    // Limit message length
    if (content.length > 2000) {
      res.status(400).json({ success: false, error: { code: 'MESSAGE_TOO_LONG', message: 'Meldingen kan ikke være lenger enn 2000 tegn' } });
      return;
    }

    const senderName = await getSenderName(req.user!.userId, req.user!.epost);

    const message = await dbService.createChatMessage(
      conversationId,
      req.organizationId!,
      req.user!.userId,
      senderName,
      content.trim()
    );

    // Determine conversation type and broadcast accordingly
    const conversation = await dbService.getChatConversationById(conversationId, req.organizationId!);

    if (conversation?.type === 'org') {
      // Org channel: broadcast to all in org except sender
      broadcast(req.organizationId!, 'chat_message', {
        ...message,
        conversationType: 'org',
      }, req.user!.userId);
    } else if (conversation?.type === 'dm') {
      // DM: send only to the other participant
      const participants = await dbService.getChatConversationParticipants(conversationId);
      for (const participantId of participants) {
        if (participantId !== req.user!.userId) {
          sendToUser(req.organizationId!, participantId, 'chat_message', {
            ...message,
            conversationType: 'dm',
          });
        }
      }
    }

    // Auto-mark as read for sender
    await dbService.markChatAsRead(req.user!.userId, conversationId, message.id);

    const response: ApiResponse<ChatMessage> = {
      success: true,
      data: message,
    };
    res.status(201).json(response);
  })
);

/**
 * POST /api/chat/conversations/dm
 * Create or find a DM conversation with another user
 * Body: { targetUserId: number }
 */
router.post(
  '/conversations/dm',
  requireTenantAuth,
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const { targetUserId } = req.body;
    if (!targetUserId || typeof targetUserId !== 'number' || targetUserId <= 0) {
      res.status(400).json({ success: false, error: { code: 'INVALID_USER', message: 'Ugyldig bruker-ID' } });
      return;
    }

    if (targetUserId === req.user!.userId) {
      res.status(400).json({ success: false, error: { code: 'SELF_DM', message: 'Du kan ikke sende melding til deg selv' } });
      return;
    }

    const conversation = await dbService.getOrCreateDmConversation(
      req.organizationId!,
      [req.user!.userId, targetUserId]
    );

    const response: ApiResponse<{ id: number }> = {
      success: true,
      data: conversation,
    };
    res.json(response);
  })
);

/**
 * PUT /api/chat/conversations/:id/read
 * Mark a conversation as read up to a given message
 * Body: { messageId: number }
 */
router.put(
  '/conversations/:id/read',
  requireTenantAuth,
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const conversationId = parseInt(req.params.id, 10);
    if (!conversationId || conversationId <= 0) {
      res.status(400).json({ success: false, error: { code: 'INVALID_ID', message: 'Ugyldig samtale-ID' } });
      return;
    }

    const { messageId } = req.body;
    if (!messageId || typeof messageId !== 'number' || messageId <= 0) {
      res.status(400).json({ success: false, error: { code: 'INVALID_MESSAGE', message: 'Ugyldig meldings-ID' } });
      return;
    }

    await dbService.markChatAsRead(req.user!.userId, conversationId, messageId);

    res.json({ success: true });
  })
);

/**
 * GET /api/chat/unread
 * Get total unread message count across all conversations
 */
router.get(
  '/unread',
  requireTenantAuth,
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const total = await dbService.getChatTotalUnread(req.user!.userId, req.organizationId!);
    const counts = await dbService.getChatUnreadCounts(req.user!.userId, req.organizationId!);

    const response: ApiResponse<{ total: number; perConversation: { conversationId: number; count: number }[] }> = {
      success: true,
      data: { total, perConversation: counts },
    };
    res.json(response);
  })
);

/**
 * GET /api/chat/team-members
 * Get list of team members for starting new DMs
 */
router.get(
  '/team-members',
  requireTenantAuth,
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const members = await dbService.getTeamMembers(req.organizationId!);
    // Filter out current user and inactive members, return only safe fields
    const filtered = members
      .filter(m => m.id !== req.user!.userId && m.aktiv)
      .map(m => ({ id: m.id, navn: m.navn }));

    const response: ApiResponse<{ id: number; navn: string }[]> = {
      success: true,
      data: filtered,
    };
    res.json(response);
  })
);

/**
 * POST /api/chat/init
 * Ensure org channel exists and return it (called on app load)
 */
router.post(
  '/init',
  requireTenantAuth,
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const orgConv = await dbService.getOrCreateOrgConversation(req.organizationId!);
    const total = await dbService.getChatTotalUnread(req.user!.userId, req.organizationId!);

    const response: ApiResponse<{ orgConversationId: number; totalUnread: number }> = {
      success: true,
      data: { orgConversationId: orgConv.id, totalUnread: total },
    };
    res.json(response);
  })
);

export default router;
