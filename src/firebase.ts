import { initializeApp } from 'firebase/app';
import {
  getAuth,
  GoogleAuthProvider,
  signInWithPopup,
  signOut,
  onAuthStateChanged,
  setPersistence,
  browserLocalPersistence
} from 'firebase/auth';
import type { User as FirebaseUser } from 'firebase/auth';
import {
  getFirestore,
  doc,
  getDocFromServer,
  getDoc,
  getDocs,
  setDoc,
  deleteDoc,
  onSnapshot,
  writeBatch,
  collection,
  query,
  where,
  serverTimestamp
} from 'firebase/firestore';
import firebaseConfig from '../firebase-applet-config.json';
import type {
  ChatMessage,
  WhatsAppConversation,
  WhatsAppHandoverEntry,
  WhatsAppIntegrationLog
} from './types';

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app, firebaseConfig.firestoreDatabaseId);
export const auth = getAuth(app);
setPersistence(auth, browserLocalPersistence).catch(() => {});
export const googleProvider = new GoogleAuthProvider();
export const firestoreProjectId = firebaseConfig.projectId;
export const firestoreDatabaseId = firebaseConfig.firestoreDatabaseId;
export { onAuthStateChanged };
export type { FirebaseUser };

function stripUndefinedDeep<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map((item) => stripUndefinedDeep(item)) as unknown as T;
  }
  if (value && typeof value === 'object') {
    const out: Record<string, any> = {};
    for (const [k, v] of Object.entries(value as Record<string, any>)) {
      if (v !== undefined) {
        out[k] = stripUndefinedDeep(v);
      }
    }
    return out as T;
  }
  return value;
}

export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write'
}

export interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
    isAnonymous?: boolean | null;
    tenantId?: string | null;
    providerInfo?: {
      providerId?: string | null;
      email?: string | null;
    }[];
  };
}

export function handleFirestoreError(
  error: unknown,
  operationType: OperationType,
  path: string | null
): never {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo:
        auth.currentUser?.providerData?.map((provider) => ({
          providerId: provider.providerId,
          email: provider.email
        })) || []
    },
    operationType,
    path
  };
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

export async function testFirestoreConnection(): Promise<{ ok: boolean; detail?: string }> {
  try {
    await getDocFromServer(doc(db, 'test', 'connection'));
    return { ok: true };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    if (msg.includes('the client is offline')) {
      console.error('Please check your Firebase configuration.');
      return { ok: false, detail: 'Firestore offline ou indisponível.' };
    }
    return { ok: true };
  }
}

export async function signInFirebaseWithGoogle() {
  const result = await signInWithPopup(auth, googleProvider);
  return result.user;
}

export async function signOutFirebase() {
  await signOut(auth);
}

export interface CloudSyncSnapshot {
  users: any[];
  buckets: Record<string, any[]>;
}

let activeFirestoreSyncChain: Promise<void> = Promise.resolve();

