# Firestore Security Rules Specification (FMWS SALES AI)

## 1. Data Invariants
1. Every document under `/workspaces/{workspaceId}` MUST have `ownerId == workspaceId == request.auth.uid`.
2. Users must have `request.auth != null && request.auth.token.email_verified == true`.
3. Subcollection documents under `/workspaces/{workspaceId}` (`users`, `buckets`, `whatsappContacts`, `whatsappConversations`, `messages`, `handovers`, `whatsappLogs`) cannot exist without an existing parent `/workspaces/{workspaceId}` (and parent conversation for `messages`/`handovers`) owned by `request.auth.uid`, validated via `get()` on create/update.
4. `ownerId` and `createdAt` are immutable after creation; `createdAt == request.time` on create and `updatedAt == request.time` on update.
5. All IDs match `^[a-zA-Z0-9_\-]+$` and length `<= 128`. All strings and lists enforce explicit upper bounds.
6. Only `allowedKeys` and explicit `affectedKeys().hasOnly(...)` action allowlists are accepted on write.
7. Integration tokens/secrets (`accessToken`, `appSecret`, `webhookVerifyToken`, `bridgeSecret`) MUST NEVER be stored in Firestore documents readable by browser users.

## 2. Dirty Dozen Payloads (Must Return PERMISSION_DENIED)
1. Unauthenticated read/write to `/workspaces/uid1` or `/workspaces/uid1/whatsappConversations/conv_1`.
2. Signed-in user with `email_verified: false` attempting to create/read `/workspaces/uid1/whatsappContacts/5511999999999`.
3. Signed-in user `uid2` attempting to read/write `/workspaces/uid1/whatsappConversations/conv_1/messages/msg_1`.
4. Shadow update adding `{ extraAdmin: true }` or `{ accessToken: "secret" }` to `/workspaces/uid1/whatsappLogs/log_1`.
5. Poisoned oversized ID (>128 chars or `/` characters) on `/workspaces/uid1/whatsappContacts/{id}`.
6. Creating `WhatsAppConversationDoc` with invalid status (`status: "bypassed"`).
7. Creating `WhatsAppMessageDoc` with `text` > 4096 chars or invalid `sender` (`sender: "hacker"`).
8. Updating `WhatsAppConversationDoc` and mutating `ownerId`, `id`, or `createdAt`.
9. Client-forged timestamp (`updatedAt: "2020-01-01T00:00:00Z"`) instead of `request.time`.
10. Blanket list query on `/workspaces/{wid}/whatsappContacts` where `resource.data.ownerId != request.auth.uid`.
11. Creating `WorkspaceStateBucket` with disallowed `bucketKey: "arbitrary"`.
12. Creating `WhatsAppMessageDoc` without an existing parent `WhatsAppConversationDoc` (`get()` check fails) or deleting/writing `/test/connection`.
