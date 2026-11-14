<?php
declare(strict_types=1);

/**
 * Worker CLI para reprocessamento da fila persistente e limpeza na hospedagem 20i.
 * Agendar no painel 20i (Scheduled Tasks / Cron) a cada 1 minuto:
 * /usr/bin/php /home/usuario/public_html/api/webhooks/cron_worker.php
 */
if (PHP_SAPI !== 'cli') {
    http_response_code(403);
    exit('CLI only');
}

define('FMWS_WEBHOOK_BOOT', true);
@date_default_timezone_set('UTC');

$configPath = __DIR__ . '/config.php';
if (!is_file($configPath)) {
    fwrite(STDERR, "config.php não encontrado.\n");
    exit(1);
}

require_once $configPath;
require_once __DIR__ . '/lib/QueueAndStorage.php';
require_once __DIR__ . '/lib/FirestoreRestClient.php';
require_once __DIR__ . '/lib/MetaCloudClient.php';
require_once __DIR__ . '/lib/GeminiClient.php';
require_once __DIR__ . '/lib/DeepSeekClient.php';
require_once __DIR__ . '/lib/AIProviderRouter.php';
require_once __DIR__ . '/lib/WhatsAppProcessor.php';

$storage = new QueueAndStorage(FMWS_STORAGE_DIR);

// Recupera jobs presos se algum request HTTP caiu no meio
$recovered = $storage->recoverStuckProcessingJobs(300);
$dueIds = $storage->listDuePendingJobIds(25);

$processed = 0;
$failed = 0;

if (!empty($dueIds)) {
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
    $deepseek = new DeepSeekClient(
        defined('DEEPSEEK_API_KEY') ? (string)DEEPSEEK_API_KEY : '',
        defined('DEEPSEEK_BASE_URL') ? (string)DEEPSEEK_BASE_URL : 'https://api.deepseek.com',
        defined('DEEPSEEK_DEFAULT_MODEL') ? (string)DEEPSEEK_DEFAULT_MODEL : 'deepseek-flash',
        defined('DEEPSEEK_TIMEOUT_SEC') ? (int)DEEPSEEK_TIMEOUT_SEC : 25,
        defined('DEEPSEEK_MAX_TOKENS') ? (int)DEEPSEEK_MAX_TOKENS : 1200
    );
    $aiRouter = new AIProviderRouter(
        $gemini,
        $deepseek,
        $firestore,
        FIREBASE_WORKSPACE_ID,
        $storage->getCacheDir(),
        FIREBASE_PROJECT_ID,
        FIREBASE_DATABASE_ID,
        defined('FMWS_VAULT_APP_ID') ? (string)FMWS_VAULT_APP_ID : '1:1007158864919:web:bd856b3d8eb53759848052'
    );
    $processor = new WhatsAppProcessor(
        $storage,
        $firestore,
        $meta,
        $aiRouter,
        FIREBASE_WORKSPACE_ID
    );

    foreach ($dueIds as $jobId) {
        $job = $storage->claimJob($jobId);
        if ($job === null) {
            continue;
        }
        try {
            $summary = $processor->processWebhookPayload((string)($job['rawBody'] ?? ''));
            $storage->completeJob($jobId);
            $storage->logLocal('info', 'cron_job_completed', 'Job reprocessado pelo cron.', $summary);
            $processed++;
        } catch (Throwable $e) {
            $storage->failOrRequeueJob($jobId, $job, $e->getMessage());
            $storage->logLocal('error', 'cron_job_failed', 'Falha no cron job ' . $jobId . ': ' . $e->getMessage());
            $failed++;
        }
    }
}

$pruned = $storage->pruneOldFiles();
echo sprintf(
    "FMWS cron_worker ok: recovered=%d processed=%d failed=%d pruned=%d\n",
    $recovered,
    $processed,
    $failed,
    $pruned
);