async function executeAtomicFirestoreSync(snapshot: CloudSyncSnapshot): Promise<{
  workspaceId: string;
  usersSynced: number;
  bucketsSynced: number;
}> {
  const user = auth.currentUser;
  if (!user || !user.emailVerified) {
    throw new Error('Autentique-se com sua conta Google verificada para sincronizar no Firestore.');
  }

  const workspaceId = user.uid;
  const workspaceRef = doc(db, 'workspaces', workspaceId);
  const usersCol = collection(db, 'workspaces', workspaceId, 'users');
  const bucketsCol = collection(db, 'workspaces', workspaceId, 'buckets');
  const leadCount = Array.isArray(snapshot.buckets.leads) ? snapshot.buckets.leads.length : 0;

  let existingWs: any;
  let existingUsersSnap: any;
  let existingBucketsSnap: any;

  try {
    [existingWs, existingUsersSnap, existingBucketsSnap] = await Promise.all([
      getDoc(workspaceRef),
      getDocs(query(usersCol, where('ownerId', '==', workspaceId))),
      getDocs(query(bucketsCol, where('ownerId', '==', workspaceId)))
    ]);
  } catch (err) {
    handleFirestoreError(err, OperationType.LIST, `workspaces/${workspaceId}`);
  }

  const existingWsData = existingWs?.data?.() as Record<string, any> | undefined;
  const wsExisted = Boolean(existingWs?.exists?.() && existingWsData?.createdAt);

  // If workspace document does not exist yet, create it before writing subcollections
  // because firestore.rules checks exists(/workspaces/$(workspaceId)) on child writes.
  if (!wsExisted) {
    try {
      await setDoc(workspaceRef, {
        ownerId: workspaceId,
        name: 'FMWS SALES AI Workspace',
        userCount: snapshot.users.length,
        leadCount,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      });
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, `workspaces/${workspaceId}`);
    }
  }

  const existingUsersMap = new Map<string, Record<string, any>>();
  for (const d of existingUsersSnap.docs) {
    existingUsersMap.set(d.id, d.data() || {});
  }

  const existingBucketsMap = new Map<string, Record<string, any>>();
  for (const d of existingBucketsSnap.docs) {
    existingBucketsMap.set(d.id, d.data() || {});
  }

  type BatchOp =
    | { kind: 'set'; ref: any; data: Record<string, any>; path: string }
    | { kind: 'update'; ref: any; data: Record<string, any>; path: string }
    | { kind: 'delete'; ref: any; path: string };

  const ops: BatchOp[] = [];

  if (wsExisted) {
    ops.push({
      kind: 'update',
      ref: workspaceRef,
      path: `workspaces/${workspaceId}`,
      data: {
        name: 'FMWS SALES AI Workspace',
        userCount: snapshot.users.length,
        leadCount,
        updatedAt: serverTimestamp()
      }
    });
  }

  let usersSynced = 0;
  const activeUserIds = new Set<string>();
  for (const u of snapshot.users) {
    const safeId = String(u.id || '').trim();
    if (!safeId) continue;
    activeUserIds.add(safeId);
    const userPath = `workspaces/${workspaceId}/users/${safeId}`;
    const uRef = doc(db, 'workspaces', workspaceId, 'users', safeId);
    const existingUser = existingUsersMap.get(safeId);

    const safeName = (String(u.name || u.email || 'Usuário').trim() || 'Usuário').slice(0, 120);
    const safeEmail = (String(u.email || 'admin@fazermeuwebsite.com.br').trim() || 'admin@fazermeuwebsite.com.br').slice(0, 180);
    const safeAvatar =
      typeof u.avatar === 'string' && u.avatar.trim().length > 0 && u.avatar.trim().length <= 500
        ? u.avatar.trim()
        : undefined;

    if (existingUser && existingUser.createdAt) {
      const updatePayload: Record<string, any> = {
        name: safeName,
        email: safeEmail,
        role: u.role,
        active: Boolean(u.active),
        updatedAt: serverTimestamp()
      };
      if (u.passwordHash) updatePayload.passwordHash = String(u.passwordHash).slice(0, 256);
      if (safeAvatar) updatePayload.avatar = safeAvatar;
      ops.push({ kind: 'update', ref: uRef, data: updatePayload, path: userPath });
    } else {
      const createPayload: Record<string, any> = {
        ownerId: workspaceId,
        id: safeId,
        name: safeName,
        email: safeEmail,
        role: u.role,
        active: Boolean(u.active),
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      };
      if (u.passwordHash) createPayload.passwordHash = String(u.passwordHash).slice(0, 256);
      if (safeAvatar) createPayload.avatar = safeAvatar;
      ops.push({ kind: 'set', ref: uRef, data: createPayload, path: userPath });
    }
    usersSynced++;
  }

  for (const existingDoc of existingUsersSnap.docs) {
    if (!activeUserIds.has(existingDoc.id)) {
      ops.push({
        kind: 'delete',
        ref: existingDoc.ref,
        path: `workspaces/${workspaceId}/users/${existingDoc.id}`
      });
    }
  }

  let bucketsSynced = 0;
  for (const [bucketKey, items] of Object.entries(snapshot.buckets)) {
    const bucketPath = `workspaces/${workspaceId}/buckets/${bucketKey}`;
    const bRef = doc(db, 'workspaces', workspaceId, 'buckets', bucketKey);
    const existingBucket = existingBucketsMap.get(bucketKey);
    const sanitizedItems = Array.isArray(items) ? stripUndefinedDeep(items.slice(0, 500)) : [];

    if (existingBucket && existingBucket.createdAt) {
      ops.push({
        kind: 'update',
        ref: bRef,
        path: bucketPath,
        data: {
          items: sanitizedItems,
          updatedAt: serverTimestamp()
        }
      });
    } else {
      ops.push({
        kind: 'set',
        ref: bRef,
        path: bucketPath,
        data: {
          ownerId: workspaceId,
          bucketKey,
          items: sanitizedItems,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp()
        }
      });
    }
    bucketsSynced++;
  }

  // Sync structured WhatsApp collections (contacts, conversations, deduplicated messages, handovers, sanitized logs)
  const sanitizeFsId = (raw: string): string => {
    const cleaned = String(raw || '')
      .replace(/[^a-zA-Z0-9_-]/g, '_')
      .slice(0, 120);
    return cleaned || `id_${Date.now()}`;
  };

  const whatsappConversations = Array.isArray(snapshot.buckets.whatsappConversations)
    ? snapshot.buckets.whatsappConversations
    : [];

  if (whatsappConversations.length > 0) {
    let existingContactsSnap: any;
    let existingConvsSnap: any;
    try {
      [existingContactsSnap, existingConvsSnap] = await Promise.all([
        getDocs(query(collection(db, 'workspaces', workspaceId, 'whatsappContacts'), where('ownerId', '==', workspaceId))),
        getDocs(query(collection(db, 'workspaces', workspaceId, 'whatsappConversations'), where('ownerId', '==', workspaceId)))
      ]);
    } catch (err) {
      handleFirestoreError(err, OperationType.LIST, `workspaces/${workspaceId}/whatsappConversations`);
    }

    const existingContactsMap = new Map<string, Record<string, any>>();
    for (const d of existingContactsSnap.docs) {
      existingContactsMap.set(d.id, d.data() || {});
    }
    const existingConvsMap = new Map<string, Record<string, any>>();
    for (const d of existingConvsSnap.docs) {
      existingConvsMap.set(d.id, d.data() || {});
    }

    const seenPhones = new Set<string>();
    const activeConvIds = new Set<string>();

    for (const conv of whatsappConversations.slice(0, 200)) {
      const convId = sanitizeFsId(conv.id);
      const rawPhone = normalizeWhatsAppPhone(conv.waId || conv.contactPhone || '') || String(conv.contactPhone || '').replace(/\D/g, '');
      const normPhone = (rawPhone || convId).slice(0, 32);
      const waId = normalizeWhatsAppPhone(conv.waId || normPhone) || normPhone;
      const effectivePid = sanitizeWhatsAppIdPart(conv.phoneNumberId || 'default');
      const convKey = conv.conversationKey
        ? String(conv.conversationKey).slice(0, 256)
        : buildWhatsAppConversationKey({ workspaceId, phoneNumberId: effectivePid, waId });
      const contactId = sanitizeFsId(normPhone);
      const contactName = String(conv.contactName || `Contato +${normPhone}`).trim().slice(0, 160) || 'Contato';

      if (!seenPhones.has(contactId)) {
        seenPhones.add(contactId);
        const contactRef = doc(db, 'workspaces', workspaceId, 'whatsappContacts', contactId);
        const contactPath = `workspaces/${workspaceId}/whatsappContacts/${contactId}`;
        const existingContact = existingContactsMap.get(contactId);

        if (existingContact && existingContact.createdAt) {
          const updateContact: Record<string, any> = {
            name: contactName,
            updatedAt: serverTimestamp()
          };
          if (conv.leadId) updateContact.leadId = String(conv.leadId).slice(0, 128);
          if (conv.clientId) updateContact.clientId = String(conv.clientId).slice(0, 128);
          if (conv.lastInboundAt) updateContact.lastInboundAt = String(conv.lastInboundAt).slice(0, 64);
          ops.push({ kind: 'update', ref: contactRef, path: contactPath, data: updateContact });
        } else {
          const createContact: Record<string, any> = {
            ownerId: workspaceId,
            id: contactId,
            normalizedPhone: normPhone.padEnd(8, '0').slice(0, 32),
            name: contactName,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp()
          };
          if (conv.leadId) createContact.leadId = String(conv.leadId).slice(0, 128);
          if (conv.clientId) createContact.clientId = String(conv.clientId).slice(0, 128);
          if (conv.lastInboundAt) createContact.lastInboundAt = String(conv.lastInboundAt).slice(0, 64);
          ops.push({ kind: 'set', ref: contactRef, path: contactPath, data: createContact });
        }
      }

      activeConvIds.add(convId);
      const convRef = doc(db, 'workspaces', workspaceId, 'whatsappConversations', convId);
      const convPath = `workspaces/${workspaceId}/whatsappConversations/${convId}`;
      const existingConv = existingConvsMap.get(convId);
      const safeStatus = ['ai_active', 'human_takeover', 'resolved'].includes(conv.status)
        ? conv.status
        : 'ai_active';

      if (existingConv && existingConv.createdAt) {
        const remoteTs = Date.parse(String(existingConv.lastMessageTimestamp || '')) || 0;
        const localTs = Date.parse(String(conv.lastMessageTimestamp || '')) || 0;
        if (remoteTs <= localTs) {
          const updateConv: Record<string, any> = {
            contactPhone: normPhone.padEnd(8, '0').slice(0, 32),
            waId: waId.padEnd(8, '0').slice(0, 32),
            phoneNumberId: effectivePid,
            conversationKey: convKey,
            contactName,
            status: safeStatus,
            aiPaused: Boolean(conv.aiPaused),
            assignedAgent: String(conv.assignedAgent || 'Atendente IA').slice(0, 120) || 'Atendente IA',
            lastMessage: String(conv.lastMessage || '').slice(0, 2000),
            lastMessageTimestamp: String(conv.lastMessageTimestamp || new Date().toISOString()).slice(0, 64),
            unreadCount: Math.max(0, Math.min(10000, Math.floor(Number(conv.unreadCount) || 0))),
            updatedAt: serverTimestamp()
          };
          if (conv.leadId) updateConv.leadId = String(conv.leadId).slice(0, 128);
          if (conv.clientId) updateConv.clientId = String(conv.clientId).slice(0, 128);
          if (conv.assignedUserId) updateConv.assignedUserId = String(conv.assignedUserId).slice(0, 128);
          if (conv.lastInboundAt) updateConv.lastInboundAt = String(conv.lastInboundAt).slice(0, 64);
          if (conv.closedAt) updateConv.closedAt = String(conv.closedAt).slice(0, 64);
          if (conv.closedBy) updateConv.closedBy = String(conv.closedBy).slice(0, 120);
          ops.push({ kind: 'update', ref: convRef, path: convPath, data: updateConv });
        }
      } else {
        const createConv: Record<string, any> = {
          ownerId: workspaceId,
          id: convId,
          contactId,
          contactPhone: normPhone.padEnd(8, '0').slice(0, 32),
          waId: waId.padEnd(8, '0').slice(0, 32),
          phoneNumberId: effectivePid,
          conversationKey: convKey,
          contactName,
          status: safeStatus,
          aiPaused: Boolean(conv.aiPaused),
          assignedAgent: String(conv.assignedAgent || 'Atendente IA').slice(0, 120) || 'Atendente IA',
          lastMessage: String(conv.lastMessage || '').slice(0, 2000),
          lastMessageTimestamp: String(conv.lastMessageTimestamp || new Date().toISOString()).slice(0, 64),
          unreadCount: Math.max(0, Math.min(10000, Math.floor(Number(conv.unreadCount) || 0))),
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp()
        };
        if (conv.leadId) createConv.leadId = String(conv.leadId).slice(0, 128);
        if (conv.clientId) createConv.clientId = String(conv.clientId).slice(0, 128);
        if (conv.assignedUserId) createConv.assignedUserId = String(conv.assignedUserId).slice(0, 128);
        if (conv.lastInboundAt) createConv.lastInboundAt = String(conv.lastInboundAt).slice(0, 64);
        if (conv.closedAt) createConv.closedAt = String(conv.closedAt).slice(0, 64);
        if (conv.closedBy) createConv.closedBy = String(conv.closedBy).slice(0, 120);
        ops.push({ kind: 'set', ref: convRef, path: convPath, data: createConv });
      }

      // Sync recent messages incrementally (deduplicated by Meta wamid or message id)
      const msgs = Array.isArray(conv.messages) ? conv.messages.slice(-50) : [];
      if (msgs.length > 0) {
        let existingMsgsSnap: any;
        try {
          existingMsgsSnap = await getDocs(
            query(
              collection(db, 'workspaces', workspaceId, 'whatsappConversations', convId, 'messages'),
              where('ownerId', '==', workspaceId)
            )
          );
        } catch (err) {
          handleFirestoreError(err, OperationType.LIST, `${convPath}/messages`);
        }
        const existingMsgsMap = new Map<string, Record<string, any>>();
        for (const md of existingMsgsSnap.docs) {
          existingMsgsMap.set(md.id, md.data() || {});
        }

        for (const m of msgs) {
          const dedupRaw = m.metaMessageId ? `wamid_${m.metaMessageId}` : m.id;
          const msgDocId = sanitizeFsId(dedupRaw);
          const msgRef = doc(db, 'workspaces', workspaceId, 'whatsappConversations', convId, 'messages', msgDocId);
          const msgPath = `${convPath}/messages/${msgDocId}`;
          const existingMsg = existingMsgsMap.get(msgDocId);
          const msgStatus = ['sending', 'sent', 'delivered', 'read', 'failed'].includes(m.status)
            ? m.status
            : 'sent';
          const safeSender = ['contact', 'agent', 'system'].includes(m.sender) ? m.sender : 'system';
          const safeDirection: 'inbound' | 'outbound' | 'system' =
            m.direction === 'inbound' || m.direction === 'outbound' || m.direction === 'system'
              ? m.direction
              : safeSender === 'contact'
              ? 'inbound'
              : safeSender === 'agent'
              ? 'outbound'
              : 'system';
          const safeText = String(m.text || '[Mensagem]').slice(0, 4096) || '[Mensagem]';

          if (existingMsg && existingMsg.createdAt) {
            const prevRank = WHATSAPP_STATUS_RANK[String(existingMsg.status || 'sent')] ?? 1;
            const nextRank = WHATSAPP_STATUS_RANK[msgStatus] ?? 1;
            if (
              nextRank > prevRank ||
              (!existingMsg.direction && safeDirection) ||
              (m.errorMessage && existingMsg.errorMessage !== String(m.errorMessage).slice(0, 1000))
            ) {
              const updateMsg: Record<string, any> = {
                status: nextRank >= prevRank ? msgStatus : existingMsg.status,
                direction: safeDirection,
                phoneNumberId: String(m.phoneNumberId || effectivePid).slice(0, 64),
                waId: waId.slice(0, 32),
                updatedAt: serverTimestamp()
              };
              if (m.metaMessageId) updateMsg.metaMessageId = String(m.metaMessageId).slice(0, 256);
              if (m.errorMessage) updateMsg.errorMessage = String(m.errorMessage).slice(0, 1000);
              ops.push({ kind: 'update', ref: msgRef, path: msgPath, data: updateMsg });
            }
          } else {
            const createMsg: Record<string, any> = {
              ownerId: workspaceId,
              id: msgDocId,
              conversationId: convId,
              sender: safeSender,
              direction: safeDirection,
              text: safeText,
              status: msgStatus,
              phoneNumberId: String(m.phoneNumberId || effectivePid).slice(0, 64),
              waId: waId.slice(0, 32),
              aiGenerated: Boolean(m.aiGenerated),
              timestamp: String(m.timestamp || new Date().toISOString()).slice(0, 64),
              createdAt: serverTimestamp(),
              updatedAt: serverTimestamp()
            };
            if (m.senderName) createMsg.senderName = String(m.senderName).slice(0, 160);
            if (m.metaMessageId) createMsg.metaMessageId = String(m.metaMessageId).slice(0, 256);
            if (m.errorMessage) createMsg.errorMessage = String(m.errorMessage).slice(0, 1000);
            ops.push({ kind: 'set', ref: msgRef, path: msgPath, data: createMsg });
          }
        }
      }

      // Sync handover history entries incrementally (immutable append-only)
      const handovers = Array.isArray(conv.handoverHistory) ? conv.handoverHistory.slice(-25) : [];
      if (handovers.length > 0) {
        let existingHoSnap: any;
        try {
          existingHoSnap = await getDocs(
            query(
              collection(db, 'workspaces', workspaceId, 'whatsappConversations', convId, 'handovers'),
              where('ownerId', '==', workspaceId)
            )
          );
        } catch (err) {
          handleFirestoreError(err, OperationType.LIST, `${convPath}/handovers`);
        }
        const existingHoIds = new Set<string>(existingHoSnap.docs.map((hd: any) => hd.id));
        for (const ho of handovers) {
          const hoId = sanitizeFsId(ho.id);
          if (existingHoIds.has(hoId)) continue;
          const hoRef = doc(db, 'workspaces', workspaceId, 'whatsappConversations', convId, 'handovers', hoId);
          const hoPath = `${convPath}/handovers/${hoId}`;
          const createHo: Record<string, any> = {
            ownerId: workspaceId,
            id: hoId,
            conversationId: convId,
            action: String(ho.action || 'transferred').slice(0, 48),
            toStatus: String(ho.toStatus || safeStatus).slice(0, 48),
            byUser: String(ho.byUser || 'Sistema').slice(0, 120),
            at: String(ho.at || new Date().toISOString()).slice(0, 64),
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp()
          };
          if (ho.fromStatus) createHo.fromStatus = String(ho.fromStatus).slice(0, 48);
          if (ho.assignedTo) createHo.assignedTo = String(ho.assignedTo).slice(0, 120);
          if (ho.note) createHo.note = String(ho.note).slice(0, 500);
          ops.push({ kind: 'set', ref: hoRef, path: hoPath, data: createHo });
        }
      }
    }
  }

  // Sync sanitized technical WhatsApp logs incrementally (no tokens/secrets)
  const whatsappLogs = Array.isArray(snapshot.buckets.whatsappLogs)
    ? snapshot.buckets.whatsappLogs.slice(0, 30)
    : [];
  if (whatsappLogs.length > 0) {
    let existingLogsSnap: any;
    try {
      existingLogsSnap = await getDocs(
        query(collection(db, 'workspaces', workspaceId, 'whatsappLogs'), where('ownerId', '==', workspaceId))
      );
    } catch (err) {
      handleFirestoreError(err, OperationType.LIST, `workspaces/${workspaceId}/whatsappLogs`);
    }
    const existingLogIds = new Set<string>(existingLogsSnap.docs.map((ld: any) => ld.id));
    for (const lg of whatsappLogs) {
      const logId = sanitizeFsId(lg.id);
      if (existingLogIds.has(logId)) continue;
      const logRef = doc(db, 'workspaces', workspaceId, 'whatsappLogs', logId);
      const logPath = `workspaces/${workspaceId}/whatsappLogs/${logId}`;
      const createLog: Record<string, any> = {
        ownerId: workspaceId,
        id: logId,
        source: [
          'php_bridge',
          'php_webhook',
          'meta_direct',
          'outbound',
          'ai',
          'security',
          'verify',
          'handover'
        ].includes(lg.source)
          ? lg.source
          : 'meta_direct',
        level: ['info', 'warning', 'error'].includes(lg.level) ? lg.level : 'info',
        eventType: String(lg.eventType || 'event').slice(0, 80) || 'event',
        summary: String(lg.summary || 'Evento técnico').slice(0, 600) || 'Evento técnico',
        timestamp: String(lg.timestamp || new Date().toISOString()).slice(0, 64),
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      };
      if (lg.conversationId) createLog.conversationId = String(lg.conversationId).slice(0, 128);
      if (lg.phoneNumberId) createLog.phoneNumberId = String(lg.phoneNumberId).slice(0, 64);
      if (lg.wamid) createLog.wamid = String(lg.wamid).slice(0, 256);
      if (typeof lg.httpStatus === 'number' && lg.httpStatus >= 100 && lg.httpStatus <= 599) {
        createLog.httpStatus = Math.floor(lg.httpStatus);
      }
      ops.push({ kind: 'set', ref: logRef, path: logPath, data: createLog });
    }
  }

  // Commit atomically in a single writeBatch (chunked safely at 450 ops)
  const CHUNK_SIZE = 450;
  for (let i = 0; i < ops.length; i += CHUNK_SIZE) {
    const chunk = ops.slice(i, i + CHUNK_SIZE);
    const batch = writeBatch(db);
    for (const op of chunk) {
      if (op.kind === 'set') batch.set(op.ref, op.data);
      else if (op.kind === 'update') batch.update(op.ref, op.data);
      else batch.delete(op.ref);
    }
    try {
      await batch.commit();
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, chunk[0]?.path || `workspaces/${workspaceId}`);
    }
  }

  return { workspaceId, usersSynced, bucketsSynced };
}

