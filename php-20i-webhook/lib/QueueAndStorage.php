<?php
declare(strict_types=1);

if (!defined('FMWS_WEBHOOK_BOOT')) {
    http_response_code(403);
    exit('Forbidden');
}

/**
 * Camada persistente em disco (20i-safe):
 * - Normalização e variantes de telefone brasileiro (DDI 55 + 8/9 dígitos)
 * - Deduplicação por wamid em arquivo
 * - Fila persistente em disco (pending / processing / done / failed)
 * - Lock exclusivo por telefone via flock()
 * - Rate limit por telefone/hora + teto diário global de IA
 * - Logs sanitizados locais (nunca grava tokens ou segredos)
 */
final class QueueAndStorage
{
    private string $baseDir;
    private string $pendingDir;
    private string $processingDir;
    private string $doneDir;
    private string $failedDir;
    private string $dedupeDir;
    private string $locksDir;
    private string $rateDir;
    private string $cacheDir;
    private string $logsDir;

    public function __construct(string $baseDir)
    {
        $this->baseDir = rtrim($baseDir, '/\\');
        $this->pendingDir = $this->baseDir . '/queue/pending';
        $this->processingDir = $this->baseDir . '/queue/processing';
        $this->doneDir = $this->baseDir . '/queue/done';
        $this->failedDir = $this->baseDir . '/queue/failed';
        $this->dedupeDir = $this->baseDir . '/dedupe';
        $this->locksDir = $this->baseDir . '/locks';
        $this->rateDir = $this->baseDir . '/rate';
        $this->cacheDir = $this->baseDir . '/cache';
        $this->logsDir = $this->baseDir . '/logs';

        foreach ([
            $this->baseDir,
            $this->pendingDir,
            $this->processingDir,
            $this->doneDir,
            $this->failedDir,
            $this->dedupeDir,
            $this->locksDir,
            $this->rateDir,
            $this->cacheDir,
            $this->logsDir
        ] as $dir) {
            if (!is_dir($dir)) {
                @mkdir($dir, 0750, true);
            }
        }

        // Defesa extra caso o servidor não leia o .htaccess da raiz
        $denyFile = $this->baseDir . '/.htaccess';
        if (!file_exists($denyFile)) {
            @file_put_contents(
                $denyFile,
                "<IfModule mod_authz_core.c>\n  Require all denied\n</IfModule>\n<IfModule !mod_authz_core.c>\n  Order allow,deny\n  Deny from all\n</IfModule>\n"
            );
        }
    }

    public function getCacheDir(): string
    {
        return $this->cacheDir;
    }

    public static function sanitizeId(string $raw): string
    {
        $cleaned = preg_replace('/[^a-zA-Z0-9_-]/', '_', $raw) ?? '';
        $cleaned = substr($cleaned, 0, 120);
        return $cleaned !== '' ? $cleaned : ('id_' . time());
    }

    public static function sanitizeIdPart(string $raw): string
    {
        $cleaned = preg_replace('/[^a-zA-Z0-9_-]/', '_', $raw) ?? '';
        $cleaned = substr($cleaned, 0, 64);
        return $cleaned !== '' ? $cleaned : 'default';
    }

    public static function normalizePhone(string $rawPhone): string
    {
        $digits = preg_replace('/\D+/', '', $rawPhone) ?? '';
        if ($digits === '') {
            return '';
        }
        $len = strlen($digits);
        if (($len === 10 || $len === 11) && strpos($digits, '55') !== 0) {
            $digits = '55' . $digits;
        }
        // Canonicaliza celulares brasileiros com 12 dígitos (55 + DDD(2) + [6-9]xxxxxxx) -> 13 dígitos com 9º dígito
        if (preg_match('/^55\d{2}[6-9]\d{7}$/', $digits) === 1) {
            $digits = substr($digits, 0, 4) . '9' . substr($digits, 4);
        }
        return $digits;
    }

    public static function buildConversationKey(string $workspaceId, string $phoneNumberId, string $waId): string
    {
        $ws = trim($workspaceId) !== '' ? trim($workspaceId) : 'workspace';
        $pid = self::sanitizeIdPart($phoneNumberId !== '' ? $phoneNumberId : 'default');
        $wa = self::normalizePhone($waId) ?: self::sanitizeIdPart($waId);
        return $ws . ':' . $pid . ':' . $wa;
    }

    public static function buildConversationId(string $phoneNumberId, string $waId): string
    {
        $pid = self::sanitizeIdPart($phoneNumberId !== '' ? $phoneNumberId : 'default');
        $wa = self::normalizePhone($waId) ?: self::sanitizeIdPart($waId);
        return substr('conv_' . $pid . '_' . $wa, 0, 120);
    }

