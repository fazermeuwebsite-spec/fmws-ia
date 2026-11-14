<?php
declare(strict_types=1);

if (!defined('FMWS_WEBHOOK_BOOT')) {
    http_response_code(403);
    exit('Forbidden');
}

/**
 * Roteador Multi-Provedor (Google Gemini <-> DeepSeek) no backend PHP 20i:
 * - Lê configuração do agente ('atendente'), serviços e integrationsConfig do Firestore
 * - Seleciona dinamicamente o provedor e modelo configurados para o agente
 * - Descriptografa o cofre AES-256-GCM (encryptedVault) somente na memória do servidor PHP quando necessário
 * - Aplica fallback opcional SOMENTE se expressamente autorizado no agente e em falha transitória
 */
final class AIProviderRouter
{
    private GeminiClient $gemini;
    private DeepSeekClient $deepseek;
    private FirestoreRestClient $firestore;
    private string $workspaceId;
    private string $cacheDir;
    private string $projectId;
    private string $databaseId;
    private string $appId;

    public function __construct(
        GeminiClient $gemini,
        DeepSeekClient $deepseek,
        FirestoreRestClient $firestore,
        string $workspaceId,
        string $cacheDir,
        string $projectId,
        string $databaseId,
        string $appId
    ) {
        $this->gemini = $gemini;
        $this->deepseek = $deepseek;
        $this->firestore = $firestore;
        $this->workspaceId = trim($workspaceId);
        $this->cacheDir = rtrim($cacheDir, '/\\');
        $this->projectId = trim($projectId);
        $this->databaseId = trim($databaseId);
        $this->appId = trim($appId);
    }

    private function loadBucketWithShortCache(string $bucketKey, int $ttlSec = 60): array
    {
        $cacheFile = $this->cacheDir . '/bucket_' . QueueAndStorage::sanitizeId($bucketKey) . '.json';
        if (is_file($cacheFile)) {
            $mtime = @filemtime($cacheFile);
            if ($mtime !== false && (time() - $mtime) <= $ttlSec) {
                $raw = @file_get_contents($cacheFile);
                $decoded = is_string($raw) ? json_decode($raw, true) : null;
                if (is_array($decoded)) {
                    return $decoded;
                }
            }
        }

        try {
            $doc = $this->firestore->getDocument(
                'workspaces/' . rawurlencode($this->workspaceId) . '/buckets/' . rawurlencode($bucketKey)
            );
            $items = (is_array($doc) && is_array($doc['items'] ?? null)) ? $doc['items'] : [];
            @file_put_contents($cacheFile, (string)json_encode($items, JSON_UNESCAPED_UNICODE), LOCK_EX);
            return $items;
        } catch (Throwable $e) {
            if (is_file($cacheFile)) {
                $raw = @file_get_contents($cacheFile);
                $decoded = is_string($raw) ? json_decode($raw, true) : null;
                if (is_array($decoded)) {
                    return $decoded;
                }
            }
            return [];
        }
    }

    private static function base64UrlDecode(string $input): string
    {
        $padded = strtr($input, '-_', '+/');
        $rem = strlen($padded) % 4;
        if ($rem > 0) {
            $padded .= str_repeat('=', 4 - $rem);
        }
        $decoded = base64_decode($padded, true);
        return is_string($decoded) ? $decoded : '';
    }

    /**
     * Descriptografa encryptedVault gravado pelo servidor Node do CRM (AES-256-GCM).
     * @return array<string, string>
     */
    private function decryptCloudVault(?string $encryptedVault): array
    {
        if (!is_string($encryptedVault) || strpos($encryptedVault, '.') === false) {
            return [];
        }
        $parts = explode('.', trim($encryptedVault));
        if (count($parts) !== 3) {
            return [];
        }
        [$ivB64, $tagB64, $cipherB64] = $parts;
        $iv = self::base64UrlDecode($ivB64);
        $tag = self::base64UrlDecode($tagB64);
        $ciphertext = self::base64UrlDecode($cipherB64);
        if ($iv === '' || $tag === '' || $ciphertext === '') {
            return [];
        }

        $seed = $this->projectId . ':' . $this->databaseId . ':' . $this->appId . ':fmws-vault-v1';
        $key = hash('sha256', $seed, true);

        $plain = @openssl_decrypt($ciphertext, 'aes-256-gcm', $key, OPENSSL_RAW_DATA, $iv, $tag);
        if (!is_string($plain) || $plain === '') {
            return [];
        }
        $decoded = json_decode($plain, true);
        return is_array($decoded) ? $decoded : [];
    }