export async function syncSnapshotToFirestore(snapshot: CloudSyncSnapshot): Promise<{
  workspaceId: string;
  usersSynced: number;
  bucketsSynced: number;
}> {
  const run = activeFirestoreSyncChain.then(() => executeAtomicFirestoreSync(snapshot));
  activeFirestoreSyncChain = run.then(
    () => undefined,
    () => undefined
  );
  return run;
}

export async function loadSnapshotFromFirestore(): Promise<CloudSyncSnapshot> {
  const user = auth.currentUser;
  if (!user || !user.emailVerified) {
    throw new Error('Autentique-se com sua conta Google verificada para restaurar do Firestore.');
  }

  const workspaceId = user.uid;
  const usersPath = `workspaces/${workspaceId}/users`;
  const bucketsPath = `workspaces/${workspaceId}/buckets`;

  let users: any[] = [];
  try {
    const usersSnap = await getDocs(
      query(collection(db, 'workspaces', workspaceId, 'users'), where('ownerId', '==', workspaceId))
    );
    users = usersSnap.docs.map((d) => d.data());
  } catch (err) {
    handleFirestoreError(err, OperationType.LIST, usersPath);
  }

  const buckets: Record<string, any[]> = {};
  try {
    const bucketsSnap = await getDocs(
      query(collection(db, 'workspaces', workspaceId, 'buckets'), where('ownerId', '==', workspaceId))
    );
    for (const d of bucketsSnap.docs) {
      const data = d.data();
      if (data?.bucketKey && Array.isArray(data.items)) {
        buckets[data.bucketKey] = data.items;
      }
    }
  } catch (err) {
    handleFirestoreError(err, OperationType.LIST, bucketsPath);
  }

  return { users, buckets };
}

// =========================================================================
// REAL-TIME WHATSAPP LISTENERS & DIRECT FIRESTORE MUTATIONS (PHP 20i + UI)
// =========================================================================

const WHATSAPP_STATUS_RANK: Record<string, number> = {
  sending: 0,
  sent: 1,
  delivered: 2,
  read: 3,
  failed: 4
};

export function sanitizeWhatsAppIdPart(raw: string): string {
  const cleaned = String(raw || '')
    .replace(/[^a-zA-Z0-9_-]/g, '_')
    .slice(0, 64);
  return cleaned || 'default';
}

export function normalizeWhatsAppPhone(rawPhone: string): string {
  let digits = String(rawPhone || '').replace(/\D/g, '');
  if (!digits) return '';
  if ((digits.length === 10 || digits.length === 11) && !digits.startsWith('55')) {
    digits = `55${digits}`;
  }
  // Canonicalize BR 12-digit mobile numbers (55 + DDD(2) + [6-9]xxxxxxx(8)) -> 13 digits with 9th digit
  if (/^55\d{2}[6-9]\d{7}$/.test(digits)) {
    digits = `${digits.slice(0, 4)}9${digits.slice(4)}`;
  }
  return digits;
}

export function whatsAppPhonesMatch(phoneA: string, phoneB: string): boolean {
  const a = normalizeWhatsAppPhone(phoneA);
  const b = normalizeWhatsAppPhone(phoneB);
  if (!a || !b) return false;
  if (a === b) return true;
  const rawA = String(phoneA || '').replace(/\D/g, '');
  const rawB = String(phoneB || '').replace(/\D/g, '');
  return Boolean(rawA && rawB && (rawA === rawB || a === rawB || b === rawA));
}

