<?php
declare(strict_types=1);

if (!defined('FMWS_WEBHOOK_BOOT')) {
    http_response_code(403);
    exit('Forbidden');
}

/**
 * Cliente Meta WhatsApp Cloud API (v22.0):
 * - Validação HMAC-SHA256 da assinatura X-Hub-Signature-256
 * - Envio de mensagens de texto via Graph API
 */
final class MetaCloudClient
{
    private string $phoneNumberId;
    private string $accessToken;
    private string $graphVersion;

    public function __construct(string $phoneNumberId, string $accessToken, string $graphVersion = 'v22.0')
    {
        $this->phoneNumberId = trim($phoneNumberId);
        $this->accessToken = trim($accessToken);
        $this->graphVersion = trim($graphVersion) ?: 'v22.0';
    }

    public static function getHeaderCaseInsensitive(string $targetHeader): ?string
    {
        $serverKey = 'HTTP_' . strtoupper(str_replace('-', '_', $targetHeader));
        if (!empty($_SERVER[$serverKey])) {
            return trim((string)$_SERVER[$serverKey]);
        }
        if (function_exists('getallheaders')) {
            $headers = getallheaders();
            if (is_array($headers)) {
                foreach ($headers as $name => $value) {
                    if (strcasecmp((string)$name, $targetHeader) === 0) {
                        return trim((string)$value);
                    }
                }
            }
        }
        return null;
    }

    public static function verifyHubSignature(string $rawBody, ?string $signatureHeader, string $appSecret): bool
    {
        $secret = trim($appSecret);
        if ($secret === '' || $signatureHeader === null || stripos($signatureHeader, 'sha256=') !== 0) {
            return false;
        }
        $providedHex = strtolower(trim(substr($signatureHeader, 7)));
        if (!preg_match('/^[0-9a-f]{64}$/', $providedHex)) {
            return false;
        }
        $expectedHex = hash_hmac('sha256', $rawBody, $secret);
        return hash_equals($expectedHex, $providedHex);
    }

    /**
     * @return array{ok: bool, metaMessageId?: string, error?: string, code?: int, httpStatus?: int}
     */
    public function sendText(string $toPhone, string $text): array
    {
        $to = QueueAndStorage::normalizePhone($toPhone);
        if ($to === '') {
            return ['ok' => false, 'error' => 'Número de destino inválido para envio via Meta Cloud API.'];
        }
        if ($this->phoneNumberId === '' || $this->accessToken === '') {
            return ['ok' => false, 'error' => 'META_PHONE_NUMBER_ID ou META_ACCESS_TOKEN não configurados no config.php.'];
        }

        $url = sprintf(
            'https://graph.facebook.com/%s/%s/messages',
            rawurlencode($this->graphVersion),
            rawurlencode($this->phoneNumberId)
        );

        $payload = json_encode([
            'messaging_product' => 'whatsapp',
            'recipient_type' => 'individual',
            'to' => $to,
            'type' => 'text',
            'text' => [
                'preview_url' => false,
                'body' => $text
            ]
        ], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);

        $ch = curl_init($url);
        curl_setopt_array($ch, [
            CURLOPT_POST => true,
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_TIMEOUT => 15,
            CURLOPT_CONNECTTIMEOUT => 5,
            CURLOPT_HTTPHEADER => [
                'Authorization: Bearer ' . $this->accessToken,
                'Content-Type: application/json'
            ],
            CURLOPT_POSTFIELDS => $payload === false ? '{}' : $payload
        ]);
        $resp = curl_exec($ch);
        $httpCode = (int)curl_getinfo($ch, CURLINFO_HTTP_CODE);
        $curlErr = curl_error($ch);
        curl_close($ch);

        if ($resp === false) {
            return [
                'ok' => false,
                'error' => 'Falha de conexão cURL com a Meta Cloud API: ' . $curlErr
            ];
        }

        $data = json_decode((string)$resp, true);
        if ($httpCode < 200 || $httpCode >= 300) {
            $errObj = is_array($data['error'] ?? null) ? $data['error'] : [];
            $code = isset($errObj['code']) ? (int)$errObj['code'] : null;
            $rawMsg = (string)($errObj['error_data']['details'] ?? $errObj['message'] ?? ('Erro HTTP ' . $httpCode . ' na Meta Cloud API'));
            $friendly = match ($code) {
                190 => 'Access Token da Meta inválido ou expirado (#190). Atualize o token de Usuário do Sistema no config.php.',
                131047 => 'Janela de 24h fechada (#131047). Envie um Template aprovado pelo painel.',
                131030 => 'Número não autorizado na lista de teste da Meta (#131030).',
                131026 => 'Mensagem não entregue (#131026): ' . $rawMsg,
                default => ($code !== null ? ('Meta API (#' . $code . '): ' . $rawMsg) : $rawMsg)
            };
            return [
                'ok' => false,
                'error' => $friendly,
                'code' => $code ?? 0,
                'httpStatus' => $httpCode
            ];
        }

        $metaMessageId = null;
        if (is_array($data['messages'] ?? null) && !empty($data['messages'][0]['id'])) {
            $metaMessageId = (string)$data['messages'][0]['id'];
        }

        return [
            'ok' => true,
            'metaMessageId' => $metaMessageId,
            'httpStatus' => $httpCode
        ];
    }
}
