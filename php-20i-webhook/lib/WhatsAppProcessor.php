<?php
declare(strict_types=1);

if (!defined('FMWS_WEBHOOK_BOOT')) {
    http_response_code(403);
    exit('Forbidden');
}

/**
 * Orquestrador principal do webhook Meta Cloud API em hospedagem 20i:
 * - Processa mensagens recebidas e atualizações de status (sent/delivered/read/failed)
 * - Executa deduplicação em disco + Firestore (idempotente)
 * - Respeita aiPaused, human_takeover, janela de 24h e rate limits
 * - Revalida estado no Firestore após chamar Gemini antes de enviar
 * - Grava conversas, mensagens, handovers e logs sanitizados diretamente no Firestore
 */
final class WhatsAppProcessor
{
    private QueueAndStorage $storage;
    private FirestoreRestClient $firestore;
    private MetaCloudClient $meta;
    private GeminiClient|AIProviderRouter $aiClient;
    private string $workspaceId;

    public function __construct(
        QueueAndStorage $storage,
        FirestoreRestClient $firestore,
        MetaCloudClient $meta,
        GeminiClient|AIProviderRouter $aiClient,
        string $workspaceId
    ) {
        $this->storage = $storage;
        $this->firestore = $firestore;
        $this->meta = $meta;
        $this->aiClient = $aiClient;
        $this->workspaceId = trim($workspaceId);
    }

    private function wsPath(string $subPath = ''): string
    {
        $base = 'workspaces/' . rawurlencode($this->workspaceId);
        return $subPath !== '' ? ($base . '/' . ltrim($subPath, '/')) : $base;
    }

    private function ensureWorkspaceExists(): void
    {
        $nowTs = FirestoreRestClient::timestamp();
        $this->firestore->createDocumentIfAbsent($this->wsPath(), [
            'ownerId' => $this->workspaceId,
            'name' => 'FMWS SALES AI Workspace',
            'userCount' => 1,
            'leadCount' => 0,
            'createdAt' => $nowTs,
            'updatedAt' => $nowTs
        ]);
    }

    private static function isCompatiblePhoneNumberId(array $convData, string $effectivePid): bool
    {
        $storedPid = trim((string)($convData['phoneNumberId'] ?? ''));
        if ($storedPid === '' || $storedPid === 'default' || $effectivePid === '' || $effectivePid === 'default') {
            return true;
        }
        return QueueAndStorage::sanitizeIdPart($storedPid) === QueueAndStorage::sanitizeIdPart($effectivePid);
    }