    /**
     * Gera variações comuns de telefones brasileiros (com/sem 55 e com/sem 9º dígito)
     * para evitar conversas duplicadas caso já exista cadastro no CRM.
     * @return string[]
     */
    public static function getPhoneVariants(string $rawPhone): array
    {
        $digits = preg_replace('/\D+/', '', $rawPhone) ?? '';
        if ($digits === '') {
            return [];
        }

        $variants = [$digits];
        $withoutCountry = (strpos($digits, '55') === 0 && strlen($digits) >= 12)
            ? substr($digits, 2)
            : $digits;
        $withCountry = (strpos($digits, '55') === 0) ? $digits : ('55' . $digits);

        $variants[] = $withoutCountry;
        $variants[] = $withCountry;

        if (strlen($withoutCountry) === 11 && $withoutCountry[2] === '9') {
            $noNine = substr($withoutCountry, 0, 2) . substr($withoutCountry, 3);
            $variants[] = $noNine;
            $variants[] = '55' . $noNine;
        } elseif (strlen($withoutCountry) === 10) {
            $withNine = substr($withoutCountry, 0, 2) . '9' . substr($withoutCountry, 2);
            $variants[] = $withNine;
            $variants[] = '55' . $withNine;
        }

        return array_values(array_unique(array_filter($variants)));
    }

    public static function maskText(string $text, int $maxLen = 500): string
    {
        // Mascara possíveis tokens/chaves antes de registrar logs
        $clean = preg_replace('/(Bearer\s+|AIza|EAAG|EAA)[A-Za-z0-9_\-\.]{8,}/', '$1***MASKED***', $text) ?? $text;
        return mb_substr($clean, 0, $maxLen);
    }