export function buildWhatsAppConversationKey(params: {
  workspaceId: string;
  phoneNumberId?: string;
  waId: string;
}): string {
  const ws = String(params.workspaceId || 'workspace').trim() || 'workspace';
  const pid = sanitizeWhatsAppIdPart(params.phoneNumberId || 'default');
  const wa = normalizeWhatsAppPhone(params.waId) || sanitizeWhatsAppIdPart(params.waId);
  return `${ws}:${pid}:${wa}`;
}

export function buildWhatsAppConversationId(params: {
  phoneNumberId?: string;
  waId: string;
}): string {
  const pid = sanitizeWhatsAppIdPart(params.phoneNumberId || 'default');
  const wa = normalizeWhatsAppPhone(params.waId) || sanitizeWhatsAppIdPart(params.waId);
  return `conv_${pid}_${wa}`.slice(0, 120);
}

function sanitizeWhatsAppFsId(raw: string): string {
  const cleaned = String(raw || '')
    .replace(/[^a-zA-Z0-9_-]/g, '_')
    .slice(0, 120);
  return cleaned || `id_${Date.now()}`;
}

function mapFirestoreConversationDoc(docId: string, data: Record<string, any>): WhatsAppConversation {
  const status: WhatsAppConversation['status'] =
    data.status === 'human_takeover' || data.status === 'resolved' ? data.status : 'ai_active';
  const contactPhone = normalizeWhatsAppPhone(String(data.contactPhone || '')) || String(data.contactPhone || '');
  const waId = data.waId ? normalizeWhatsAppPhone(String(data.waId)) || String(data.waId) : contactPhone;
  return {
    id: String(data.id || docId),
    contactPhone,
    waId: waId || undefined,
    phoneNumberId: data.phoneNumberId ? String(data.phoneNumberId) : undefined,
    conversationKey: data.conversationKey ? String(data.conversationKey) : undefined,
    contactName: String(data.contactName || `Contato +${contactPhone || ''}`),
    leadId: data.leadId ? String(data.leadId) : undefined,
    clientId: data.clientId ? String(data.clientId) : undefined,
    channel: 'meta_cloud',
    status,
    aiPaused: Boolean(data.aiPaused),
    lastMessage: String(data.lastMessage || ''),
    lastMessageTimestamp: String(data.lastMessageTimestamp || new Date().toISOString()),
    lastInboundAt: data.lastInboundAt ? String(data.lastInboundAt) : undefined,
    unreadCount: Math.max(0, Number(data.unreadCount) || 0),
    assignedAgent: String(data.assignedAgent || 'Atendente IA'),
    assignedUserId: data.assignedUserId ? String(data.assignedUserId) : undefined,
    closedAt: data.closedAt ? String(data.closedAt) : undefined,
    closedBy: data.closedBy ? String(data.closedBy) : undefined,
    tags: ['WhatsApp Cloud API', 'Firestore'],
    handoverHistory: [],
    messages: []
  };
}

function mapFirestoreMessageDoc(docId: string, data: Record<string, any>): ChatMessage {
  const sender: ChatMessage['sender'] =
    data.sender === 'contact' || data.sender === 'agent' ? data.sender : 'system';
  const status: ChatMessage['status'] = ['sending', 'sent', 'delivered', 'read', 'failed'].includes(
    data.status
  )
    ? data.status
    : 'sent';
  const direction: ChatMessage['direction'] =
    data.direction === 'inbound' || data.direction === 'outbound' || data.direction === 'system'
      ? data.direction
      : sender === 'contact'
      ? 'inbound'
      : sender === 'agent'
      ? 'outbound'
      : 'system';
  return {
    id: String(data.id || docId),
    sender,
    direction,
    senderName: data.senderName ? String(data.senderName) : undefined,
    text: String(data.text || ''),
    timestamp: String(data.timestamp || new Date().toISOString()),
    status,
    metaMessageId: data.metaMessageId ? String(data.metaMessageId) : undefined,
    phoneNumberId: data.phoneNumberId ? String(data.phoneNumberId) : undefined,
    waId: data.waId ? String(data.waId) : undefined,
    errorMessage: data.errorMessage ? String(data.errorMessage) : undefined,
    aiGenerated: Boolean(data.aiGenerated)
  };
}

function mapFirestoreHandoverDoc(docId: string, data: Record<string, any>): WhatsAppHandoverEntry {
  return {
    id: String(data.id || docId),
    action: (data.action || 'transferred') as WhatsAppHandoverEntry['action'],
    fromStatus: data.fromStatus ? String(data.fromStatus) : undefined,
    toStatus: String(data.toStatus || 'ai_active'),
    assignedTo: data.assignedTo ? String(data.assignedTo) : undefined,
    byUser: String(data.byUser || 'Sistema'),
    note: data.note ? String(data.note) : undefined,
    at: String(data.at || new Date().toISOString())
  };
}

export function subscribeWhatsAppConversationsFromFirestore(
  workspaceId: string,
  callbacks: {
    onConversations: (convs: WhatsAppConversation[]) => void;
    onError?: (err: Error) => void;
  }
): () => void {
  const path = `workspaces/${workspaceId}/whatsappConversations`;
  const q = query(collection(db, 'workspaces', workspaceId, 'whatsappConversations'), where('ownerId', '==', workspaceId));
  return onSnapshot(
    q,
    (snap) => {
      const convs = snap.docs
        .map((d) => mapFirestoreConversationDoc(d.id, d.data() || {}))
        .sort(
          (a, b) =>
            new Date(b.lastMessageTimestamp || 0).getTime() -
            new Date(a.lastMessageTimestamp || 0).getTime()
        );
      callbacks.onConversations(convs);
    },
    (error) => {
      try {
        handleFirestoreError(error, OperationType.LIST, path);
      } catch (wrapped: any) {
        callbacks.onError?.(wrapped);
      }
    }
  );
}

export function subscribeWhatsAppMessagesFromFirestore(
  workspaceId: string,
  conversationId: string,
  callbacks: {
    onMessages: (messages: ChatMessage[]) => void;
    onHandovers: (handovers: WhatsAppHandoverEntry[]) => void;
    onError?: (err: Error) => void;
  }
): () => void {
  const convId = sanitizeWhatsAppFsId(conversationId);
  const msgPath = `workspaces/${workspaceId}/whatsappConversations/${convId}/messages`;
  const hoPath = `workspaces/${workspaceId}/whatsappConversations/${convId}/handovers`;

  const msgQ = query(
    collection(db, 'workspaces', workspaceId, 'whatsappConversations', convId, 'messages'),
    where('ownerId', '==', workspaceId)
  );
  const hoQ = query(
    collection(db, 'workspaces', workspaceId, 'whatsappConversations', convId, 'handovers'),
    where('ownerId', '==', workspaceId)
  );

  const unsubMsgs = onSnapshot(
    msgQ,
    (snap) => {
      const msgs = snap.docs
        .map((d) => mapFirestoreMessageDoc(d.id, d.data() || {}))
        .sort((a, b) => new Date(a.timestamp || 0).getTime() - new Date(b.timestamp || 0).getTime());
      callbacks.onMessages(msgs);
    },
    (error) => {
      try {
        handleFirestoreError(error, OperationType.LIST, msgPath);
      } catch (wrapped: any) {
        callbacks.onError?.(wrapped);
      }
    }
  );

  const unsubHo = onSnapshot(
    hoQ,
    (snap) => {
      const hos = snap.docs
        .map((d) => mapFirestoreHandoverDoc(d.id, d.data() || {}))
        .sort((a, b) => new Date(a.at || 0).getTime() - new Date(b.at || 0).getTime());
      callbacks.onHandovers(hos);
    },
    (error) => {
      try {
        handleFirestoreError(error, OperationType.LIST, hoPath);
      } catch (wrapped: any) {
        callbacks.onError?.(wrapped);
      }
    }
  );

  return () => {
    unsubMsgs();
    unsubHo();
  };
}

export function subscribeWhatsAppLogsFromFirestore(
  workspaceId: string,
  callbacks: {
    onLogs: (logs: WhatsAppIntegrationLog[]) => void;
    onError?: (err: Error) => void;
  }
): () => void {
  const path = `workspaces/${workspaceId}/whatsappLogs`;
  const q = query(collection(db, 'workspaces', workspaceId, 'whatsappLogs'), where('ownerId', '==', workspaceId));
  return onSnapshot(
    q,
    (snap) => {
      const logs = snap.docs
        .map((d) => {
          const data = d.data() || {};
          return {
            id: String(data.id || d.id),
            timestamp: String(data.timestamp || new Date().toISOString()),
            source: (data.source || 'php_webhook') as WhatsAppIntegrationLog['source'],
            level: (data.level || 'info') as WhatsAppIntegrationLog['level'],
            eventType: String(data.eventType || 'event'),
            conversationId: data.conversationId ? String(data.conversationId) : undefined,
            phoneNumberId: data.phoneNumberId ? String(data.phoneNumberId) : undefined,
            wamid: data.wamid ? String(data.wamid) : undefined,
            summary: String(data.summary || ''),
            httpStatus: typeof data.httpStatus === 'number' ? data.httpStatus : undefined
          };
        })
        .sort((a, b) => new Date(b.timestamp || 0).getTime() - new Date(a.timestamp || 0).getTime())
        .slice(0, 100);
      callbacks.onLogs(logs);
    },
    (error) => {
      try {
        handleFirestoreError(error, OperationType.LIST, path);
      } catch (wrapped: any) {
        callbacks.onError?.(wrapped);
      }
    }
  );
}