    /**
     * Localiza conversa existente no Firestore considerando:
     * 1) Cache local com escopo de Phone Number ID
     * 2) ID determinístico conv_{phoneNumberId}_{waId}
     * 3) Campo conversationKey ({workspaceId}:{phoneNumberId}:{waId})
     * 4) Fallback legado (conv_{waId} e busca por contactPhone/waId compatível com Phone Number ID)
     * @return array{convId: string, data: array}|null
     */
    private function findConversationInFirestore(string $rawPhone, string $phoneNumberId = 'default'): ?array
    {
        $effectivePid = QueueAndStorage::sanitizeIdPart($phoneNumberId !== '' ? $phoneNumberId : 'default');
        $normPhone = QueueAndStorage::normalizePhone($rawPhone);

        // 1) Cache local rápido com escopo por phoneNumberId
        $cachedId = $this->storage->getCachedConversationId($rawPhone, $effectivePid);
        if ($cachedId !== null) {
            $doc = $this->firestore->getDocument($this->wsPath('whatsappConversations/' . rawurlencode($cachedId)));
            if (is_array($doc) && self::isCompatiblePhoneNumberId($doc, $effectivePid)) {
                return ['convId' => $cachedId, 'data' => $doc];
            }
        }

        if ($normPhone !== '') {
            // 2) ID determinístico conv_{phoneNumberId}_{waId}
            $detId = QueueAndStorage::buildConversationId($effectivePid, $normPhone);
            $detDoc = $this->firestore->getDocument($this->wsPath('whatsappConversations/' . rawurlencode($detId)));
            if (is_array($detDoc)) {
                $this->storage->savePhoneConversationMapping($normPhone, $detId, $effectivePid);
                return ['convId' => $detId, 'data' => $detDoc];
            }

            // 3) Consulta por conversationKey determinística
            $convKey = QueueAndStorage::buildConversationKey($this->workspaceId, $effectivePid, $normPhone);
            $keyMatches = $this->firestore->queryCollectionEquals(
                $this->wsPath(),
                'whatsappConversations',
                'conversationKey',
                $convKey,
                5
            );
            if (!empty($keyMatches[0])) {
                $convId = $keyMatches[0]['docId'];
                $this->storage->savePhoneConversationMapping($normPhone, $convId, $effectivePid);
                return ['convId' => $convId, 'data' => $keyMatches[0]['data']];
            }

            // 4a) Fallback legado PHP: conv_{normPhone}
            $legacyPhpId = 'conv_' . QueueAndStorage::sanitizeId($normPhone);
            if ($legacyPhpId !== $detId) {
                $legacyDoc = $this->firestore->getDocument($this->wsPath('whatsappConversations/' . rawurlencode($legacyPhpId)));
                if (is_array($legacyDoc) && self::isCompatiblePhoneNumberId($legacyDoc, $effectivePid)) {
                    $this->storage->savePhoneConversationMapping($normPhone, $legacyPhpId, $effectivePid);
                    return ['convId' => $legacyPhpId, 'data' => $legacyDoc];
                }
            }
        }

        // 4b) Consulta por waId ou contactPhone (variantes BR) para reutilizar conversas antigas (ex: conv_1794559048031)
        foreach (QueueAndStorage::getPhoneVariants($rawPhone) as $variant) {
            foreach (['waId', 'contactPhone'] as $fieldName) {
                $matches = $this->firestore->queryCollectionEquals(
                    $this->wsPath(),
                    'whatsappConversations',
                    $fieldName,
                    $variant,
                    10
                );
                foreach ($matches as $m) {
                    if (is_array($m['data'] ?? null) && self::isCompatiblePhoneNumberId($m['data'], $effectivePid)) {
                        $convId = $m['docId'];
                        $this->storage->savePhoneConversationMapping($normPhone ?: $variant, $convId, $effectivePid);
                        return ['convId' => $convId, 'data' => $m['data']];
                    }
                }
            }
        }

        return null;
    }

    private function upsertContactInFirestore(string $normPhone, string $contactName, string $inboundIso): string
    {
        $contactId = QueueAndStorage::sanitizeId($normPhone);
        $paddedPhone = substr(str_pad($normPhone, 8, '0'), 0, 32);
        $safeName = mb_substr(trim($contactName) !== '' ? trim($contactName) : ('Contato +' . $normPhone), 0, 160);
        $contactPath = $this->wsPath('whatsappContacts/' . rawurlencode($contactId));
        $nowTs = FirestoreRestClient::timestamp();

        $created = $this->firestore->createDocumentIfAbsent($contactPath, [
            'ownerId' => $this->workspaceId,
            'id' => $contactId,
            'normalizedPhone' => $paddedPhone,
            'name' => $safeName,
            'lastInboundAt' => $inboundIso,
            'createdAt' => $nowTs,
            'updatedAt' => $nowTs
        ]);

        if ($created === null) {
            $this->firestore->patchDocument(
                $contactPath,
                [
                    'name' => $safeName,
                    'lastInboundAt' => $inboundIso,
                    'updatedAt' => $nowTs
                ],
                ['name', 'lastInboundAt', 'updatedAt']
            );
        }

        return $contactId;
    }

    private function recordFirestoreLog(
        string $source,
        string $level,
        string $eventType,
        string $summary,
        ?string $conversationId = null,
        ?string $phoneNumberId = null,
        ?string $wamid = null,
        ?int $httpStatus = null
    ): void {
        try {
            $logId = 'walog_php_' . time() . '_' . bin2hex(random_bytes(3));
            $nowIso = gmdate('c');
            $nowTs = FirestoreRestClient::timestamp();

            $payload = [
                'ownerId' => $this->workspaceId,
                'id' => $logId,
                'source' => in_array($source, ['php_webhook', 'ai', 'outbound', 'security', 'verify', 'handover'], true)
                    ? $source
                    : 'php_webhook',
                'level' => in_array($level, ['info', 'warning', 'error'], true) ? $level : 'info',
                'eventType' => mb_substr($eventType, 0, 80),
                'summary' => QueueAndStorage::maskText($summary, 600),
                'timestamp' => $nowIso,
                'createdAt' => $nowTs,
                'updatedAt' => $nowTs
            ];
            if ($conversationId !== null && $conversationId !== '') {
                $payload['conversationId'] = mb_substr($conversationId, 0, 128);
            }
            if ($phoneNumberId !== null && $phoneNumberId !== '') {
                $payload['phoneNumberId'] = mb_substr($phoneNumberId, 0, 64);
            }
            if ($wamid !== null && $wamid !== '') {
                $payload['wamid'] = mb_substr($wamid, 0, 256);
            }
            if ($httpStatus !== null && $httpStatus >= 100 && $httpStatus <= 599) {
                $payload['httpStatus'] = $httpStatus;
            }

            $this->firestore->createDocumentIfAbsent(
                $this->wsPath('whatsappLogs/' . rawurlencode($logId)),
                $payload
            );
        } catch (Throwable $e) {
            $this->storage->logLocal('warning', 'firestore_log_fail', $e->getMessage());
        }
    }

