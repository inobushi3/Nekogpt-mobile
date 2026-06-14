import { DurableObject } from 'cloudflare:workers';

export interface Env {
  SESSION_ROOMS: DurableObjectNamespace<SessionRoom>;
  ALLOWED_ORIGIN?: string;
}

type SocketRole = 'desktop' | 'mobile';

type SocketAttachment = {
  role: SocketRole;
  connectedAt: number;
};

function json(data: unknown, status = 200, headers: HeadersInit = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', ...headers },
  });
}

function normalizeRoom(value: string | null) {
  const room = String(value || '').trim().toUpperCase();
  return /^[A-Z0-9]{4,10}$/.test(room) ? room : '';
}

function normalizeRole(value: string | null): SocketRole | '' {
  return value === 'desktop' || value === 'mobile' ? value : '';
}

function corsHeaders(request: Request, env: Env) {
  const origin = request.headers.get('origin') || '';
  const allowedOrigin = env.ALLOWED_ORIGIN || '*';
  return {
    'access-control-allow-origin': allowedOrigin === '*' ? '*' : origin === allowedOrigin ? origin : allowedOrigin,
    'access-control-allow-methods': 'GET, OPTIONS',
    'access-control-allow-headers': 'content-type',
    'vary': 'Origin',
  };
}

export default {
  async fetch(request: Request, env: Env) {
    const url = new URL(request.url);
    const headers = corsHeaders(request, env);
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers });
    if (url.pathname === '/health') return json({ ok: true, service: 'nekogpt-mobile-relay' }, 200, headers);
    if (url.pathname !== '/connect') return json({ error: 'Not found' }, 404, headers);
    if (request.headers.get('upgrade')?.toLowerCase() !== 'websocket') {
      return json({ error: 'WebSocket upgrade required' }, 426, headers);
    }

    const room = normalizeRoom(url.searchParams.get('room'));
    const role = normalizeRole(url.searchParams.get('role'));
    if (!room || !role) return json({ error: 'Invalid room or role' }, 400, headers);
    const allowedOrigin = env.ALLOWED_ORIGIN || '*';
    const requestOrigin = request.headers.get('origin') || '';
    if (role === 'mobile' && allowedOrigin !== '*' && requestOrigin !== allowedOrigin) {
      return json({ error: 'Origin not allowed' }, 403, headers);
    }

    const id = env.SESSION_ROOMS.idFromName(room);
    return env.SESSION_ROOMS.get(id).fetch(request);
  },
} satisfies ExportedHandler<Env>;

export class SessionRoom extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
  }

  async fetch(request: Request) {
    const url = new URL(request.url);
    const role = normalizeRole(url.searchParams.get('role'));
    if (!role || request.headers.get('upgrade')?.toLowerCase() !== 'websocket') {
      return new Response('Bad request', { status: 400 });
    }

    const existing = this.ctx.getWebSockets(role);
    if (role === 'desktop' && existing.length) {
      existing.forEach((socket) => {
        try {
          socket.close(4001, 'desktop replaced');
        } catch {}
      });
    }
    if (role === 'mobile' && existing.length >= 1) {
      return new Response('A mobile client is already connected', { status: 409 });
    }

    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];
    server.serializeAttachment({ role, connectedAt: Date.now() } satisfies SocketAttachment);
    this.ctx.acceptWebSocket(server, [role]);
    this.send(server, {
      type: 'relay.ready',
      role,
      desktopOnline: this.ctx.getWebSockets('desktop').length > 0,
      mobileOnline: this.ctx.getWebSockets('mobile').length > 0,
    });
    this.broadcast(role === 'desktop' ? 'mobile' : 'desktop', {
      type: 'relay.peer.joined',
      role,
    });
    return new Response(null, { status: 101, webSocket: client });
  }

  webSocketMessage(socket: WebSocket, message: string | ArrayBuffer) {
    const attachment = socket.deserializeAttachment() as SocketAttachment | null;
    if (!attachment) return;
    const targetRole: SocketRole = attachment.role === 'desktop' ? 'mobile' : 'desktop';
    this.ctx.getWebSockets(targetRole).forEach((target) => {
      try {
        target.send(message);
      } catch {}
    });
  }

  webSocketClose(socket: WebSocket) {
    const attachment = socket.deserializeAttachment() as SocketAttachment | null;
    if (!attachment) return;
    const targetRole: SocketRole = attachment.role === 'desktop' ? 'mobile' : 'desktop';
    this.broadcast(targetRole, { type: 'relay.peer.left', role: attachment.role });
  }

  webSocketError(socket: WebSocket) {
    this.webSocketClose(socket);
  }

  private send(socket: WebSocket, payload: unknown) {
    try {
      socket.send(JSON.stringify(payload));
    } catch {}
  }

  private broadcast(role: SocketRole, payload: unknown) {
    this.ctx.getWebSockets(role).forEach((socket) => this.send(socket, payload));
  }
}