export async function fetchWhatsAppMessagesOnceFromFirestore(
  workspaceId: string,
  conversationId: string
): Promise<{ messages: ChatMessage[]; handovers: WhatsAppHandoverEntry[] }> {
  const convId = sanitizeWhatsAppFsId(conversationId);
  const msgPath = `workspaces/${workspaceId}/whatsappConversations/${convId}/messages`;
  const hoPath = `workspaces/${workspaceId}/whatsappConversations/${convId}/handovers`;
  try {
    const [msgSnap, hoSnap] = await Promise.all([
      getDocs(
        query(
          collection(db, 'workspaces', workspaceId, 'whatsappConversations', convId, 'messages'),
          where('ownerId', '==', workspaceId)
        )
      ),
      getDocs(
        query(
          collection(db, 'workspaces', workspaceId, 'whatsappConversations', convId, 'handovers'),
          where('ownerId', '==', workspaceId)
        )
      )
    ]);
    return {
      messages: msgSnap.docs
        .map((d) => mapFirestoreMessageDoc(d.id, d.data() || {}))
        .sort((a, b) => new Date(a.timestamp || 0).getTime() - new Date(b.timestamp || 0).getTime()),
      handovers: hoSnap.docs
        .map((d) => mapFirestoreHandoverDoc(d.id, d.data() || {}))
        .sort((a, b) => new Date(a.at || 0).getTime() - new Date(b.at || 0).getTime())
    };
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, `${msgPath} | ${hoPath}`);
  }
}

export async function upsertWhatsAppConversationInFirestore(
  workspaceId: string,
  conv: WhatsAppConversation,
  extraMessage?: ChatMessage | null,
  extraHandover?: WhatsAppHandoverEntry | null
): Promise<void> {
  const user = auth.currentUser;
  if (!user || !user.emailVerified || user.uid !== workspaceId) return;

  const convId = sanitizeWhatsAppFsId(conv.id);
  const normPhone =
    (normalizeWhatsAppPhone(conv.waId || conv.contactPhone || '') ||
      String(conv.contactPhone || '').replace(/\D/g, '') ||
      convId).slice(0, 32);
  const waId = (normalizeWhatsAppPhone(conv.waId || normPhone) || normPhone).slice(0, 32);
  const effectivePid = sanitizeWhatsAppIdPart(conv.phoneNumberId || 'default');
  const convKey = conv.conversationKey
    ? String(conv.conversationKey).slice(0, 256)
    : buildWhatsAppConversationKey({ workspaceId, phoneNumberId: effectivePid, waId });
  const contactId = sanitizeWhatsAppFsId(normPhone);
  const contactName = String(conv.contactName || `Contato +${normPhone}`).trim().slice(0, 160) || 'Contato';

  const wsRef = doc(db, 'workspaces', workspaceId);
  const contactRef = doc(db, 'workspaces', workspaceId, 'whatsappContacts', contactId);
  const convRef = doc(db, 'workspaces', workspaceId, 'whatsappConversations', convId);
  const convPath = `workspaces/${workspaceId}/whatsappConversations/${convId}`;

  const extraMsgDocId = extraMessage
    ? sanitizeWhatsAppFsId(extraMessage.metaMessageId ? `wamid_${extraMessage.metaMessageId}` : extraMessage.id)
    : '';
  const extraMsgRef = extraMessage
    ? doc(db, 'workspaces', workspaceId, 'whatsappConversations', convId, 'messages', extraMsgDocId)
    : null;

  let wsSnap: any;
  let existingContactSnap: any;
  let existingConvSnap: any;
  let existingMsgSnap: any = null;
  try {
    [wsSnap, existingContactSnap, existingConvSnap, existingMsgSnap] = await Promise.all([
      getDoc(wsRef),
      getDoc(contactRef),
      getDoc(convRef),
      extraMsgRef ? getDoc(extraMsgRef) : Promise.resolve(null)
    ]);
  } catch (err) {
    handleFirestoreError(err, OperationType.GET, convPath);
  }

  if (!wsSnap?.exists?.()) {
    try {
      await setDoc(wsRef, {
        ownerId: workspaceId,
        name: 'FMWS SALES AI Workspace',
        userCount: 1,
        leadCount: 0,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      });
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, `workspaces/${workspaceId}`);
    }
  }

  const batch = writeBatch(db);

  if (existingContactSnap?.exists?.() && existingContactSnap.data()?.createdAt) {
    const contactUpdate: Record<string, any> = {
      name: contactName,
      updatedAt: serverTimestamp()
    };
    if (conv.leadId !== undefined) contactUpdate.leadId = String(conv.leadId || '').slice(0, 128);
    if (conv.clientId !== undefined) contactUpdate.clientId = String(conv.clientId || '').slice(0, 128);
    if (conv.lastInboundAt) contactUpdate.lastInboundAt = String(conv.lastInboundAt).slice(0, 64);
    batch.update(contactRef, contactUpdate);
  } else {
    const contactCreate: Record<string, any> = {
      ownerId: workspaceId,
      id: contactId,
      normalizedPhone: normPhone.padEnd(8, '0').slice(0, 32),
      name: contactName,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    };
    if (conv.leadId) contactCreate.leadId = String(conv.leadId).slice(0, 128);
    if (conv.clientId) contactCreate.clientId = String(conv.clientId).slice(0, 128);
    if (conv.lastInboundAt) contactCreate.lastInboundAt = String(conv.lastInboundAt).slice(0, 64);
    batch.set(contactRef, contactCreate);
  }

  const safeStatus = ['ai_active', 'human_takeover', 'resolved'].includes(conv.status)
    ? conv.status
    : 'ai_active';

  if (existingConvSnap?.exists?.() && existingConvSnap.data()?.createdAt) {
    const convUpdate: Record<string, any> = {
      contactPhone: normPhone.padEnd(8, '0').slice(0, 32),
      waId: waId.padEnd(8, '0').slice(0, 32),
      phoneNumberId: effectivePid,
      conversationKey: convKey,
      contactName,
      status: safeStatus,
      aiPaused: Boolean(conv.aiPaused),
      assignedAgent: String(conv.assignedAgent || 'Atendente IA').slice(0, 120) || 'Atendente IA',
      lastMessage: String(conv.lastMessage || '').slice(0, 2000),
      lastMessageTimestamp: String(conv.lastMessageTimestamp || new Date().toISOString()).slice(0, 64),
      unreadCount: Math.max(0, Math.min(10000, Math.floor(Number(conv.unreadCount) || 0))),
      updatedAt: serverTimestamp()
    };
    if (conv.leadId !== undefined) convUpdate.leadId = String(conv.leadId || '').slice(0, 128);
    if (conv.clientId !== undefined) convUpdate.clientId = String(conv.clientId || '').slice(0, 128);
    if (conv.assignedUserId !== undefined) convUpdate.assignedUserId = String(conv.assignedUserId || '').slice(0, 128);
    if (conv.lastInboundAt) convUpdate.lastInboundAt = String(conv.lastInboundAt).slice(0, 64);
    if (conv.closedAt !== undefined) convUpdate.closedAt = String(conv.closedAt || '').slice(0, 64);
    if (conv.closedBy !== undefined) convUpdate.closedBy = String(conv.closedBy || '').slice(0, 120);
    batch.update(convRef, convUpdate);
  } else {
    const convCreate: Record<string, any> = {
      ownerId: workspaceId,
      id: convId,
      contactId,
      contactPhone: normPhone.padEnd(8, '0').slice(0, 32),
      waId: waId.padEnd(8, '0').slice(0, 32),
      phoneNumberId: effectivePid,
      conversationKey: convKey,
      contactName,
      status: safeStatus,
      aiPaused: Boolean(conv.aiPaused),
      assignedAgent: String(conv.assignedAgent || 'Atendente IA').slice(0, 120) || 'Atendente IA',
      lastMessage: String(conv.lastMessage || '').slice(0, 2000),
      lastMessageTimestamp: String(conv.lastMessageTimestamp || new Date().toISOString()).slice(0, 64),
      unreadCount: Math.max(0, Math.min(10000, Math.floor(Number(conv.unreadCount) || 0))),
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    };
    if (conv.leadId) convCreate.leadId = String(conv.leadId).slice(0, 128);
    if (conv.clientId) convCreate.clientId = String(conv.clientId).slice(0, 128);
    if (conv.assignedUserId) convCreate.assignedUserId = String(conv.assignedUserId).slice(0, 128);
    if (conv.lastInboundAt) convCreate.lastInboundAt = String(conv.lastInboundAt).slice(0, 64);
    if (conv.closedAt) convCreate.closedAt = String(conv.closedAt).slice(0, 64);
    if (conv.closedBy) convCreate.closedBy = String(conv.closedBy).slice(0, 120);
    batch.set(convRef, convCreate);
  }

  if (extraMessage && extraMsgRef) {
    const msgStatus = ['sending', 'sent', 'delivered', 'read', 'failed'].includes(extraMessage.status || '')
      ? extraMessage.status!
      : 'sent';
    const safeSender: 'contact' | 'agent' | 'system' =
      extraMessage.sender === 'contact' || extraMessage.sender === 'agent' || extraMessage.sender === 'system'
        ? extraMessage.sender
        : 'agent';
    const safeDirection: 'inbound' | 'outbound' | 'system' =
      extraMessage.direction === 'inbound' || extraMessage.direction === 'outbound' || extraMessage.direction === 'system'
        ? extraMessage.direction
        : safeSender === 'contact'
        ? 'inbound'
        : safeSender === 'agent'
        ? 'outbound'
        : 'system';

    const existingMsgData = existingMsgSnap?.exists?.() ? existingMsgSnap.data() : null;
    if (existingMsgData && existingMsgData.createdAt) {
      const prevRank = WHATSAPP_STATUS_RANK[String(existingMsgData.status || 'sent')] ?? 1;
      const nextRank = WHATSAPP_STATUS_RANK[msgStatus] ?? 1;
      if (
        nextRank > prevRank ||
        (!existingMsgData.metaMessageId && extraMessage.metaMessageId) ||
        (!existingMsgData.direction && safeDirection) ||
        (extraMessage.errorMessage && existingMsgData.errorMessage !== String(extraMessage.errorMessage).slice(0, 1000))
      ) {
        const updateMsg: Record<string, any> = {
          status: nextRank >= prevRank ? msgStatus : existingMsgData.status,
          direction: safeDirection,
          phoneNumberId: String(extraMessage.phoneNumberId || effectivePid).slice(0, 64),
          waId: waId.slice(0, 32),
          updatedAt: serverTimestamp()
        };
        if (extraMessage.metaMessageId) updateMsg.metaMessageId = String(extraMessage.metaMessageId).slice(0, 256);
        if (extraMessage.errorMessage) updateMsg.errorMessage = String(extraMessage.errorMessage).slice(0, 1000);
        batch.update(extraMsgRef, updateMsg);
      }
    } else {
      const msgPayload: Record<string, any> = {
        ownerId: workspaceId,
        id: extraMsgDocId,
        conversationId: convId,
        sender: safeSender,
        direction: safeDirection,
        text: String(extraMessage.text || '[Mensagem]').slice(0, 4096) || '[Mensagem]',
        status: msgStatus,
        phoneNumberId: String(extraMessage.phoneNumberId || effectivePid).slice(0, 64),
        waId: waId.slice(0, 32),
        aiGenerated: Boolean(extraMessage.aiGenerated),
        timestamp: String(extraMessage.timestamp || new Date().toISOString()).slice(0, 64),
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      };
      if (extraMessage.senderName) msgPayload.senderName = String(extraMessage.senderName).slice(0, 160);
      if (extraMessage.metaMessageId) msgPayload.metaMessageId = String(extraMessage.metaMessageId).slice(0, 256);
      if (extraMessage.errorMessage) msgPayload.errorMessage = String(extraMessage.errorMessage).slice(0, 1000);
      batch.set(extraMsgRef, msgPayload);
    }
  }

  if (extraHandover) {
    const hoId = sanitizeWhatsAppFsId(extraHandover.id);
    const hoRef = doc(db, 'workspaces', workspaceId, 'whatsappConversations', convId, 'handovers', hoId);
    const hoPayload: Record<string, any> = {
      ownerId: workspaceId,
      id: hoId,
      conversationId: convId,
      action: String(extraHandover.action || 'transferred').slice(0, 48),
      toStatus: String(extraHandover.toStatus || safeStatus).slice(0, 48),
      byUser: String(extraHandover.byUser || 'Operador').slice(0, 120),
      at: String(extraHandover.at || new Date().toISOString()).slice(0, 64),
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    };
    if (extraHandover.fromStatus) hoPayload.fromStatus = String(extraHandover.fromStatus).slice(0, 48);
    if (extraHandover.assignedTo) hoPayload.assignedTo = String(extraHandover.assignedTo).slice(0, 120);
    if (extraHandover.note) hoPayload.note = String(extraHandover.note).slice(0, 500);
    batch.set(hoRef, hoPayload);
  }

  try {
    await batch.commit();
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, convPath);
  }
}