    private static function extractIncomingText(array $msg): string
    {
        $type = (string)($msg['type'] ?? '');
        if ($type === 'text' && isset($msg['text']['body'])) {
            return trim((string)$msg['text']['body']);
        }
        if ($type === 'button' && isset($msg['button']['text'])) {
            return trim((string)$msg['button']['text']);
        }
        if ($type === 'interactive') {
            $btnTitle = $msg['interactive']['button_reply']['title'] ?? null;
            $listTitle = $msg['interactive']['list_reply']['title'] ?? null;
            if (is_string($btnTitle) && trim($btnTitle) !== '') {
                return trim($btnTitle);
            }
            if (is_string($listTitle) && trim($listTitle) !== '') {
                return trim($listTitle);
            }
        }
        if ($type !== '') {
            return '[Mensagem de ' . $type . ' recebida via WhatsApp]';
        }
        return '[Mensagem recebida via WhatsApp]';
    }

    private static function isWithin24h(?string $lastInboundAt): bool
    {
        if ($lastInboundAt === null || trim($lastInboundAt) === '') {
            return false;
        }
        $ts = strtotime($lastInboundAt);
        if ($ts === false) {
            return false;
        }
        return (time() - $ts) <= 86400;
    }

    /**
     * Processa um payload JSON bruto da Meta Cloud API.
     * @return array{messagesProcessed: int, statusesUpdated: int, aiRepliesSent: int, duplicatesSkipped: int}
     */
    public function processWebhookPayload(string $rawBody): array
    {
        $summary = [
            'messagesProcessed' => 0,
            'statusesUpdated' => 0,
            'aiRepliesSent' => 0,
            'duplicatesSkipped' => 0
        ];

        $payload = json_decode($rawBody, true);
        if (!is_array($payload)) {
            $this->storage->logLocal('warning', 'invalid_json', 'Payload JSON inválido recebido.');
            return $summary;
        }

        if ($this->workspaceId === '' || strpos($this->workspaceId, 'COLE_AQUI') !== false) {
            throw new RuntimeException('FIREBASE_WORKSPACE_ID não configurado no config.php.');
        }

        $this->ensureWorkspaceExists();
        $entries = is_array($payload['entry'] ?? null) ? $payload['entry'] : [];

        foreach ($entries as $entry) {
            if (!is_array($entry)) {
                continue;
            }
            $changes = is_array($entry['changes'] ?? null) ? $entry['changes'] : [];
            foreach ($changes as $change) {
                if (!is_array($change) || (($change['field'] ?? '') !== 'messages')) {
                    continue;
                }
                $value = is_array($change['value'] ?? null) ? $change['value'] : [];
                $phoneNumberId = isset($value['metadata']['phone_number_id'])
                    ? (string)$value['metadata']['phone_number_id']
                    : (defined('META_PHONE_NUMBER_ID') ? (string)META_PHONE_NUMBER_ID : 'default');
                $effectivePid = QueueAndStorage::sanitizeIdPart($phoneNumberId !== '' ? $phoneNumberId : 'default');
                $displayPhoneNorm = QueueAndStorage::normalizePhone((string)($value['metadata']['display_phone_number'] ?? ''));

                // 1) Processar atualizações de status (sent, delivered, read, failed)
                $statuses = is_array($value['statuses'] ?? null) ? $value['statuses'] : [];
                foreach ($statuses as $st) {
                    if (!is_array($st)) {
                        continue;
                    }
                    $wamid = (string)($st['id'] ?? '');
                    $recipientId = (string)($st['recipient_id'] ?? '');
                    $rawStatus = (string)($st['status'] ?? '');
                    if ($wamid === '' || !in_array($rawStatus, ['sent', 'delivered', 'read', 'failed'], true)) {
                        continue;
                    }

                    $errMsg = null;
                    if (!empty($st['errors'][0]) && is_array($st['errors'][0])) {
                        $errObj = $st['errors'][0];
                        $errMsg = (string)($errObj['message'] ?? $errObj['title'] ?? 'Erro de entrega Meta');
                        if (!empty($errObj['code'])) {
                            $errMsg = 'Meta #' . $errObj['code'] . ': ' . $errMsg;
                        }
                    }

                    $updated = $this->handleStatusUpdate($recipientId, $wamid, $rawStatus, $errMsg, $effectivePid);
                    if ($updated) {
                        $summary['statusesUpdated']++;
                    }
                }

                // 2) Processar mensagens recebidas
                $contacts = is_array($value['contacts'] ?? null) ? $value['contacts'] : [];
                $messages = is_array($value['messages'] ?? null) ? $value['messages'] : [];
                foreach ($messages as $idx => $msg) {
                    if (!is_array($msg)) {
                        continue;
                    }
                    $wamid = trim((string)($msg['id'] ?? ''));
                    $fromRaw = trim((string)($msg['from'] ?? ''));
                    if ($fromRaw === '') {
                        continue;
                    }

                    $waIdRaw = trim((string)($contacts[$idx]['wa_id'] ?? $contacts[0]['wa_id'] ?? $fromRaw));
                    $normPhone = QueueAndStorage::normalizePhone($waIdRaw)
                        ?: QueueAndStorage::normalizePhone($fromRaw)
                        ?: $fromRaw;

                    // Proteção anti-loop: nunca responder ao próprio número comercial
                    if (
                        $fromRaw === $effectivePid ||
                        ($displayPhoneNorm !== '' && $normPhone === $displayPhoneNorm)
                    ) {
                        $this->storage->logLocal('info', 'self_echo_skipped', 'Evento originado pelo próprio número comercial ignorado.');
                        continue;
                    }

                    $contactProfileName = '';
                    if (!empty($contacts[$idx]['profile']['name'])) {
                        $contactProfileName = (string)$contacts[$idx]['profile']['name'];
                    } elseif (!empty($contacts[0]['profile']['name'])) {
                        $contactProfileName = (string)$contacts[0]['profile']['name'];
                    }

                    $text = self::extractIncomingText($msg);

                    $res = $this->storage->withPhoneLock($effectivePid . '_' . $normPhone, function () use (
                        $wamid,
                        $normPhone,
                        $contactProfileName,
                        $text,
                        $effectivePid
                    ) {
                        return $this->processSingleInboundMessage(
                            $wamid,
                            $normPhone,
                            $contactProfileName,
                            $text,
                            $effectivePid
                        );
                    });

                    if ($res['duplicate']) {
                        $summary['duplicatesSkipped']++;
                    } else {
                        $summary['messagesProcessed']++;
                        if ($res['aiSent']) {
                            $summary['aiRepliesSent']++;
                        }
                    }
                }
            }
        }

        return $summary;
    }

