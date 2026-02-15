/**
 * WebSocket server for real-time updates
 * Provides tenant-isolated broadcasting of data changes
 */

import { WebSocketServer, WebSocket } from 'ws';
import type { Server, IncomingMessage } from 'http';
import { extractTokenFromCookies, AUTH_COOKIE_NAME } from '@skyplanner/auth';
import { verifyToken, getTokenId } from '../middleware/auth';
import { isTokenBlacklisted } from './token-blacklist';
import { logger } from './logger';

interface AuthenticatedSocket extends WebSocket {
  isAlive: boolean;
  userId: number;
  userName: string;
  organizationId: number;
  sessionId: string;
}

// Presence claim info
interface PresenceClaim {
  userId: number;
  userName: string;
  initials: string;
  claimedAt: number;
}

// Tenant-isolated connections: orgId → Set of authenticated sockets
const connections = new Map<number, Set<AuthenticatedSocket>>();

// In-memory presence: orgId → Map<kundeId, PresenceClaim>
const presenceClaims = new Map<number, Map<number, PresenceClaim>>();

// Rate limiting: track messages per socket
const messageCounters = new Map<WebSocket, { count: number; resetAt: number }>();
const MAX_MESSAGES_PER_SECOND = 10;

/**
 * Generate 2-letter initials from a name/email prefix
 */
function getInitials(name: string): string {
  const parts = name.split(/[.\-_\s]+/).filter(Boolean);
  if (parts.length >= 2) {
    return (parts[0][0] + parts[1][0]).toUpperCase();
  }
  return name.substring(0, 2).toUpperCase();
}

let wss: WebSocketServer | null = null;
let heartbeatInterval: ReturnType<typeof setInterval> | null = null;

/**
 * Authenticate WebSocket upgrade request via cookie
 */
async function authenticateUpgrade(req: IncomingMessage): Promise<{ userId: number; organizationId: number; userName: string } | null> {
  const cookieHeader = req.headers.cookie;
  if (!cookieHeader) return null;

  const token = extractTokenFromCookies(cookieHeader, AUTH_COOKIE_NAME);
  if (!token) return null;

  const decoded = verifyToken(token);
  if (!decoded || !decoded.organizationId) return null;

  // Check token blacklist
  const tokenId = getTokenId(decoded);
  const blacklisted = await isTokenBlacklisted(tokenId);
  if (blacklisted) return null;

  return {
    userId: decoded.userId,
    organizationId: decoded.organizationId,
    userName: decoded.epost?.split('@')[0] || `Bruker ${decoded.userId}`,
  };
}

/**
 * Check rate limit for incoming messages
 */
function isRateLimited(ws: WebSocket): boolean {
  const now = Date.now();
  let counter = messageCounters.get(ws);

  if (!counter || now > counter.resetAt) {
    counter = { count: 0, resetAt: now + 1000 };
    messageCounters.set(ws, counter);
  }

  counter.count++;
  return counter.count > MAX_MESSAGES_PER_SECOND;
}

/**
 * Initialize WebSocket server on existing HTTP server
 */