    public function logLocal(string $level, string $eventType, string $summary, array $context = []): void
    {
        $date = gmdate('Y-m-d');
        $file = $this->logsDir . '/webhook-' . $date . '.log';
        $line = json_encode([
            'ts' => gmdate('c'),
            'level' => $level,
            'event' => $eventType,
            'summary' => self::maskText($summary, 600),
            'ctx' => $context
        ], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
        if ($line !== false) {
            @file_put_contents($file, $line . "\n", FILE_APPEND | LOCK_EX);
        }
    }

    /**
     * Marca wamid como visto de forma atômica ('x' fopen mode) para deduplicação imediata.
     * Retorna true se é NOVO; false se já foi processado/enfileirado.
     */
    public function claimWamid(string $wamid): bool
    {
        $clean = trim($wamid);
        if ($clean === '') {
            return true;
        }
        $key = sha1($clean);
        $path = $this->dedupeDir . '/' . $key . '.lock';

        if (file_exists($path)) {
            $mtime = @filemtime($path);
            if ($mtime !== false && (time() - $mtime) < FMWS_DEDUPE_TTL_SEC) {
                return false;
            }
            @unlink($path);
        }

        $fp = @fopen($path, 'x');
        if ($fp === false) {
            return false;
        }
        @fwrite($fp, $clean . "\n" . gmdate('c'));
        @fclose($fp);
        return true;
    }

    public function releaseWamid(string $wamid): void
    {
        $clean = trim($wamid);
        if ($clean === '') {
            return;
        }
        $path = $this->dedupeDir . '/' . sha1($clean) . '.lock';
        if (file_exists($path)) {
            @unlink($path);
        }
    }

    public function savePhoneConversationMapping(
        string $normalizedPhone,
        string $conversationId,
        string $phoneNumberId = 'default'
    ): void {
        if ($normalizedPhone === '' || $conversationId === '') {
            return;
        }
        $pid = self::sanitizeIdPart($phoneNumberId !== '' ? $phoneNumberId : 'default');
        $path = $this->cacheDir . '/conv_' . $pid . '_' . self::sanitizeId($normalizedPhone) . '.txt';
        @file_put_contents($path, $conversationId, LOCK_EX);
    }

    public function getCachedConversationId(string $rawPhone, string $phoneNumberId = 'default'): ?string
    {
        $pid = self::sanitizeIdPart($phoneNumberId !== '' ? $phoneNumberId : 'default');
        foreach (self::getPhoneVariants($rawPhone) as $variant) {
            $scopedPath = $this->cacheDir . '/conv_' . $pid . '_' . self::sanitizeId($variant) . '.txt';
            if (is_file($scopedPath)) {
                $val = trim((string)@file_get_contents($scopedPath));
                if ($val !== '') {
                    return $val;
                }
            }
        }
        return null;
    }

    public function enqueueJob(string $rawPayload, string $eventHash): ?string
    {
        $jobId = gmdate('YmdHis') . '_' . bin2hex(random_bytes(5)) . '_' . substr($eventHash, 0, 8);
        $tmpPath = $this->pendingDir . '/' . $jobId . '.tmp';
        $finalPath = $this->pendingDir . '/' . $jobId . '.json';

        $jobData = [
            'id' => $jobId,
            'createdAt' => gmdate('c'),
            'attempts' => 0,
            'nextAttemptAt' => time(),
            'lastError' => null,
            'rawBody' => $rawPayload
        ];

        $encoded = json_encode($jobData, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
        if ($encoded === false) {
            return null;
        }
        if (@file_put_contents($tmpPath, $encoded, LOCK_EX) === false) {
            return null;
        }
        if (!@rename($tmpPath, $finalPath)) {
            @unlink($tmpPath);
            return null;
        }
        return $jobId;
    }

    /**
     * Move atomicamente o job de pending -> processing para evitar corrida entre webhook e cron.
     */
    public function claimJob(string $jobId): ?array
    {
        $pendingPath = $this->pendingDir . '/' . $jobId . '.json';
        $processingPath = $this->processingDir . '/' . $jobId . '.json';
        if (!is_file($pendingPath)) {
            return null;
        }
        if (!@rename($pendingPath, $processingPath)) {
            return null;
        }
        $raw = @file_get_contents($processingPath);
        $decoded = is_string($raw) ? json_decode($raw, true) : null;
        if (!is_array($decoded)) {
            @rename($processingPath, $this->failedDir . '/' . $jobId . '.json');
            return null;
        }
        return $decoded;
    }

    public function completeJob(string $jobId): void
    {
        $processingPath = $this->processingDir . '/' . $jobId . '.json';
        $donePath = $this->doneDir . '/' . $jobId . '.json';
        if (is_file($processingPath)) {
            @rename($processingPath, $donePath);
        }
    }

    public function failOrRequeueJob(string $jobId, array $jobData, string $errorMsg): void
    {
        $processingPath = $this->processingDir . '/' . $jobId . '.json';
        $attempts = ((int)($jobData['attempts'] ?? 0)) + 1;
        $jobData['attempts'] = $attempts;
        $jobData['lastError'] = self::maskText($errorMsg, 400);

        // Backoff exponencial: 15s, 45s, 120s, 300s
        $backoffSec = min(600, 15 * (int)pow(3, max(0, $attempts - 1)));
        $jobData['nextAttemptAt'] = time() + $backoffSec;

        $encoded = json_encode($jobData, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
        $targetDir = ($attempts >= FMWS_QUEUE_MAX_ATTEMPTS) ? $this->failedDir : $this->pendingDir;
        $targetPath = $targetDir . '/' . $jobId . '.json';

        if ($encoded !== false) {
            @file_put_contents($targetPath, $encoded, LOCK_EX);
        }
        if (is_file($processingPath)) {
            @unlink($processingPath);
        }
    }

    /**
     * @return string[] Lista de jobIds prontos em pending
     */
    public function listDuePendingJobIds(int $limit = 20): array
    {
        $files = glob($this->pendingDir . '/*.json') ?: [];
        sort($files);
        $ids = [];
        $now = time();
        foreach ($files as $file) {
            if (count($ids) >= $limit) {
                break;
            }
            $raw = @file_get_contents($file);
            $data = is_string($raw) ? json_decode($raw, true) : null;
            if (!is_array($data)) {
                continue;
            }
            $nextAt = (int)($data['nextAttemptAt'] ?? 0);
            if ($nextAt <= $now) {
                $ids[] = basename($file, '.json');
            }
        }
        return $ids;
    }

    /**
     * Recupera jobs presos em processing há mais de 5 minutos (queda de processo PHP).
     */
    public function recoverStuckProcessingJobs(int $maxAgeSec = 300): int
    {
        $files = glob($this->processingDir . '/*.json') ?: [];
        $recovered = 0;
        $now = time();
        foreach ($files as $file) {
            $mtime = @filemtime($file);
            if ($mtime !== false && ($now - $mtime) > $maxAgeSec) {
                $target = $this->pendingDir . '/' . basename($file);
                if (@rename($file, $target)) {
                    $recovered++;
                }
            }
        }
        return $recovered;
    }

    /**
     * Executa uma tarefa com lock exclusivo por número de telefone.
     * @template T
     * @param callable():T $fn
     * @return T
     */
    public function withPhoneLock(string $phoneKey, callable $fn)
    {
        $safeKey = self::sanitizeId($phoneKey);
        $lockPath = $this->locksDir . '/phone_' . $safeKey . '.lock';
        $fp = @fopen($lockPath, 'c+');
        if ($fp === false) {
            return $fn();
        }
        try {
            @flock($fp, LOCK_EX);
            return $fn();
        } finally {
            @flock($fp, LOCK_UN);
            @fclose($fp);
        }
    }

    /**
     * Controle de taxa de chamadas à IA por contato e teto diário global.
     * @return array{allowed: bool, reason?: string}
     */
    public function checkAndRecordAiRateLimit(string $phoneKey): array
    {
        $now = time();
        $today = gmdate('Y-m-d');

        // 1) Teto diário global
        $dailyFile = $this->rateDir . '/daily_' . $today . '.json';
        $dailyFp = @fopen($dailyFile, 'c+');
        $dailyCount = 0;
        if ($dailyFp !== false) {
            @flock($dailyFp, LOCK_EX);
            $rawDaily = stream_get_contents($dailyFp);
            $dailyData = is_string($rawDaily) && $rawDaily !== '' ? json_decode($rawDaily, true) : null;
            $dailyCount = is_array($dailyData) ? (int)($dailyData['count'] ?? 0) : 0;
            if ($dailyCount >= FMWS_AI_MAX_PER_DAY) {
                @flock($dailyFp, LOCK_UN);
                @fclose($dailyFp);
                return [
                    'allowed' => false,
                    'reason' => 'Limite diário global de chamadas Gemini no PHP atingido (' . FMWS_AI_MAX_PER_DAY . ').'
                ];
            }
        }

        // 2) Cooldown + limite por hora para o telefone específico
        $phoneFile = $this->rateDir . '/phone_' . self::sanitizeId($phoneKey) . '.json';
        $phoneFp = @fopen($phoneFile, 'c+');
        $timestamps = [];
        if ($phoneFp !== false) {
            @flock($phoneFp, LOCK_EX);
            $rawPhone = stream_get_contents($phoneFp);
            $phoneData = is_string($rawPhone) && $rawPhone !== '' ? json_decode($rawPhone, true) : null;
            $timestamps = is_array($phoneData['ts'] ?? null) ? $phoneData['ts'] : [];
            $timestamps = array_values(array_filter($timestamps, static fn($t) => is_int($t) && ($now - $t) <= 3600));

            if (!empty($timestamps)) {
                $lastTs = end($timestamps);
                if (is_int($lastTs) && ($now - $lastTs) < FMWS_AI_COOLDOWN_PER_PHONE_SEC) {
                    @flock($phoneFp, LOCK_UN);
                    @fclose($phoneFp);
                    if ($dailyFp !== false) {
                        @flock($dailyFp, LOCK_UN);
                        @fclose($dailyFp);
                    }
                    return [
                        'allowed' => false,
                        'reason' => 'Cooldown ativo entre respostas automáticas (' . FMWS_AI_COOLDOWN_PER_PHONE_SEC . 's).'
                    ];
                }
            }

            if (count($timestamps) >= FMWS_AI_MAX_PER_PHONE_HOUR) {
                @flock($phoneFp, LOCK_UN);
                @fclose($phoneFp);
                if ($dailyFp !== false) {
                    @flock($dailyFp, LOCK_UN);
                    @fclose($dailyFp);
                }
                return [
                    'allowed' => false,
                    'reason' => 'Limite por hora do contato atingido (' . FMWS_AI_MAX_PER_PHONE_HOUR . ' msgs/h).'
                ];
            }

            $timestamps[] = $now;
            ftruncate($phoneFp, 0);
            rewind($phoneFp);
            fwrite($phoneFp, (string)json_encode(['ts' => $timestamps]));
            @flock($phoneFp, LOCK_UN);
            @fclose($phoneFp);
        }

        if ($dailyFp !== false) {
            ftruncate($dailyFp, 0);
            rewind($dailyFp);
            fwrite($dailyFp, (string)json_encode(['count' => $dailyCount + 1]));
            @flock($dailyFp, LOCK_UN);
            @fclose($dailyFp);
        }

        return ['allowed' => true];
    }

    public function pruneOldFiles(): int
    {
        $removed = 0;
        $now = time();
        $targets = [
            [$this->dedupeDir, FMWS_DEDUPE_TTL_SEC],
            [$this->doneDir, 86400 * 7],
            [$this->rateDir, 86400 * 3],
            [$this->logsDir, 86400 * 30],
        ];
        foreach ($targets as [$dir, $ttl]) {
            foreach (glob($dir . '/*') ?: [] as $file) {
                if (is_file($file)) {
                    $mtime = @filemtime($file);
                    if ($mtime !== false && ($now - $mtime) > $ttl) {
                        if (@unlink($file)) {
                            $removed++;
                        }
                    }
                }
            }
        }
        return $removed;
    }
}
