import http from 'http';
import type { Request, Response } from 'express';
import { WebSocketServer, WebSocket } from 'ws';
import { WhatsAppConversation, ChatMessage } from '../types';

export type WhatsAppRealtimeEvent =
  | { type: 'whatsapp:init'; conversations: WhatsAppConversation[] }
  | { type: 'whatsapp:conversation_created'; conversation: WhatsAppConversation }
  | { type: 'whatsapp:message_created'; conversation: WhatsAppConversation; message: ChatMessage }
  | { type: 'whatsapp:conversation_updated'; conversation: WhatsAppConversation }
  | { type: 'whatsapp:conversation_deleted'; conversationId: string };

const wsClients = new Set<WebSocket>();
const sseClients = new Set<Response>();
let heartbeatTimer: NodeJS.Timeout | null = null;

function ensureHeartbeat() {
  if (heartbeatTimer) return;
  heartbeatTimer = setInterval(() => {
    for (const client of wsClients) {
      if (client.readyState === WebSocket.OPEN) {
        try {
          client.ping();
        } catch {
          wsClients.delete(client);
        }
      } else {
        wsClients.delete(client);
      }
    }
    for (const res of sseClients) {
      if (res.writableEnded || res.destroyed) {
        sseClients.delete(res);
      } else {
        try {
          res.write(': keepalive\n\n');
        } catch {
          sseClients.delete(res);
        }
      }
    }
  }, 25000);
}

export function broadcastWhatsAppEvent(event: WhatsAppRealtimeEvent): void {
  const payload = JSON.stringify(event);

  for (const client of wsClients) {
    if (client.readyState === WebSocket.OPEN) {
      try {
        client.send(payload);
      } catch {
        wsClients.delete(client);
      }
    } else {
      wsClients.delete(client);
    }
  }

  const sseLine = `data: ${payload}\n\n`;
  for (const res of sseClients) {
    if (res.writableEnded || res.destroyed) {
      sseClients.delete(res);
    } else {
      try {
        res.write(sseLine);
      } catch {
        sseClients.delete(res);
      }
    }
  }
}

export function registerWhatsAppSseClient(
  req: Request,
  res: Response,
  initialConversations: WhatsAppConversation[]
): void {
  ensureHeartbeat();
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders?.();

  sseClients.add(res);

  const initPayload: WhatsAppRealtimeEvent = {
    type: 'whatsapp:init',
    conversations: initialConversations
  };
  try {
    res.write(`data: ${JSON.stringify(initPayload)}\n\n`);
  } catch {
    sseClients.delete(res);
  }

  req.on('close', () => {
    sseClients.delete(res);
  });
}

export function attachWhatsAppWebSocketServer(params: {
  httpServer: http.Server;
  authenticateUpgrade: (req: http.IncomingMessage, url: URL) => boolean;
  getInitialConversations: () => WhatsAppConversation[];
}): void {
  const { httpServer, authenticateUpgrade, getInitialConversations } = params;
  const wss = new WebSocketServer({ noServer: true });
  ensureHeartbeat();

  httpServer.on('upgrade', (req, socket, head) => {
    let parsedUrl: URL;
    try {
      parsedUrl = new URL(req.url || '/', 'http://localhost');
    } catch {
      return;
    }

    if (parsedUrl.pathname !== '/ws/whatsapp') {
      return;
    }

    if (!authenticateUpgrade(req, parsedUrl)) {
      socket.write('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n');
      socket.destroy();
      return;
    }

    wss.handleUpgrade(req, socket, head, (ws) => {
      wsClients.add(ws);

      const initEvent: WhatsAppRealtimeEvent = {
        type: 'whatsapp:init',
        conversations: getInitialConversations()
      };
      try {
        ws.send(JSON.stringify(initEvent));
      } catch {
        wsClients.delete(ws);
      }

      ws.on('close', () => {
        wsClients.delete(ws);
      });
      ws.on('error', () => {
        wsClients.delete(ws);
      });
    });
  });
}