export async function deleteWhatsAppConversationInFirestore(
  workspaceId: string,
  conversationId: string
): Promise<void> {
  const user = auth.currentUser;
  if (!user || !user.emailVerified || user.uid !== workspaceId) return;

  const convId = sanitizeWhatsAppFsId(conversationId);
  const convPath = `workspaces/${workspaceId}/whatsappConversations/${convId}`;
  try {
    const [msgSnap, hoSnap] = await Promise.all([
      getDocs(
        query(
          collection(db, 'workspaces', workspaceId, 'whatsappConversations', convId, 'messages'),
          where('ownerId', '==', workspaceId)
        )
      ),
      getDocs(
        query(
          collection(db, 'workspaces', workspaceId, 'whatsappConversations', convId, 'handovers'),
          where('ownerId', '==', workspaceId)
        )
      )
    ]);

    const refs = [
      ...msgSnap.docs.map((d) => d.ref),
      ...hoSnap.docs.map((d) => d.ref),
      doc(db, 'workspaces', workspaceId, 'whatsappConversations', convId)
    ];

    for (let i = 0; i < refs.length; i += 400) {
      const batch = writeBatch(db);
      for (const r of refs.slice(i, i + 400)) {
        batch.delete(r);
      }
      await batch.commit();
    }
  } catch (error) {
    // Ignore missing doc deletes, surface permission errors cleanly
    const msg = error instanceof Error ? error.message : String(error);
    if (msg.includes('permission') || msg.includes('PERMISSION_DENIED')) {
      handleFirestoreError(error, OperationType.DELETE, convPath);
    }
  }
}

// =========================================================================
// SAFE DUPLICATE CONVERSATION DIAGNOSTICS & APPROVAL-GATED MERGE
// =========================================================================

export interface WhatsAppDuplicateThreadPreview {
  id: string;
  firestorePath: string;
  contactPhone: string;
  waId?: string;
  phoneNumberId?: string;
  conversationKey?: string;
  contactName: string;
  status: WhatsAppConversation['status'];
  aiPaused: boolean;
  assignedAgent: string;
  lastMessage: string;
  lastMessageTimestamp: string;
  inboundCount: number;
  outboundCount: number;
  aiCount: number;
  totalMessages: number;
  handoverCount: number;
  originHint: string;
}

export interface WhatsAppDuplicateGroupPreview {
  groupKey: string;
  conversationKey: string;
  normalizedPhone: string;
  phoneNumberId: string;
  targetConversationId: string;
  targetFirestorePath: string;
  contactName: string;
  totalMessagesBefore: number;
  mergedMessagesCount: number;
  deduplicatedCount: number;
  conversations: WhatsAppDuplicateThreadPreview[];
  sampleTimeline: Array<{
    id: string;
    sender: ChatMessage['sender'];
    direction: string;
    text: string;
    timestamp: string;
    status?: string;
    aiGenerated?: boolean;
    metaMessageId?: string;
  }>;
}

function deduplicateMessagesForUnifiedThread(messages: ChatMessage[]): ChatMessage[] {
  const byKey = new Map<string, ChatMessage>();

  const chooseWinner = (a: ChatMessage, b: ChatMessage): ChatMessage => {
    const rankA = WHATSAPP_STATUS_RANK[a.status || 'sent'] ?? 1;
    const rankB = WHATSAPP_STATUS_RANK[b.status || 'sent'] ?? 1;
    const winnerStatus = rankB > rankA ? b.status : a.status;
    return {
      ...a,
      ...b,
      id: a.metaMessageId ? sanitizeWhatsAppFsId(`wamid_${a.metaMessageId}`) : a.id,
      status: winnerStatus,
      metaMessageId: a.metaMessageId || b.metaMessageId,
      direction: a.direction || b.direction,
      phoneNumberId: b.phoneNumberId || a.phoneNumberId,
      waId: b.waId || a.waId,
      senderName: a.senderName || b.senderName,
      errorMessage: b.errorMessage || a.errorMessage,
      aiGenerated: Boolean(a.aiGenerated || b.aiGenerated)
    };
  };

  for (const raw of messages) {
    const m: ChatMessage = {
      ...raw,
      direction:
        raw.direction ||
        (raw.sender === 'contact' ? 'inbound' : raw.sender === 'agent' ? 'outbound' : 'system')
    };

    const metaKey = m.metaMessageId ? `wamid:${m.metaMessageId}` : '';
    const tsBucket = Math.floor((Date.parse(m.timestamp || '') || 0) / 2000);
    const contentKey = `cnt:${m.sender}:${m.direction}:${m.text.trim()}:${tsBucket}`;
    const idKey = `id:${m.id}`;

    let matchedKey: string | undefined;
    if (metaKey && byKey.has(metaKey)) {
      matchedKey = metaKey;
    } else if (byKey.has(idKey)) {
      matchedKey = idKey;
    } else if (byKey.has(contentKey)) {
      matchedKey = contentKey;
    }

    if (matchedKey) {
      const existing = byKey.get(matchedKey)!;
      const merged = chooseWinner(existing, m);
      byKey.delete(matchedKey);
      const canonicalKey = merged.metaMessageId ? `wamid:${merged.metaMessageId}` : `id:${merged.id}`;
      byKey.set(canonicalKey, merged);
    } else {
      const canonicalKey = metaKey || idKey;
      byKey.set(canonicalKey, m);
    }
  }

  return Array.from(byKey.values()).sort(
    (a, b) => new Date(a.timestamp || 0).getTime() - new Date(b.timestamp || 0).getTime()
  );
}

/**
 * Varredura SOMENTE-LEITURA no Firestore para detectar conversas duplicadas por (workspaceId + phoneNumberId + wa_id normalizado).
 * Não altera nem apaga nenhum documento.
 */