    private function handleStatusUpdate(
        string $recipientPhone,
        string $wamid,
        string $status,
        ?string $errorMessage,
        string $phoneNumberId
    ): bool {
        if ($recipientPhone === '') {
            return false;
        }
        $normPhone = QueueAndStorage::normalizePhone($recipientPhone) ?: $recipientPhone;
        $convInfo = $this->findConversationInFirestore($normPhone, $phoneNumberId);
        if ($convInfo === null) {
            return false;
        }

        $convId = $convInfo['convId'];
        $msgDocId = QueueAndStorage::sanitizeId('wamid_' . $wamid);
        $msgPath = $this->wsPath('whatsappConversations/' . rawurlencode($convId) . '/messages/' . rawurlencode($msgDocId));

        $existingMsg = $this->firestore->getDocument($msgPath);
        if (!is_array($existingMsg)) {
            // Fallback para mensagens antigas salvas com ID interno mas metaMessageId preenchido
            $convSubPath = $this->wsPath('whatsappConversations/' . rawurlencode($convId));
            $matches = $this->firestore->queryCollectionEquals($convSubPath, 'messages', 'metaMessageId', $wamid, 2);
            if (!empty($matches[0]['data']) && is_array($matches[0]['data'])) {
                $msgDocId = (string)$matches[0]['docId'];
                $msgPath = $convSubPath . '/messages/' . rawurlencode($msgDocId);
                $existingMsg = $matches[0]['data'];
            } else {
                return false;
            }
        }

        // Nunca regredir status (ex: webhook atrasado 'sent' não sobrescreve 'delivered' ou 'read')
        $rankMap = ['sending' => 0, 'sent' => 1, 'delivered' => 2, 'read' => 3, 'failed' => 4];
        $currentStatus = (string)($existingMsg['status'] ?? 'sent');
        $currRank = $rankMap[$currentStatus] ?? 1;
        $nextRank = $rankMap[$status] ?? 1;
        if ($nextRank < $currRank && $status !== 'failed') {
            return true;
        }

        $patch = [
            'status' => $status,
            'updatedAt' => FirestoreRestClient::timestamp()
        ];
        $mask = ['status', 'updatedAt'];
        if ($errorMessage !== null && $errorMessage !== '') {
            $patch['errorMessage'] = mb_substr($errorMessage, 0, 1000);
            $mask[] = 'errorMessage';
        }

        $this->firestore->patchDocument($msgPath, $patch, $mask);

        if ($status === 'failed' || $errorMessage !== null) {
            $this->recordFirestoreLog(
                'php_webhook',
                'error',
                'meta_delivery_failed',
                'Falha de entrega WhatsApp (+' . $normPhone . '): ' . ($errorMessage ?: $status),
                $convId,
                $phoneNumberId,
                $wamid
            );
        }

        return true;
    }