export function initWebSocketServer(server: Server): void {
  wss = new WebSocketServer({ noServer: true });

  // Handle HTTP upgrade requests
  server.on('upgrade', async (req, socket, head) => {
    try {
      const auth = await authenticateUpgrade(req);
      if (!auth) {
        socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
        socket.destroy();
        return;
      }

      wss!.handleUpgrade(req, socket, head, (ws) => {
        const authWs = ws as AuthenticatedSocket;
        authWs.isAlive = true;
        authWs.userId = auth.userId;
        authWs.userName = auth.userName;
        authWs.organizationId = auth.organizationId;
        authWs.sessionId = `${auth.userId}-${Date.now()}`;

        wss!.emit('connection', authWs, req);
      });
    } catch (error) {
      logger.error({ error }, 'WebSocket upgrade error');
      socket.write('HTTP/1.1 500 Internal Server Error\r\n\r\n');
      socket.destroy();
    }
  });

  // Handle new connections
  wss.on('connection', (ws: AuthenticatedSocket) => {
    // Add to org connections
    if (!connections.has(ws.organizationId)) {
      connections.set(ws.organizationId, new Set());
    }
    connections.get(ws.organizationId)!.add(ws);

    logger.info({
      userId: ws.userId,
      organizationId: ws.organizationId,
    }, 'WebSocket client connected');

    // Send welcome message with current presence state
    const orgPresence = presenceClaims.get(ws.organizationId);
    const presenceData: Record<string, PresenceClaim> = {};
    if (orgPresence) {
      for (const [kundeId, claim] of orgPresence) {
        presenceData[String(kundeId)] = claim;
      }
    }

    sendToSocket(ws, {
      type: 'connected',
      message: 'Sanntidsoppdateringer aktiv',
      data: {
        userId: ws.userId,
        userName: ws.userName,
        initials: getInitials(ws.userName),
        presence: presenceData,
      },
    });

    // Handle pong (heartbeat response)
    ws.on('pong', () => {
      ws.isAlive = true;
    });

    // Handle incoming messages
    ws.on('message', (raw) => {
      if (isRateLimited(ws)) return;

      try {
        const message = JSON.parse(raw.toString());
        handleClientMessage(ws, message);
      } catch {
        // Ignore malformed messages
      }
    });

    // Handle disconnect
    ws.on('close', () => {
      const orgConnections = connections.get(ws.organizationId);
      if (orgConnections) {
        orgConnections.delete(ws);
        if (orgConnections.size === 0) {
          connections.delete(ws.organizationId);
        }
      }
      messageCounters.delete(ws);

      // Auto-release all presence claims by this user
      releaseAllClaims(ws.organizationId, ws.userId);

      logger.info({
        userId: ws.userId,
        organizationId: ws.organizationId,
      }, 'WebSocket client disconnected');

      // Broadcast user offline to their org
      broadcast(ws.organizationId, 'user_offline', {
        userId: ws.userId,
        userName: ws.userName,
      }, ws.userId);
    });

    ws.on('error', (error) => {
      logger.error({ error, userId: ws.userId }, 'WebSocket error');
    });
  });

  // Heartbeat: ping all clients every 30s, close dead connections
  heartbeatInterval = setInterval(() => {
    if (!wss) return;
    for (const [, orgSockets] of connections) {
      for (const ws of orgSockets) {
        if (!ws.isAlive) {
          ws.terminate();
          continue;
        }
        ws.isAlive = false;
        ws.ping();
      }
    }
  }, 30000);

  logger.info('WebSocket server initialized');
}

/**
 * Handle messages from clients
 */
function handleClientMessage(ws: AuthenticatedSocket, message: { type: string; [key: string]: unknown }): void {
  switch (message.type) {
    case 'ping':
      sendToSocket(ws, { type: 'pong' });
      break;

    case 'claim_customer': {
      const kundeId = Number(message.kundeId);
      if (!kundeId || kundeId <= 0) break;

      // Use client-provided name if available, fallback to WS auth name
      const displayName = typeof message.userName === 'string' && message.userName
        ? message.userName
        : ws.userName;

      claimCustomer(ws.organizationId, kundeId, ws.userId, displayName);
      break;
    }

    case 'release_customer': {
      const releaseKundeId = Number(message.kundeId);
      if (!releaseKundeId || releaseKundeId <= 0) break;

      releaseCustomer(ws.organizationId, releaseKundeId, ws.userId);
      break;
    }

    case 'chat_typing_start': {
      const convId = Number(message.conversationId);
      if (!convId || convId <= 0) break;
      broadcast(ws.organizationId, 'chat_typing', {
        conversationId: convId,
        userId: ws.userId,
        userName: ws.userName,
      }, ws.userId);
      break;
    }

    case 'chat_typing_stop': {
      const stopConvId = Number(message.conversationId);
      if (!stopConvId || stopConvId <= 0) break;
      broadcast(ws.organizationId, 'chat_typing_stop', {
        conversationId: stopConvId,
        userId: ws.userId,
      }, ws.userId);
      break;
    }

    default:
      break;
  }
}

/**
 * Claim a customer — mark that a user is working on this customer
 */
function claimCustomer(organizationId: number, kundeId: number, userId: number, userName: string): void {
  if (!presenceClaims.has(organizationId)) {
    presenceClaims.set(organizationId, new Map());
  }
  const orgClaims = presenceClaims.get(organizationId)!;

  // Check if already claimed by same user (idempotent)
  const existing = orgClaims.get(kundeId);
  if (existing && existing.userId === userId) return;

  const claim: PresenceClaim = {
    userId,
    userName,
    initials: getInitials(userName),
    claimedAt: Date.now(),
  };

  orgClaims.set(kundeId, claim);

  // Broadcast to all users in org (including sender, so they get confirmation)
  broadcast(organizationId, 'customer_claimed', {
    kundeId,
    ...claim,
  });
}

/**
 * Release a customer claim — only the claiming user can release
 */
