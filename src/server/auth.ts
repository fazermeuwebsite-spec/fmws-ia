import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import bcrypt from 'bcryptjs';
import { Request, Response, NextFunction } from 'express';
import { User, UserRole } from '../types';
import { StoredUser } from './initialData';

const DATA_DIR = path.resolve(process.cwd(), 'data');
const SECRET_FILE = path.join(DATA_DIR, '.auth_secret');
export const SESSION_COOKIE_NAME = 'fmws_session';
export const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 7; // 7 days

function getOrCreateAuthSecret(): string {
  if (process.env.AUTH_SESSION_SECRET && process.env.AUTH_SESSION_SECRET.length >= 32) {
    return process.env.AUTH_SESSION_SECRET;
  }
  try {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
    if (fs.existsSync(SECRET_FILE)) {
      const existing = fs.readFileSync(SECRET_FILE, 'utf-8').trim();
      if (existing.length >= 32) return existing;
    }
    const generated = crypto.randomBytes(48).toString('hex');
    fs.writeFileSync(SECRET_FILE, generated, { mode: 0o600 });
    return generated;
  } catch {
    return crypto.randomBytes(48).toString('hex');
  }
}

const AUTH_SECRET = getOrCreateAuthSecret();

export function hashPassword(password: string): string {
  const salt = bcrypt.genSaltSync(12);
  return bcrypt.hashSync(password, salt);
}

export function verifyPassword(password: string, storedHash?: string): boolean {
  if (!storedHash) return false;

  // Standard bcrypt hash ($2a$ / $2b$ / $2y$)
  if (storedHash.startsWith('$2')) {
    try {
      return bcrypt.compareSync(password, storedHash);
    } catch {
      return false;
    }
  }

  // Backward compatibility for legacy scrypt hashes (salt:hex)
  if (storedHash.includes(':')) {
    const [salt, keyHex] = storedHash.split(':');
    if (!salt || !keyHex) return false;
    try {
      const keyBuf = Buffer.from(keyHex, 'hex');
      const derivedBuf = crypto.scryptSync(password, salt, 64);
      if (keyBuf.length !== derivedBuf.length) return false;
      return crypto.timingSafeEqual(keyBuf, derivedBuf);
    } catch {
      return false;
    }
  }

  return false;
}

export interface SessionRecord {
  sid: string;
  userId: string;
  role: UserRole;
  createdAt: string;
  expiresAt: number;
}

export interface SessionPayload {
  sid: string;
  uid: string;
  role: UserRole;
  exp: number;
}

export function signSessionToken(session: { sid: string; uid: string; role: UserRole; exp: number }): string {
  const payload: SessionPayload = {
    sid: session.sid,
    uid: session.uid,
    role: session.role,
    exp: session.exp
  };
  const data = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = crypto.createHmac('sha256', AUTH_SECRET).update(data).digest('base64url');
  return `${data}.${sig}`;
}

export function verifySessionToken(token?: string): SessionPayload | null {
  if (!token || !token.includes('.')) return null;
  const [data, sig] = token.split('.');
  if (!data || !sig) return null;
  const expectedSig = crypto.createHmac('sha256', AUTH_SECRET).update(data).digest('base64url');
  try {
    const sigBuf = Buffer.from(sig);
    const expBuf = Buffer.from(expectedSig);
    if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) {
      return null;
    }
    const payload = JSON.parse(Buffer.from(data, 'base64url').toString('utf-8')) as SessionPayload;
    if (!payload.sid || !payload.uid || !payload.exp || Date.now() > payload.exp) {
      return null;
    }
    return payload;
  } catch {
    return null;
  }
}

export function parseCookies(cookieHeader?: string): Record<string, string> {
  const cookies: Record<string, string> = {};
  if (!cookieHeader) return cookies;
  cookieHeader.split(';').forEach((pair) => {
    const idx = pair.indexOf('=');
    if (idx > 0) {
      const key = pair.slice(0, idx).trim();
      const val = pair.slice(idx + 1).trim();
      try {
        cookies[key] = decodeURIComponent(val);
      } catch {
        cookies[key] = val;
      }
    }
  });
  return cookies;
}

export function extractTokenFromRequest(req: Request): string | undefined {
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    return authHeader.slice(7).trim();
  }
  const cookies = parseCookies(req.headers.cookie);
  return cookies[SESSION_COOKIE_NAME];
}

export function sanitizeUser(user: StoredUser): User {
  const { passwordHash, ...rest } = user;
  return {
    ...rest,
    hasPassword: Boolean(passwordHash)
  };
}