    /**
     * @return array{duplicate: bool, aiSent: bool}
     */
    private function processSingleInboundMessage(
        string $wamid,
        string $normPhone,
        string $contactProfileName,
        string $text,
        string $phoneNumberId
    ): array {
        // Dedupe camada 1: disco atômico
        if ($wamid !== '' && !$this->storage->claimWamid($wamid)) {
            $this->recordFirestoreLog(
                'php_webhook',
                'info',
                'duplicate_wamid_ignored',
                'Webhook duplicado ignorado no disco (wamid já processado).',
                null,
                $phoneNumberId,
                $wamid
            );
            return ['duplicate' => true, 'aiSent' => false];
        }

        try {
            $nowIso = gmdate('c');
            $nowTs = FirestoreRestClient::timestamp();
            $displayName = trim($contactProfileName) !== '' ? trim($contactProfileName) : ('Contato +' . $normPhone);
            $effectivePid = QueueAndStorage::sanitizeIdPart($phoneNumberId !== '' ? $phoneNumberId : 'default');
            $convKey = QueueAndStorage::buildConversationKey($this->workspaceId, $effectivePid, $normPhone);
            $paddedPhone = substr(str_pad($normPhone, 8, '0'), 0, 32);

            // Localizar ou criar conversa determinística no Firestore
            $existingConv = $this->findConversationInFirestore($normPhone, $effectivePid);
            $contactId = $this->upsertContactInFirestore($normPhone, $displayName, $nowIso);

            if ($existingConv === null) {
                $convId = QueueAndStorage::buildConversationId($effectivePid, $normPhone);
                $convPath = $this->wsPath('whatsappConversations/' . rawurlencode($convId));

                $convData = [
                    'ownerId' => $this->workspaceId,
                    'id' => $convId,
                    'contactId' => $contactId,
                    'contactPhone' => $paddedPhone,
                    'waId' => $paddedPhone,
                    'phoneNumberId' => $effectivePid,
                    'conversationKey' => $convKey,
                    'contactName' => mb_substr($displayName, 0, 160),
                    'status' => 'ai_active',
                    'aiPaused' => false,
                    'assignedAgent' => 'Atendente IA',
                    'lastMessage' => mb_substr($text, 0, 2000),
                    'lastMessageTimestamp' => $nowIso,
                    'lastInboundAt' => $nowIso,
                    'unreadCount' => 1,
                    'createdAt' => $nowTs,
                    'updatedAt' => $nowTs
                ];

                $createdConv = $this->firestore->createDocumentIfAbsent($convPath, $convData);
                if ($createdConv === null) {
                    $fetched = $this->firestore->getDocument($convPath);
                    $convData = is_array($fetched) ? $fetched : $convData;
                }
                $this->storage->savePhoneConversationMapping($normPhone, $convId, $effectivePid);

                $hoId = 'ho_php_' . time() . '_' . bin2hex(random_bytes(2));
                $this->firestore->createDocumentIfAbsent(
                    $this->wsPath('whatsappConversations/' . rawurlencode($convId) . '/handovers/' . rawurlencode($hoId)),
                    [
                        'ownerId' => $this->workspaceId,
                        'id' => $hoId,
                        'conversationId' => $convId,
                        'action' => 'created',
                        'toStatus' => 'ai_active',
                        'assignedTo' => 'Atendente IA',
                        'byUser' => 'Webhook PHP 20i',
                        'note' => 'Conversa iniciada via WhatsApp Cloud API (20i PHP)',
                        'at' => $nowIso,
                        'createdAt' => $nowTs,
                        'updatedAt' => $nowTs
                    ]
                );
            } else {
                $convId = $existingConv['convId'];
                $convData = $existingConv['data'];
                $this->storage->savePhoneConversationMapping($normPhone, $convId, $effectivePid);
            }

            // Dedupe camada 2: ID determinístico da mensagem no Firestore
            $msgDocId = $wamid !== ''
                ? QueueAndStorage::sanitizeId('wamid_' . $wamid)
                : ('msg_php_' . time() . '_' . bin2hex(random_bytes(3)));
            $msgPath = $this->wsPath('whatsappConversations/' . rawurlencode($convId) . '/messages/' . rawurlencode($msgDocId));

            $inboundMsgDoc = [
                'ownerId' => $this->workspaceId,
                'id' => $msgDocId,
                'conversationId' => $convId,
                'sender' => 'contact',
                'direction' => 'inbound',
                'senderName' => mb_substr($displayName, 0, 160),
                'text' => mb_substr($text, 0, 4096) ?: '[Mensagem]',
                'status' => 'delivered',
                'phoneNumberId' => $effectivePid,
                'waId' => $paddedPhone,
                'aiGenerated' => false,
                'timestamp' => $nowIso,
                'createdAt' => $nowTs,
                'updatedAt' => $nowTs
            ];
            if ($wamid !== '') {
                $inboundMsgDoc['metaMessageId'] = mb_substr($wamid, 0, 256);
            }

            $msgCreated = $this->firestore->createDocumentIfAbsent($msgPath, $inboundMsgDoc);
            if ($msgCreated === null) {
                return ['duplicate' => true, 'aiSent' => false];
            }

            // Atualiza metadados da conversa (reabre automaticamente se estava 'resolved')
            $prevStatus = (string)($convData['status'] ?? 'ai_active');
            $aiPaused = (bool)($convData['aiPaused'] ?? false);
            $nextStatus = ($prevStatus === 'resolved')
                ? ($aiPaused ? 'human_takeover' : 'ai_active')
                : $prevStatus;
            $nextAgent = ($prevStatus === 'resolved')
                ? ($aiPaused ? ((string)($convData['assignedAgent'] ?? 'Humano')) : 'Atendente IA')
                : (string)($convData['assignedAgent'] ?? 'Atendente IA');
            $nextUnread = min(10000, ((int)($convData['unreadCount'] ?? 0)) + 1);
            $nextName = (
                $contactProfileName !== '' &&
                strpos((string)($convData['contactName'] ?? ''), 'Contato +') === 0
            ) ? mb_substr($contactProfileName, 0, 160) : (string)($convData['contactName'] ?? $displayName);

            $convPath = $this->wsPath('whatsappConversations/' . rawurlencode($convId));
            $this->firestore->patchDocument(
                $convPath,
                [
                    'contactPhone' => $paddedPhone,
                    'waId' => $paddedPhone,
                    'phoneNumberId' => $effectivePid,
                    'conversationKey' => $convKey,
                    'contactName' => $nextName,
                    'status' => $nextStatus,
                    'assignedAgent' => $nextAgent,
                    'lastMessage' => mb_substr($text, 0, 2000),
                    'lastMessageTimestamp' => $nowIso,
                    'lastInboundAt' => $nowIso,
                    'unreadCount' => $nextUnread,
                    'updatedAt' => $nowTs
                ],
                [
                    'contactPhone',
                    'waId',
                    'phoneNumberId',
                    'conversationKey',
                    'contactName',
                    'status',
                    'assignedAgent',
                    'lastMessage',
                    'lastMessageTimestamp',
                    'lastInboundAt',
                    'unreadCount',
                    'updatedAt'
                ]
            );

            $this->recordFirestoreLog(
                'php_webhook',
                'info',
                'inbound_message',
                'Mensagem recebida de ' . $nextName . ' (+' . $normPhone . ') em ' . $convId,
                $convId,
                $effectivePid,
                $wamid,
                200
            );

            // Avalia se Atendente IA deve responder automaticamente (somente mensagens inbound do contato)
            if (
                ($inboundMsgDoc['sender'] ?? '') !== 'contact' ||
                ($inboundMsgDoc['direction'] ?? '') !== 'inbound' ||
                $aiPaused ||
                $nextStatus !== 'ai_active'
            ) {
                if ($aiPaused || $nextStatus !== 'ai_active') {
                    $this->recordFirestoreLog(
                        'ai',
                        'info',
                        'ai_skipped_paused',
                        'Atendente IA não respondeu automaticamente porque a conversa está em status=' . $nextStatus . ($aiPaused ? ' (aiPaused=true)' : '') . '.',
                        $convId,
                        $effectivePid,
                        $wamid
                    );
                }
                return ['duplicate' => false, 'aiSent' => false];
            }

            if (!self::isWithin24h($nowIso)) {
                return ['duplicate' => false, 'aiSent' => false];
            }

            $rateCheck = $this->storage->checkAndRecordAiRateLimit($normPhone);
            if (!$rateCheck['allowed']) {
                $this->recordFirestoreLog(
                    'ai',
                    'warning',
                    'ai_rate_limited',
                    'Atendente IA bloqueado pelo rate limit: ' . ($rateCheck['reason'] ?? 'limite'),
                    $convId,
                    $effectivePid,
                    $wamid
                );
                return ['duplicate' => false, 'aiSent' => false];
            }

            // Carrega histórico recente da subcoleção messages
            $recentDocs = $this->firestore->listSubcollection($convPath, 'messages', 100);
            $history = [];
            foreach ($recentDocs as $rd) {
                $d = $rd['data'];
                if (!empty($d['text'])) {
                    $history[] = [
                        'sender' => (string)($d['sender'] ?? 'contact'),
                        'text' => (string)$d['text'],
                        'ts' => strtotime((string)($d['timestamp'] ?? '1970-01-01T00:00:00Z')) ?: 0
                    ];
                }
            }
            usort($history, static fn($a, $b) => $a['ts'] <=> $b['ts']);

            $aiReply = $this->aiClient->generateAtendenteReply($nextName, $text, $history);
            $providerUsed = (string)($aiReply['providerUsed'] ?? 'gemini');
            $providerLabel = ($providerUsed === 'deepseek') ? 'DeepSeek' : 'Gemini';
            $modelUsed = (string)($aiReply['modelUsed'] ?? ($providerUsed === 'deepseek' ? 'deepseek-chat' : GEMINI_DEFAULT_MODEL));
            $fallbackNote = !empty($aiReply['fallbackUsed']) ? ' [fallback]' : '';
            if (!empty($aiReply['error']) || trim((string)($aiReply['replyText'] ?? '')) === '') {
                $errDetail = (string)($aiReply['error'] ?? 'Resposta vazia retornada pelo provedor de IA.');
                $this->recordFirestoreLog(
                    'ai',
                    'error',
                    'ai_error',
                    'Erro ' . $providerLabel . ' (' . $modelUsed . $fallbackNote . ') no PHP 20i: ' . $errDetail,
                    $convId,
                    $effectivePid,
                    $wamid,
                    isset($aiReply['httpStatus']) ? (int)$aiReply['httpStatus'] : null
                );
                return ['duplicate' => false, 'aiSent' => false];
            }

            // REVALIDA no Firestore se um operador pausou/assumiu durante a chamada à IA
            $freshConv = $this->firestore->getDocument($convPath);
            if (is_array($freshConv) && (!empty($freshConv['aiPaused']) || (($freshConv['status'] ?? 'ai_active') !== 'ai_active'))) {
                $this->recordFirestoreLog(
                    'ai',
                    'info',
                    'ai_discarded_handover',
                    'Resposta automática descartada porque um atendente humano assumiu ou pausou a IA.',
                    $convId,
                    $effectivePid,
                    $wamid
                );
                return ['duplicate' => false, 'aiSent' => false];
            }

            $aiSent = false;
            if ($aiReply['replyText'] !== '') {
                $sendRes = $this->meta->sendText($normPhone, $aiReply['replyText']);
                $replyStatus = $sendRes['ok'] ? 'sent' : 'failed';
                $replyWamid = $sendRes['metaMessageId'] ?? null;
                $replyErr = $sendRes['error'] ?? null;
                $replyIso = gmdate('c');
                $replyTs = FirestoreRestClient::timestamp();

                $outDocId = ($replyWamid !== null && $replyWamid !== '')
                    ? QueueAndStorage::sanitizeId('wamid_' . $replyWamid)
                    : ('msg_ai_' . time() . '_' . bin2hex(random_bytes(3)));

                $outDoc = [
                    'ownerId' => $this->workspaceId,
                    'id' => $outDocId,
                    'conversationId' => $convId,
                    'sender' => 'agent',
                    'direction' => 'outbound',
                    'senderName' => 'Atendente IA (Fazer Meu Website)',
                    'text' => mb_substr($aiReply['replyText'], 0, 4096),
                    'status' => $replyStatus,
                    'phoneNumberId' => $effectivePid,
                    'waId' => $paddedPhone,
                    'aiGenerated' => true,
                    'timestamp' => $replyIso,
                    'createdAt' => $replyTs,
                    'updatedAt' => $replyTs
                ];
                if ($replyWamid !== null && $replyWamid !== '') {
                    $outDoc['metaMessageId'] = mb_substr($replyWamid, 0, 256);
                }
                if ($replyErr !== null && $replyErr !== '') {
                    $outDoc['errorMessage'] = mb_substr($replyErr, 0, 1000);
                }

                $this->firestore->createDocumentIfAbsent(
                    $this->wsPath('whatsappConversations/' . rawurlencode($convId) . '/messages/' . rawurlencode($outDocId)),
                    $outDoc
                );

                $this->firestore->patchDocument(
                    $convPath,
                    [
                        'lastMessage' => mb_substr($aiReply['replyText'], 0, 2000),
                        'lastMessageTimestamp' => $replyIso,
                        'unreadCount' => 0,
                        'updatedAt' => $replyTs
                    ],
                    ['lastMessage', 'lastMessageTimestamp', 'unreadCount', 'updatedAt']
                );

                $metricsNote = '';
                if (!empty($aiReply['latencyMs'])) {
                    $metricsNote .= ' ' . (int)$aiReply['latencyMs'] . 'ms';
                }
                if (!empty($aiReply['totalTokens'])) {
                    $metricsNote .= ' ' . (int)$aiReply['totalTokens'] . 'tok';
                }

                $this->recordFirestoreLog(
                    'ai',
                    $sendRes['ok'] ? 'info' : 'error',
                    $sendRes['ok'] ? 'ai_reply_sent' : 'ai_send_failed',
                    $sendRes['ok']
                        ? 'Resposta do Atendente IA (' . $providerLabel . ' • ' . $modelUsed . $fallbackNote . $metricsNote . ') enviada via Meta Cloud API na conversa ' . $convId . '.'
                        : ('Falha ao enviar resposta da IA (' . $providerLabel . ' • ' . $modelUsed . ') pela Meta API: ' . ($replyErr ?: 'erro')),
                    $convId,
                    $effectivePid,
                    $replyWamid,
                    $sendRes['httpStatus'] ?? null
                );

                $aiSent = (bool)$sendRes['ok'];
            }

            if (!empty($aiReply['shouldHandover'])) {
                $hoId = 'ho_ai_' . time() . '_' . bin2hex(random_bytes(2));
                $hoIso = gmdate('c');
                $hoTs = FirestoreRestClient::timestamp();

                $this->firestore->patchDocument(
                    $convPath,
                    [
                        'status' => 'human_takeover',
                        'aiPaused' => true,
                        'assignedAgent' => 'Humano',
                        'updatedAt' => $hoTs
                    ],
                    ['status', 'aiPaused', 'assignedAgent', 'updatedAt']
                );

                $this->firestore->createDocumentIfAbsent(
                    $this->wsPath('whatsappConversations/' . rawurlencode($convId) . '/handovers/' . rawurlencode($hoId)),
                    [
                        'ownerId' => $this->workspaceId,
                        'id' => $hoId,
                        'conversationId' => $convId,
                        'action' => 'assumed_human',
                        'fromStatus' => 'ai_active',
                        'toStatus' => 'human_takeover',
                        'assignedTo' => 'Humano',
                        'byUser' => 'Atendente IA',
                        'note' => 'Transferência automática solicitada pelo contato ou regra comercial.',
                        'at' => $hoIso,
                        'createdAt' => $hoTs,
                        'updatedAt' => $hoTs
                    ]
                );
            }

            return ['duplicate' => false, 'aiSent' => $aiSent];
        } catch (Throwable $e) {
            if ($wamid !== '') {
                // Libera lock em disco para permitir re-tentativa segura pelo cron_worker
                $this->storage->releaseWamid($wamid);
            }
            throw $e;
        }
    }
}