export async function scanDuplicateWhatsAppConversationsInFirestore(
  workspaceId: string,
  defaultPhoneNumberId?: string
): Promise<WhatsAppDuplicateGroupPreview[]> {
  const user = auth.currentUser;
  if (!user || !user.emailVerified || user.uid !== workspaceId) {
    throw new Error('Autentique-se com sua conta Google verificada para inspecionar duplicatas.');
  }

  const fallbackPid = sanitizeWhatsAppIdPart(defaultPhoneNumberId || 'default');
  const convsSnap = await getDocs(
    query(collection(db, 'workspaces', workspaceId, 'whatsappConversations'), where('ownerId', '==', workspaceId))
  );

  interface EnrichedConv {
    conv: WhatsAppConversation;
    messages: ChatMessage[];
    handovers: WhatsAppHandoverEntry[];
    resolvedPid: string;
    resolvedWaId: string;
  }

  const enriched: EnrichedConv[] = await Promise.all(
    convsSnap.docs.map(async (d) => {
      const data = d.data() || {};
      const conv = mapFirestoreConversationDoc(d.id, data);
      const sub = await fetchWhatsAppMessagesOnceFromFirestore(workspaceId, d.id);
      const rawPid = data.phoneNumberId ? String(data.phoneNumberId).trim() : '';
      const resolvedPid =
        rawPid && rawPid !== 'default' ? sanitizeWhatsAppIdPart(rawPid) : fallbackPid;
      const resolvedWaId =
        normalizeWhatsAppPhone(String(data.waId || conv.contactPhone || '')) || conv.contactPhone || d.id;
      return {
        conv,
        messages: sub.messages,
        handovers: sub.handovers,
        resolvedPid,
        resolvedWaId
      };
    })
  );

  const grouped = new Map<string, EnrichedConv[]>();
  for (const item of enriched) {
    const key = buildWhatsAppConversationKey({
      workspaceId,
      phoneNumberId: item.resolvedPid,
      waId: item.resolvedWaId
    });
    const list = grouped.get(key) || [];
    list.push(item);
    grouped.set(key, list);
  }

  const previews: WhatsAppDuplicateGroupPreview[] = [];
  for (const [groupKey, items] of grouped.entries()) {
    if (items.length <= 1) continue;

    const first = items[0];
    const targetId = buildWhatsAppConversationId({
      phoneNumberId: first.resolvedPid,
      waId: first.resolvedWaId
    });
    const bestName =
      items.find((i) => i.conv.contactName && !i.conv.contactName.startsWith('Contato +'))?.conv.contactName ||
      first.conv.contactName;

    const allMsgs = items.flatMap((i) => i.messages);
    const dedupedMsgs = deduplicateMessagesForUnifiedThread(allMsgs);

    const threads: WhatsAppDuplicateThreadPreview[] = items.map((item) => {
      const inboundCount = item.messages.filter((m) => m.sender === 'contact').length;
      const outboundCount = item.messages.filter((m) => m.sender === 'agent').length;
      const aiCount = item.messages.filter((m) => m.aiGenerated).length;
      const isPhpOrigin =
        item.conv.id === `conv_${item.conv.contactPhone}` ||
        item.conv.id === targetId ||
        item.handovers.some((h) => String(h.byUser || '').includes('PHP'));
      const originHint = isPhpOrigin
        ? 'Webhook PHP 20i / Determinístico'
        : /^conv_\d{12,14}$/.test(item.conv.id)
        ? 'CRM Legado (Timestamp)'
        : 'CRM / Atendimento';

      return {
        id: item.conv.id,
        firestorePath: `workspaces/${workspaceId}/whatsappConversations/${item.conv.id}`,
        contactPhone: item.conv.contactPhone,
        waId: item.conv.waId,
        phoneNumberId: item.conv.phoneNumberId,
        conversationKey: item.conv.conversationKey,
        contactName: item.conv.contactName,
        status: item.conv.status,
        aiPaused: Boolean(item.conv.aiPaused),
        assignedAgent: item.conv.assignedAgent,
        lastMessage: item.conv.lastMessage,
        lastMessageTimestamp: item.conv.lastMessageTimestamp,
        inboundCount,
        outboundCount,
        aiCount,
        totalMessages: item.messages.length,
        handoverCount: item.handovers.length,
        originHint
      };
    });

    previews.push({
      groupKey,
      conversationKey: groupKey,
      normalizedPhone: first.resolvedWaId,
      phoneNumberId: first.resolvedPid,
      targetConversationId: targetId,
      targetFirestorePath: `workspaces/${workspaceId}/whatsappConversations/${targetId}`,
      contactName: bestName,
      totalMessagesBefore: allMsgs.length,
      mergedMessagesCount: dedupedMsgs.length,
      deduplicatedCount: Math.max(0, allMsgs.length - dedupedMsgs.length),
      conversations: threads,
      sampleTimeline: dedupedMsgs.slice(-12).map((m) => ({
        id: m.id,
        sender: m.sender,
        direction: m.direction || (m.sender === 'contact' ? 'inbound' : 'outbound'),
        text: m.text,
        timestamp: m.timestamp,
        status: m.status,
        aiGenerated: m.aiGenerated,
        metaMessageId: m.metaMessageId
      }))
    });
  }

  return previews;
}

/**
 * Unifica um grupo de conversas duplicadas SOMENTE após aprovação explícita do operador.
 * Preserva todas as mensagens, horários, IDs da Meta (wamid), handovers e vínculos,
 * grava o documento unificado no ID determinístico e somente então remove as duplicatas antigas.
 */