export function isHttpsRequest(req: Request): boolean {
  const forwardedProto = String(req.headers['x-forwarded-proto'] || '')
    .split(',')[0]
    .trim()
    .toLowerCase();
  return (
    req.secure ||
    forwardedProto === 'https' ||
    (process.env.APP_URL || '').trim().toLowerCase().startsWith('https://')
  );
}

export function setSessionCookie(req: Request, res: Response, token: string) {
  const isHttps = isHttpsRequest(req);
  res.cookie(SESSION_COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: isHttps ? 'none' : 'lax',
    secure: isHttps,
    maxAge: SESSION_TTL_MS,
    path: '/'
  });
}

export function clearSessionCookie(req: Request, res: Response) {
  const isHttps = isHttpsRequest(req);
  res.clearCookie(SESSION_COOKIE_NAME, {
    httpOnly: true,
    sameSite: isHttps ? 'none' : 'lax',
    secure: isHttps,
    path: '/'
  });
}

export interface AuthenticatedRequest extends Request {
  user?: User;
  sessionId?: string;
}

export const ROLE_PERMISSIONS: Record<UserRole, string[]> = {
  admin: [
    '*',
    'dashboard',
    'crm',
    'crm.read',
    'leads.write',
    'prospecting',
    'prospecting.read',
    'whatsapp',
    'whatsapp.read',
    'clients',
    'clients.read',
    'proposals',
    'proposals.read',
    'proposals.write',
    'projects',
    'projects.read',
    'financial',
    'financial.read',
    'support',
    'support.read',
    'support.write',
    'ai_agents',
    'agents.read',
    'reports',
    'reports.read',
    'settings',
    'settings.read',
    'users.manage',
    'manage_users',
    'manage_integrations',
    'approve_outreach',
    'approve_proposals'
  ],
  comercial: [
    'dashboard',
    'crm',
    'crm.read',
    'leads.write',
    'prospecting',
    'prospecting.read',
    'whatsapp',
    'whatsapp.read',
    'clients',
    'clients.read',
    'proposals',
    'proposals.read',
    'proposals.write',
    'projects',
    'projects.read',
    'support',
    'support.read',
    'support.write',
    'ai_agents',
    'agents.read',
    'reports',
    'reports.read',
    'approve_outreach',
    'approve_proposals'
  ],
  suporte: [
    'dashboard',
    'crm.read',
    'whatsapp',
    'whatsapp.read',
    'clients.read',
    'projects',
    'projects.read',
    'support',
    'support.read',
    'support.write',
    'agents.read'
  ],
  financeiro: [
    'dashboard',
    'crm.read',
    'clients.read',
    'proposals.read',
    'financial',
    'financial.read',
    'reports',
    'reports.read',
    'agents.read'
  ]
};

export function hasPermission(role: UserRole, permission: string): boolean {
  const perms = ROLE_PERMISSIONS[role] || [];
  return perms.includes('*') || perms.includes(permission);
}

export function createAuthMiddleware(
  getUsers: () => StoredUser[],
  getSessionById: (sid: string) => SessionRecord | undefined
) {
  const requireAuth = (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    const token = extractTokenFromRequest(req);
    const payload = verifySessionToken(token);
    if (!payload) {
      return res.status(401).json({
        error: 'Autenticação necessária. Faça login para acessar este recurso.',
        code: 'UNAUTHENTICATED'
      });
    }

    const activeSession = getSessionById(payload.sid);
    if (!activeSession || activeSession.userId !== payload.uid || Date.now() > activeSession.expiresAt) {
      return res.status(401).json({
        error: 'Sessão expirada ou encerrada. Faça login novamente.',
        code: 'SESSION_REVOKED'
      });
    }

    const found = getUsers().find((u) => u.id === payload.uid);
    if (!found || !found.active) {
      return res.status(401).json({
        error: 'Sessão inválida ou usuário desativado.',
        code: 'INVALID_SESSION'
      });
    }

    req.user = sanitizeUser(found);
    req.sessionId = payload.sid;
    next();
  };

  const requireRole = (...allowedRoles: UserRole[]) => {
    return (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
      if (!req.user) {
        return res.status(401).json({ error: 'Não autenticado.' });
      }
      if (!allowedRoles.includes(req.user.role)) {
        return res.status(403).json({
          error: `Permissão negada para o perfil "${req.user.role}".`,
          code: 'FORBIDDEN'
        });
      }
      next();
    };
  };

  return { requireAuth, requireRole };
}
