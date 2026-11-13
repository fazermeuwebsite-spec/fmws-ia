<?php
declare(strict_types=1);

/**
 * FMWS SALES AI — Webhook Oficial WhatsApp Cloud API (Hospedagem 20i)
 * Endpoint: https://crm.fazermeuwebsite.com.br/api/webhooks/whatsapp.php
 *
 * Arquitetura autônoma (sem Cloud Run / sem ais-dev-*):
 * 1) GET: Validação oficial do hub.verify_token da Meta
 * 2) POST: Verificação HMAC X-Hub-Signature-256 + fila persistente em disco + HTTP 200 imediato
 * 3) Processamento no PHP -> Gemini API -> Meta Cloud API -> Firestore (tempo real via listeners no CRM)
 */
define('FMWS_WEBHOOK_BOOT', true);

@date_default_timezone_set('UTC');
header('Cache-Control: no-store, no-cache, must-revalidate, max-age=0');

$configPath = __DIR__ . '/config.php';
if (!is_file($configPath)) {
    $configPath = __DIR__ . '/config.example.php';
}
require_once $configPath;
require_once __DIR__ . '/lib/QueueAndStorage.php';
require_once __DIR__ . '/lib/FirestoreRestClient.php';
require_once __DIR__ . '/lib/MetaCloudClient.php';
require_once __DIR__ . '/lib/GeminiClient.php';
require_once __DIR__ . '/lib/WhatsAppProcessor.php';

$method = strtoupper($_SERVER['REQUEST_METHOD'] ?? 'GET');

// -------------------------------------------------------------------------
// 1) VERIFICAÇÃO GET OFICIAL DA META CLOUD API (hub.verify_token)
// -------------------------------------------------------------------------
if ($method === 'GET') {
    $mode = $_GET['hub_mode'] ?? $_GET['hub.mode'] ?? '';
    $token = $_GET['hub_verify_token'] ?? $_GET['hub.verify_token'] ?? '';
    $challenge = $_GET['hub_challenge'] ?? $_GET['hub.challenge'] ?? '';

    $expectedToken = trim((string)META_VERIFY_TOKEN);
    if (
        $mode === 'subscribe' &&
        $expectedToken !== '' &&
        strpos($expectedToken, 'COLE_AQUI') === false &&
        is_string($token) &&
        hash_equals($expectedToken, trim($token))
    ) {
        header('Content-Type: text/plain; charset=utf-8');
        http_response_code(200);
        echo (string)$challenge;
        exit;
    }

    header('Content-Type: application/json; charset=utf-8');
    http_response_code(403);
    echo json_encode(['ok' => false, 'error' => 'Verify token invalido']);
    exit;
}

if ($method !== 'POST') {
    header('Content-Type: application/json; charset=utf-8');
    http_response_code(405);
    echo json_encode(['ok' => false, 'error' => 'Method not allowed']);
    exit;
}

// -------------------------------------------------------------------------
// 2) RECEBIMENTO POST DA META CLOUD API
// -------------------------------------------------------------------------
$rawBody = file_get_contents('php://input');
if ($rawBody === false || trim($rawBody) === '') {
    header('Content-Type: application/json; charset=utf-8');
    http_response_code(400);
    echo json_encode(['ok' => false, 'error' => 'Empty payload']);
    exit;
}

$storage = new QueueAndStorage(FMWS_STORAGE_DIR);

// Verificação obrigatória de X-Hub-Signature-256 quando META_APP_SECRET estiver configurado
$appSecret = trim((string)META_APP_SECRET);
if (FMWS_REQUIRE_SIGNATURE && $appSecret !== '' && strpos($appSecret, 'COLE_AQUI') === false) {
    $sigHeader = MetaCloudClient::getHeaderCaseInsensitive('X-Hub-Signature-256');
    if (!MetaCloudClient::verifyHubSignature($rawBody, $sigHeader, $appSecret)) {
        $storage->logLocal('error', 'meta_signature_invalid', 'Assinatura X-Hub-Signature-256 inválida rejeitada.');
        header('Content-Type: application/json; charset=utf-8');
        http_response_code(403);
        echo json_encode(['ok' => false, 'error' => 'Invalid X-Hub-Signature-256 signature']);
        exit;
    }
}

$decoded = json_decode($rawBody, true);
if (!is_array($decoded)) {
    header('Content-Type: application/json; charset=utf-8');
    http_response_code(400);
    echo json_encode(['ok' => false, 'error' => 'Malformed JSON payload']);
    exit;
}

// Persiste em fila atômica no disco antes de responder HTTP 200
$eventHash = sha1($rawBody);
$jobId = $storage->enqueueJob($rawBody, $eventHash);

if ($jobId === null) {
    $storage->logLocal('error', 'queue_write_failed', 'Não foi possível gravar evento na fila em disco.');
    header('Content-Type: application/json; charset=utf-8');
    http_response_code(500);
    echo json_encode(['ok' => false, 'error' => 'Failed to persist incoming event']);
    exit;
}

// Responde imediatamente HTTP 200 para a Meta evitar reenvios por timeout
$ackPayload = json_encode(['ok' => true, 'queued' => true, 'jobId' => $jobId]);
header('Content-Type: application/json; charset=utf-8');
header('Connection: close');
if ($ackPayload !== false) {
    header('Content-Length: ' . strlen($ackPayload));
}
http_response_code(200);
echo $ackPayload;

if (function_exists('fastcgi_finish_request')) {
    @fastcgi_finish_request();
} else {
    @ob_end_flush();
    @flush();
}

// -------------------------------------------------------------------------
// 3) PROCESSAMENTO IMEDIATO DO JOB APÓS LIBERAR CONEXÃO DA META
// -------------------------------------------------------------------------
@ignore_user_abort(true);
@set_time_limit(45);

$job = $storage->claimJob($jobId);
if ($job === null) {
    exit;
}

try {
    $firestore = new FirestoreRestClient(
        FIREBASE_PROJECT_ID,
        FIREBASE_DATABASE_ID,
        FIREBASE_SERVICE_ACCOUNT_PATH,
        $storage->getCacheDir()
    );
    $meta = new MetaCloudClient(
        META_PHONE_NUMBER_ID,
        META_ACCESS_TOKEN,
        META_GRAPH_VERSION
    );
    $gemini = new GeminiClient(
        GEMINI_API_KEY,
        GEMINI_DEFAULT_MODEL,
        GEMINI_TIMEOUT_SEC,
        $firestore,
        FIREBASE_WORKSPACE_ID,
        $storage->getCacheDir()
    );
    $processor = new WhatsAppProcessor(
        $storage,
        $firestore,
        $meta,
        $gemini,
        FIREBASE_WORKSPACE_ID
    );

    $summary = $processor->processWebhookPayload((string)($job['rawBody'] ?? $rawBody));
    $storage->completeJob($jobId);
    $storage->logLocal('info', 'job_completed', 'Evento processado com sucesso.', $summary);
} catch (Throwable $e) {
    $storage->failOrRequeueJob($jobId, $job, $e->getMessage());
    $storage->logLocal('error', 'job_failed', 'Erro ao processar job ' . $jobId . ': ' . $e->getMessage());
}