export async function mergeDuplicateWhatsAppGroupInFirestore(
  workspaceId: string,
  group: WhatsAppDuplicateGroupPreview,
  approvedBy: string
): Promise<{ mergedConversation: WhatsAppConversation; removedIds: string[] }> {
  const user = auth.currentUser;
  if (!user || !user.emailVerified || user.uid !== workspaceId) {
    throw new Error('Autentique-se com sua conta Google verificada para unificar conversas.');
  }

  const targetId = sanitizeWhatsAppFsId(group.targetConversationId);
  const waId = normalizeWhatsAppPhone(group.normalizedPhone).slice(0, 32);
  const effectivePid = sanitizeWhatsAppIdPart(group.phoneNumberId || 'default');
  const convKey = buildWhatsAppConversationKey({ workspaceId, phoneNumberId: effectivePid, waId });
  const contactId = sanitizeWhatsAppFsId(waId);

  const sourceIds = Array.from(new Set(group.conversations.map((c) => sanitizeWhatsAppFsId(c.id))));
  const sourceDocs = await Promise.all(
    sourceIds.map(async (cid) => {
      const cRef = doc(db, 'workspaces', workspaceId, 'whatsappConversations', cid);
      const [cSnap, sub] = await Promise.all([
        getDoc(cRef),
        fetchWhatsAppMessagesOnceFromFirestore(workspaceId, cid)
      ]);
      if (!cSnap.exists()) return null;
      return {
        id: cid,
        conv: mapFirestoreConversationDoc(cid, cSnap.data() || {}),
        messages: sub.messages,
        handovers: sub.handovers
      };
    })
  );

  const validSources = sourceDocs.filter((s): s is NonNullable<typeof s> => Boolean(s));
  if (validSources.length === 0) {
    throw new Error('Nenhuma conversa encontrada no Firestore para o grupo selecionado.');
  }

  const sortedByRecency = [...validSources].sort(
    (a, b) =>
      new Date(b.conv.lastMessageTimestamp || 0).getTime() -
      new Date(a.conv.lastMessageTimestamp || 0).getTime()
  );
  const freshest = sortedByRecency[0];
  const mergedMessages = deduplicateMessagesForUnifiedThread(validSources.flatMap((s) => s.messages));
  const lastMsg = mergedMessages[mergedMessages.length - 1];

  const hoMap = new Map<string, WhatsAppHandoverEntry>();
  for (const src of validSources) {
    for (const h of src.handovers) {
      hoMap.set(h.id, h);
    }
  }
  const mergeHoId = `ho_merge_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
  const nowIso = new Date().toISOString();
  const auditHo: WhatsAppHandoverEntry = {
    id: mergeHoId,
    action: 'merged_duplicate',
    fromStatus: freshest.conv.status,
    toStatus: freshest.conv.status,
    assignedTo: freshest.conv.assignedAgent,
    byUser: approvedBy || 'Operador CRM',
    note: `Conversas unificadas (${sourceIds.join(', ')} -> ${targetId}) com ${mergedMessages.length} mensagens.`,
    at: nowIso
  };
  hoMap.set(mergeHoId, auditHo);
  const mergedHandovers = Array.from(hoMap.values()).sort(
    (a, b) => new Date(a.at || 0).getTime() - new Date(b.at || 0).getTime()
  );

  const bestName =
    validSources.find((s) => s.conv.contactName && !s.conv.contactName.startsWith('Contato +'))?.conv.contactName ||
    freshest.conv.contactName;
  const leadId = validSources.find((s) => s.conv.leadId)?.conv.leadId;
  const clientId = validSources.find((s) => s.conv.clientId)?.conv.clientId;
  const assignedUserId = validSources.find((s) => s.conv.assignedUserId)?.conv.assignedUserId;
  const lastInboundTs = validSources
    .map((s) => s.conv.lastInboundAt)
    .filter(Boolean)
    .sort((a, b) => new Date(b || 0).getTime() - new Date(a || 0).getTime())[0];

  const totalUnread = Math.min(
    10000,
    validSources.reduce((acc, s) => acc + Math.max(0, Number(s.conv.unreadCount) || 0), 0)
  );

  const unifiedConv: WhatsAppConversation = {
    id: targetId,
    contactPhone: waId,
    waId,
    phoneNumberId: effectivePid,
    conversationKey: convKey,
    contactName: bestName,
    ...(leadId ? { leadId } : {}),
    ...(clientId ? { clientId } : {}),
    channel: 'meta_cloud',
    status: freshest.conv.status,
    aiPaused: freshest.conv.aiPaused,
    lastMessage: lastMsg?.text || freshest.conv.lastMessage || '',
    lastMessageTimestamp: lastMsg?.timestamp || freshest.conv.lastMessageTimestamp || nowIso,
    ...(lastInboundTs ? { lastInboundAt: lastInboundTs } : {}),
    unreadCount: totalUnread,
    assignedAgent: freshest.conv.assignedAgent || 'Atendente IA',
    ...(assignedUserId ? { assignedUserId } : {}),
    ...(freshest.conv.closedAt ? { closedAt: freshest.conv.closedAt } : {}),
    ...(freshest.conv.closedBy ? { closedBy: freshest.conv.closedBy } : {}),
    tags: ['WhatsApp Cloud API', 'Firestore'],
    handoverHistory: mergedHandovers,
    messages: mergedMessages
  };

  // Garantir contato + conversa alvo primeiro em batch próprio (para cumprir hasParentConversation nas subcoleções)
  const contactRef = doc(db, 'workspaces', workspaceId, 'whatsappContacts', contactId);
  const targetConvRef = doc(db, 'workspaces', workspaceId, 'whatsappConversations', targetId);
  const [contactSnap, targetConvSnap, existingTargetMsgsSnap, existingTargetHoSnap] = await Promise.all([
    getDoc(contactRef),
    getDoc(targetConvRef),
    getDocs(
      query(
        collection(db, 'workspaces', workspaceId, 'whatsappConversations', targetId, 'messages'),
        where('ownerId', '==', workspaceId)
      )
    ),
    getDocs(
      query(
        collection(db, 'workspaces', workspaceId, 'whatsappConversations', targetId, 'handovers'),
        where('ownerId', '==', workspaceId)
      )
    )
  ]);

  const headerBatch = writeBatch(db);
  if (contactSnap.exists() && contactSnap.data()?.createdAt) {
    const updContact: Record<string, any> = {
      name: bestName.slice(0, 160),
      updatedAt: serverTimestamp()
    };
    if (leadId) updContact.leadId = leadId.slice(0, 128);
    if (clientId) updContact.clientId = clientId.slice(0, 128);
    if (lastInboundTs) updContact.lastInboundAt = lastInboundTs.slice(0, 64);
    headerBatch.update(contactRef, updContact);
  } else {
    headerBatch.set(contactRef, {
      ownerId: workspaceId,
      id: contactId,
      normalizedPhone: waId.padEnd(8, '0').slice(0, 32),
      name: bestName.slice(0, 160),
      ...(leadId ? { leadId: leadId.slice(0, 128) } : {}),
      ...(clientId ? { clientId: clientId.slice(0, 128) } : {}),
      ...(lastInboundTs ? { lastInboundAt: lastInboundTs.slice(0, 64) } : {}),
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    });
  }

  if (targetConvSnap.exists() && targetConvSnap.data()?.createdAt) {
    const updConv: Record<string, any> = {
      contactPhone: waId.padEnd(8, '0').slice(0, 32),
      waId: waId.padEnd(8, '0').slice(0, 32),
      phoneNumberId: effectivePid,
      conversationKey: convKey,
      contactName: bestName.slice(0, 160),
      status: unifiedConv.status,
      aiPaused: Boolean(unifiedConv.aiPaused),
      assignedAgent: String(unifiedConv.assignedAgent || 'Atendente IA').slice(0, 120),
      lastMessage: String(unifiedConv.lastMessage || '').slice(0, 2000),
      lastMessageTimestamp: String(unifiedConv.lastMessageTimestamp || nowIso).slice(0, 64),
      unreadCount: totalUnread,
      updatedAt: serverTimestamp()
    };
    if (leadId) updConv.leadId = leadId.slice(0, 128);
    if (clientId) updConv.clientId = clientId.slice(0, 128);
    if (assignedUserId) updConv.assignedUserId = assignedUserId.slice(0, 128);
    if (lastInboundTs) updConv.lastInboundAt = lastInboundTs.slice(0, 64);
    headerBatch.update(targetConvRef, updConv);
  } else {
    headerBatch.set(targetConvRef, {
      ownerId: workspaceId,
      id: targetId,
      contactId,
      contactPhone: waId.padEnd(8, '0').slice(0, 32),
      waId: waId.padEnd(8, '0').slice(0, 32),
      phoneNumberId: effectivePid,
      conversationKey: convKey,
      contactName: bestName.slice(0, 160),
      status: unifiedConv.status,
      aiPaused: Boolean(unifiedConv.aiPaused),
      assignedAgent: String(unifiedConv.assignedAgent || 'Atendente IA').slice(0, 120),
      lastMessage: String(unifiedConv.lastMessage || '').slice(0, 2000),
      lastMessageTimestamp: String(unifiedConv.lastMessageTimestamp || nowIso).slice(0, 64),
      unreadCount: totalUnread,
      ...(leadId ? { leadId: leadId.slice(0, 128) } : {}),
      ...(clientId ? { clientId: clientId.slice(0, 128) } : {}),
      ...(assignedUserId ? { assignedUserId: assignedUserId.slice(0, 128) } : {}),
      ...(lastInboundTs ? { lastInboundAt: lastInboundTs.slice(0, 64) } : {}),
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    });
  }
  await headerBatch.commit();

  // Gravar todas mensagens e handovers deduplicados na conversa alvo
  const existingTargetMsgsMap = new Map<string, Record<string, any>>();
  for (const d of existingTargetMsgsSnap.docs) {
    existingTargetMsgsMap.set(d.id, d.data() || {});
  }
  const existingTargetHoIds = new Set<string>(existingTargetHoSnap.docs.map((d) => d.id));

  type SubOp = { kind: 'set' | 'update'; ref: any; data: Record<string, any> };
  const subOps: SubOp[] = [];

  for (const m of mergedMessages) {
    const msgDocId = sanitizeWhatsAppFsId(m.metaMessageId ? `wamid_${m.metaMessageId}` : m.id);
    const msgRef = doc(db, 'workspaces', workspaceId, 'whatsappConversations', targetId, 'messages', msgDocId);
    const msgStatus = ['sending', 'sent', 'delivered', 'read', 'failed'].includes(m.status || '')
      ? m.status!
      : 'sent';
    const existing = existingTargetMsgsMap.get(msgDocId);
    if (existing && existing.createdAt) {
      const prevRank = WHATSAPP_STATUS_RANK[String(existing.status || 'sent')] ?? 1;
      const nextRank = WHATSAPP_STATUS_RANK[msgStatus] ?? 1;
      if (nextRank > prevRank || (!existing.metaMessageId && m.metaMessageId) || (!existing.direction && m.direction)) {
        const updMsg: Record<string, any> = {
          status: nextRank >= prevRank ? msgStatus : existing.status,
          direction: m.direction || (m.sender === 'contact' ? 'inbound' : m.sender === 'agent' ? 'outbound' : 'system'),
          phoneNumberId: String(m.phoneNumberId || effectivePid).slice(0, 64),
          waId: waId.slice(0, 32),
          updatedAt: serverTimestamp()
        };
        if (m.metaMessageId) updMsg.metaMessageId = String(m.metaMessageId).slice(0, 256);
        if (m.errorMessage) updMsg.errorMessage = String(m.errorMessage).slice(0, 1000);
        subOps.push({ kind: 'update', ref: msgRef, data: updMsg });
      }
    } else {
      const createMsg: Record<string, any> = {
        ownerId: workspaceId,
        id: msgDocId,
        conversationId: targetId,
        sender: m.sender,
        direction: m.direction || (m.sender === 'contact' ? 'inbound' : m.sender === 'agent' ? 'outbound' : 'system'),
        text: String(m.text || '[Mensagem]').slice(0, 4096) || '[Mensagem]',
        status: msgStatus,
        phoneNumberId: String(m.phoneNumberId || effectivePid).slice(0, 64),
        waId: waId.slice(0, 32),
        aiGenerated: Boolean(m.aiGenerated),
        timestamp: String(m.timestamp || nowIso).slice(0, 64),
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      };
      if (m.senderName) createMsg.senderName = String(m.senderName).slice(0, 160);
      if (m.metaMessageId) createMsg.metaMessageId = String(m.metaMessageId).slice(0, 256);
      if (m.errorMessage) createMsg.errorMessage = String(m.errorMessage).slice(0, 1000);
      subOps.push({ kind: 'set', ref: msgRef, data: createMsg });
    }
  }

  for (const ho of mergedHandovers) {
    const hoId = sanitizeWhatsAppFsId(ho.id);
    if (existingTargetHoIds.has(hoId)) continue;
    const hoRef = doc(db, 'workspaces', workspaceId, 'whatsappConversations', targetId, 'handovers', hoId);
    const createHo: Record<string, any> = {
      ownerId: workspaceId,
      id: hoId,
      conversationId: targetId,
      action: String(ho.action || 'transferred').slice(0, 48),
      toStatus: String(ho.toStatus || unifiedConv.status).slice(0, 48),
      byUser: String(ho.byUser || 'Operador').slice(0, 120),
      at: String(ho.at || nowIso).slice(0, 64),
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    };
    if (ho.fromStatus) createHo.fromStatus = String(ho.fromStatus).slice(0, 48);
    if (ho.assignedTo) createHo.assignedTo = String(ho.assignedTo).slice(0, 120);
    if (ho.note) createHo.note = String(ho.note).slice(0, 500);
    subOps.push({ kind: 'set', ref: hoRef, data: createHo });
  }

  for (let i = 0; i < subOps.length; i += 400) {
    const b = writeBatch(db);
    for (const op of subOps.slice(i, i + 400)) {
      if (op.kind === 'set') b.set(op.ref, op.data);
      else b.update(op.ref, op.data);
    }
    await b.commit();
  }

  // Somente após confirmar persistência na conversa alvo, remover os documentos duplicados antigos
  const removedIds = sourceIds.filter((id) => id !== targetId);
  for (const oldId of removedIds) {
    await deleteWhatsAppConversationInFirestore(workspaceId, oldId);
  }

  return { mergedConversation: unifiedConv, removedIds };
}