    /**
     * @param array<int, array{sender: string, text: string}> $chatHistory
     * @return array<string, mixed>
     */
    public function generateAtendenteReply(string $contactName, string $incomingText, array $chatHistory): array
    {
        // TTL curto (10s) para refletir alterações de provedor/modelo/pausa rapidamente na 20i
        $agents = $this->loadBucketWithShortCache('aiAgents', 10);
        $services = $this->loadBucketWithShortCache('services', 30);
        $integrationsCfg = $this->loadBucketWithShortCache('integrationsConfig', 10);

        $atendenteConfig = null;
        foreach ($agents as $ag) {
            if (is_array($ag) && (($ag['id'] ?? '') === 'atendente')) {
                $atendenteConfig = $ag;
                break;
            }
        }

        if (is_array($atendenteConfig) && (($atendenteConfig['status'] ?? '') === 'pausado')) {
            return [
                'replyText' => '',
                'shouldHandover' => true,
                'providerUsed' => ($atendenteConfig['provider'] ?? 'gemini') === 'deepseek' ? 'deepseek' : 'gemini',
                'modelUsed' => (string)($atendenteConfig['model'] ?? 'gemini-4-hydrogen'),
                'fallbackUsed' => false,
                'error' => 'Atendente IA está pausado nas configurações de Governança.'
            ];
        }

        $cfgRoot = is_array($integrationsCfg[0] ?? null) ? $integrationsCfg[0] : [];
        $geminiConfig = is_array($cfgRoot['gemini'] ?? null) ? $cfgRoot['gemini'] : [];
        $deepseekConfig = is_array($cfgRoot['deepseek'] ?? null) ? $cfgRoot['deepseek'] : [];
        $vault = $this->decryptCloudVault(isset($cfgRoot['encryptedVault']) ? (string)$cfgRoot['encryptedVault'] : null);
        $vaultDeepSeekKey = isset($vault['deepseekApiKey']) ? (string)$vault['deepseekApiKey'] : null;

        $geminiEnabled = array_key_exists('enabled', $geminiConfig) ? (bool)$geminiConfig['enabled'] : true;
        $geminiReady = $geminiEnabled && $this->gemini->hasApiKey();

        $hasDeepSeekKey = $this->deepseek->hasApiKey($vaultDeepSeekKey);
        $deepseekEnabled = array_key_exists('enabled', $deepseekConfig)
            ? (bool)$deepseekConfig['enabled']
            : $hasDeepSeekKey;
        $deepseekReady = $deepseekEnabled && $hasDeepSeekKey;

        $configuredPrimary = (is_array($atendenteConfig) && (($atendenteConfig['provider'] ?? 'gemini') === 'deepseek'))
            ? 'deepseek'
            : 'gemini';

        // Se o provedor primário salvo estiver desativado/sem chave e o outro provedor estiver pronto,
        // roteia automaticamente para o provedor ativo (espelha a lógica do backend Node do CRM).
        $primaryProvider = $configuredPrimary;
        if ($configuredPrimary === 'gemini' && !$geminiReady && $deepseekReady) {
            $primaryProvider = 'deepseek';
        } elseif ($configuredPrimary === 'deepseek' && !$deepseekReady && $geminiReady) {
            $primaryProvider = 'gemini';
        }

        if ($primaryProvider === 'deepseek') {
            $primaryResult = $this->deepseek->generateAtendenteReply(
                $contactName,
                $incomingText,
                $chatHistory,
                $atendenteConfig,
                $services,
                $deepseekConfig,
                $vaultDeepSeekKey
            );
        } else {
            $primaryResult = $this->gemini->generateAtendenteReply($contactName, $incomingText, $chatHistory);
            $primaryResult['providerUsed'] = 'gemini';
            $primaryResult['transient'] = !empty($primaryResult['error']);
        }

        if (empty($primaryResult['error']) && trim((string)($primaryResult['replyText'] ?? '')) !== '') {
            $primaryResult['fallbackUsed'] = false;
            return $primaryResult;
        }

        // Fallback opcional: SOMENTE se expressamente ativado no agente, provedor secundário pronto e falha transitória
        $fallbackEnabled = is_array($atendenteConfig) && !empty($atendenteConfig['fallbackEnabled']);
        $fallbackProvider = is_array($atendenteConfig) ? (string)($atendenteConfig['fallbackProvider'] ?? '') : '';
        $fallbackModel = is_array($atendenteConfig) && !empty($atendenteConfig['fallbackModel'])
            ? trim((string)$atendenteConfig['fallbackModel'])
            : null;
        $isFallbackReady = ($fallbackProvider === 'deepseek' && $deepseekReady) || ($fallbackProvider === 'gemini' && $geminiReady);

        if (
            $fallbackEnabled &&
            $isFallbackReady &&
            $fallbackProvider !== $primaryProvider &&
            !empty($primaryResult['transient'])
        ) {
            if ($fallbackProvider === 'deepseek') {
                $secondaryResult = $this->deepseek->generateAtendenteReply(
                    $contactName,
                    $incomingText,
                    $chatHistory,
                    $atendenteConfig,
                    $services,
                    $deepseekConfig,
                    $vaultDeepSeekKey,
                    $fallbackModel
                );
            } else {
                $secondaryResult = $this->gemini->generateAtendenteReply($contactName, $incomingText, $chatHistory);
                $secondaryResult['providerUsed'] = 'gemini';
            }
            if (empty($secondaryResult['error']) && trim((string)($secondaryResult['replyText'] ?? '')) !== '') {
                $secondaryResult['fallbackUsed'] = true;
                $secondaryResult['primaryError'] = $primaryResult['error'] ?? null;
                return $secondaryResult;
            }
        }

        $primaryResult['fallbackUsed'] = false;
        return $primaryResult;
    }
}