function releaseCustomer(organizationId: number, kundeId: number, userId: number): void {
  const orgClaims = presenceClaims.get(organizationId);
  if (!orgClaims) return;

  const existing = orgClaims.get(kundeId);
  if (!existing || existing.userId !== userId) return;

  orgClaims.delete(kundeId);
  if (orgClaims.size === 0) {
    presenceClaims.delete(organizationId);
  }

  broadcast(organizationId, 'customer_released', {
    kundeId,
    userId,
  });
}

/**
 * Release all claims by a user (called on disconnect)
 */
function releaseAllClaims(organizationId: number, userId: number): void {
  const orgClaims = presenceClaims.get(organizationId);
  if (!orgClaims) return;

  const releasedKundeIds: number[] = [];
  for (const [kundeId, claim] of orgClaims) {
    if (claim.userId === userId) {
      releasedKundeIds.push(kundeId);
    }
  }

  for (const kundeId of releasedKundeIds) {
    orgClaims.delete(kundeId);
    broadcast(organizationId, 'customer_released', {
      kundeId,
      userId,
    });
  }

  if (orgClaims.size === 0) {
    presenceClaims.delete(organizationId);
  }
}

/**
 * Send a message to a single socket (safe)
 */
function sendToSocket(ws: WebSocket, data: unknown): void {
  if (ws.readyState === WebSocket.OPEN) {
    try {
      ws.send(JSON.stringify(data));
    } catch {
      // Socket closed between check and send
    }
  }
}

/**
 * Broadcast a message to all clients in an organization
 * @param organizationId - Target organization
 * @param type - Event type (e.g. 'kunde_created')
 * @param data - Event payload
 * @param excludeUserId - Don't send to this user (avoid echo to sender)
 */
export function broadcast(
  organizationId: number,
  type: string,
  data: unknown,
  excludeUserId?: number,
): void {
  const orgConnections = connections.get(organizationId);
  if (!orgConnections || orgConnections.size === 0) return;

  const message = JSON.stringify({ type, data });

  for (const ws of orgConnections) {
    if (excludeUserId && ws.userId === excludeUserId) continue;
    if (ws.readyState === WebSocket.OPEN) {
      try {
        ws.send(message);
      } catch {
        // Socket closed between check and send
      }
    }
  }
}

/**
 * Send a message to a specific user in an organization
 * Used for DM notifications where we only want to notify the recipient
 */
export function sendToUser(
  organizationId: number,
  userId: number,
  type: string,
  data: unknown,
): void {
  const orgConnections = connections.get(organizationId);
  if (!orgConnections || orgConnections.size === 0) return;

  const message = JSON.stringify({ type, data });

  for (const ws of orgConnections) {
    if (ws.userId === userId && ws.readyState === WebSocket.OPEN) {
      try {
        ws.send(message);
      } catch {
        // Socket closed between check and send
      }
    }
  }
}

/**
 * Get all presence claims for an organization
 */
export function getPresenceForOrg(organizationId: number): Record<string, PresenceClaim> {
  const orgClaims = presenceClaims.get(organizationId);
  if (!orgClaims) return {};

  const result: Record<string, PresenceClaim> = {};
  for (const [kundeId, claim] of orgClaims) {
    result[String(kundeId)] = claim;
  }
  return result;
}

/**
 * Get active users in an organization
 */
export function getActiveUsers(organizationId: number): Array<{ userId: number; userName: string }> {
  const orgConnections = connections.get(organizationId);
  if (!orgConnections) return [];

  const seen = new Set<number>();
  const users: Array<{ userId: number; userName: string }> = [];

  for (const ws of orgConnections) {
    if (!seen.has(ws.userId)) {
      seen.add(ws.userId);
      users.push({ userId: ws.userId, userName: ws.userName });
    }
  }

  return users;
}

/**
 * Get count of active connections
 */
export function getConnectionCount(): { total: number; organizations: number } {
  let total = 0;
  for (const [, sockets] of connections) {
    total += sockets.size;
  }
  return { total, organizations: connections.size };
}

/**
 * Gracefully shut down WebSocket server
 */
export function shutdownWebSocket(): void {
  if (heartbeatInterval) {
    clearInterval(heartbeatInterval);
    heartbeatInterval = null;
  }

  if (wss) {
    for (const [, orgSockets] of connections) {
      for (const ws of orgSockets) {
        ws.close(1001, 'Server shutting down');
      }
    }
    connections.clear();
    presenceClaims.clear();
    wss.close();
    wss = null;
    logger.info('WebSocket server shut down');
  }
}
