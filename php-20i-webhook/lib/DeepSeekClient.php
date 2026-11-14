<?php
declare(strict_types=1);

if (!defined('FMWS_WEBHOOK_BOOT')) {
    http_response_code(403);
    exit('Forbidden');
}

/**
 * Integração direta PHP 8.4 -> DeepSeek API (POST /chat/completions).
 * Compatível com modelos padrão (deepseek-flash, deepseek-v4-pro, deepseek-chat) e raciocínio (deepseek-reasoner).
 */
final class DeepSeekClient
{
    private string $configApiKey;
    private string $defaultBaseUrl;
    private string $defaultModel;
    private int $timeoutSec;
    private int $maxTokens;

    public function __construct(
        string $configApiKey,
        string $defaultBaseUrl = 'https://api.deepseek.com',
        string $defaultModel = 'deepseek-flash',
        int $timeoutSec = 25,
        int $maxTokens = 1200
    ) {
        $this->configApiKey = trim($configApiKey);
        $this->defaultBaseUrl = self::normalizeBaseUrl($defaultBaseUrl);
        $this->defaultModel = trim($defaultModel) !== '' ? trim($defaultModel) : 'deepseek-flash';
        $this->timeoutSec = max(5, min(120, $timeoutSec));
        $this->maxTokens = max(64, min(8192, $maxTokens));
    }

    public static function normalizeBaseUrl(?string $raw): string
    {
        $trimmed = trim((string)$raw);
        return rtrim($trimmed !== '' ? $trimmed : 'https://api.deepseek.com', '/');
    }

    private function resolveApiKey(?string $vaultApiKey): string
    {
        if ($this->configApiKey !== '' && strpos($this->configApiKey, 'COLE_AQUI') === false) {
            return $this->configApiKey;
        }
        $vaultTrim = trim((string)$vaultApiKey);
        if ($vaultTrim !== '') {
            return $vaultTrim;
        }
        return '';
    }

    /**
     * @param array<int, array{sender: string, text: string}> $chatHistory
     * @param array<string, mixed>|null $atendenteConfig
     * @param array<int, array<string, mixed>> $services
     * @param array<string, mixed> $deepseekConfig
     * @return array{
     *   replyText: string,
     *   shouldHandover: bool,
     *   suggestedLeadStatus?: string,
     *   providerUsed: string,
     *   modelUsed: string,
     *   httpStatus?: int,
     *   latencyMs?: int,
     *   promptTokens?: int,
     *   completionTokens?: int,
     *   totalTokens?: int,
     *   transient: bool,
     *   error?: string
     * }
     */
    public function generateAtendenteReply(
        string $contactName,
        string $incomingText,
        array $chatHistory,
        ?array $atendenteConfig,
        array $services,
        array $deepseekConfig,
        ?string $vaultApiKey = null,
        ?string $overrideModel = null
    ): array {
        $baseUrl = self::normalizeBaseUrl((string)($deepseekConfig['baseUrl'] ?? $this->defaultBaseUrl));
        $timeoutSec = !empty($deepseekConfig['timeoutMs'])
            ? max(5, min(120, (int)round(((int)$deepseekConfig['timeoutMs']) / 1000)))
            : $this->timeoutSec;
        $maxTokens = !empty($deepseekConfig['maxTokens'])
            ? max(64, min(8192, (int)$deepseekConfig['maxTokens']))
            : $this->maxTokens;

        $modelName = trim((string)(
            $overrideModel
            ?? ($atendenteConfig['model'] ?? '')
            ?: ($deepseekConfig['model'] ?? '')
            ?: $this->defaultModel
        ));
        if ($modelName === '') {
            $modelName = $this->defaultModel;
        }

        $apiKey = $this->resolveApiKey($vaultApiKey);
        if ($apiKey === '') {
            return [
                'replyText' => '',
                'shouldHandover' => true,
                'providerUsed' => 'deepseek',
                'modelUsed' => $modelName,
                'transient' => true,
                'error' => 'DEEPSEEK_API_KEY não configurada (nem no config.php nem no cofre criptografado do CRM).'
            ];
        }

        if (array_key_exists('enabled', $deepseekConfig) && $deepseekConfig['enabled'] === false) {
            return [
                'replyText' => '',
                'shouldHandover' => true,
                'providerUsed' => 'deepseek',
                'modelUsed' => $modelName,
                'transient' => true,
                'error' => 'DeepSeek API está desativada nas configurações do CRM.'
            ];
        }

        $servicesSummary = self::buildServicesSummary($services);
        $agentName = (string)($atendenteConfig['name'] ?? 'Atendente IA FMWS');
        $personality = (string)($atendenteConfig['personality'] ?? 'Cordial, profissional e ágil');
        $instructions = (string)($atendenteConfig['instructions'] ?? 'Atenda pelo WhatsApp e qualifique o cliente com objetividade.');
        $rulesSummary = self::buildRulesSummary(is_array($atendenteConfig['rules'] ?? null) ? $atendenteConfig['rules'] : []);

        $systemPrompt = <<<PROMPT
Você é {$agentName}, a atendente virtual e especialista em consultoria digital da Fazer Meu Website.
Personalidade: {$personality}.

Catálogo Oficial de Serviços e Preços:
{$servicesSummary}

Instruções Específicas:
{$instructions}

Regras Obrigatórias de Conformidade FMWS:
{$rulesSummary}
- NUNCA invente preços, descontos ou prazos que não constem no Catálogo Oficial acima.
- NUNCA prometa atendimento humano imediato sem confirmação; informe que a solicitação foi encaminhada para a equipe.
- NUNCA dispare ou sugira prospecção fria automática.
- Se o cliente solicitar explicitamente falar com um atendente humano, gerente, suporte técnico avançado ou vendedor, responda com gentileza dizendo que está encaminhando para a equipe humana e retorne "shouldHandover": true.
- Se o cliente pedir orçamento formal e não houver plano exato no catálogo, confirme os dados (empresa, segmento, objetivo) e retorne "shouldHandover": true.

IMPORTANTE: Retorne a resposta em formato JSON estrito:
{
  "replyText": "texto da resposta para o WhatsApp",
  "shouldHandover": true ou false,
  "suggestedLeadStatus": "qualificacao" | "proposta" | "negociacao" | "suporte"
}
PROMPT;

        $messages = [
            ['role' => 'system', 'content' => $systemPrompt]
        ];

        $recentHistory = array_slice($chatHistory, -10);
        foreach ($recentHistory as $h) {
            $msgText = trim((string)($h['text'] ?? ''));
            if ($msgText === '') {
                continue;
            }
            $messages[] = [
                'role' => (($h['sender'] ?? '') === 'contact') ? 'user' : 'assistant',
                'content' => $msgText
            ];
        }

        $lastIdx = count($messages) - 1;
        $userInstruction = "Mensagem de {$contactName}: {$incomingText}\n\nResponda exclusivamente em formato JSON válido.";
        if ($lastIdx >= 1 && $messages[$lastIdx]['role'] === 'user' && $messages[$lastIdx]['content'] === trim($incomingText)) {
            $messages[$lastIdx]['content'] = $userInstruction;
        } else {
            $messages[] = ['role' => 'user', 'content' => $userInstruction];
        }

        $isReasoner = preg_match('/reasoner|r1/i', $modelName) === 1;
        $url = $baseUrl . '/chat/completions';

        $attempt = $this->executeChatRequest($url, $apiKey, $modelName, $messages, $maxTokens, $timeoutSec, !$isReasoner, !$isReasoner);

        if (!$attempt['ok'] && ($attempt['httpStatus'] ?? 0) === 400 && !$isReasoner) {
            $lowErr = strtolower((string)($attempt['rawErr'] ?? ''));
            if (
                strpos($lowErr, 'response_format') !== false ||
                strpos($lowErr, 'temperature') !== false ||
                strpos($lowErr, 'json_object') !== false ||
                strpos($lowErr, 'not support') !== false
            ) {
                $attempt = $this->executeChatRequest($url, $apiKey, $modelName, $messages, $maxTokens, $timeoutSec, false, false);
            }
        }

        if (!$attempt['ok']) {
            return [
                'replyText' => '',
                'shouldHandover' => true,
                'providerUsed' => 'deepseek',
                'modelUsed' => $modelName,
                'httpStatus' => $attempt['httpStatus'] ?? null,
                'latencyMs' => $attempt['latencyMs'] ?? null,
                'transient' => (bool)($attempt['transient'] ?? true),
                'error' => (string)($attempt['error'] ?? 'Falha ao chamar DeepSeek API.')
            ];
        }

        $data = $attempt['data'];
        $rawText = trim((string)($data['choices'][0]['message']['content'] ?? ''));
        $parsed = json_decode($rawText, true);
        if (!is_array($parsed) && preg_match('/\{[\s\S]*\}/', $rawText, $m)) {
            $parsed = json_decode($m[0], true);
        }

        $replyRaw = is_array($parsed) && isset($parsed['replyText'])
            ? (string)$parsed['replyText']
            : $rawText;
        $shouldHandover = is_array($parsed) && !empty($parsed['shouldHandover']);
        $suggestedStatus = is_array($parsed) && !empty($parsed['suggestedLeadStatus'])
            ? (string)$parsed['suggestedLeadStatus']
            : 'qualificacao';

        $validated = self::validateAtendenteReply($replyRaw, $services);
        $usage = is_array($data['usage'] ?? null) ? $data['usage'] : [];

        return [
            'replyText' => $validated['text'],
            'shouldHandover' => $shouldHandover || $validated['forceHandover'],
            'suggestedLeadStatus' => $suggestedStatus,
            'providerUsed' => 'deepseek',
            'modelUsed' => $modelName,
            'httpStatus' => $attempt['httpStatus'] ?? 200,
            'latencyMs' => $attempt['latencyMs'] ?? 0,
            'promptTokens' => isset($usage['prompt_tokens']) ? (int)$usage['prompt_tokens'] : null,
            'completionTokens' => isset($usage['completion_tokens']) ? (int)$usage['completion_tokens'] : null,
            'totalTokens' => isset($usage['total_tokens']) ? (int)$usage['total_tokens'] : null,
            'transient' => false
        ];
    }

    /**
     * @param array<int, array{role: string, content: string}> $messages
     * @return array<string, mixed>
     */
    private function executeChatRequest(
        string $url,
        string $apiKey,
        string $modelName,
        array $messages,
        int $maxTokens,
        int $timeoutSec,
        bool $useJsonFormat,
        bool $includeTemperature
    ): array {
        $payload = [
            'model' => $modelName,
            'messages' => $messages,
            'max_tokens' => $maxTokens,
            'stream' => false
        ];
        if ($includeTemperature) {
            $payload['temperature'] = 0.35;
        }
        if ($useJsonFormat) {
            $payload['response_format'] = ['type' => 'json_object'];
        }

        $json = json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
        $startedAt = microtime(true);

        $ch = curl_init($url);
        curl_setopt_array($ch, [
            CURLOPT_POST => true,
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_TIMEOUT => $timeoutSec,
            CURLOPT_CONNECTTIMEOUT => 6,
            CURLOPT_HTTPHEADER => [
                'Content-Type: application/json',
                'Authorization: Bearer ' . $apiKey
            ],
            CURLOPT_POSTFIELDS => $json === false ? '{}' : $json
        ]);

        $resp = curl_exec($ch);
        $httpCode = (int)curl_getinfo($ch, CURLINFO_HTTP_CODE);
        $curlErr = curl_error($ch);
        curl_close($ch);

        $latencyMs = (int)round((microtime(true) - $startedAt) * 1000);

        if ($resp === false) {
            return [
                'ok' => false,
                'httpStatus' => 0,
                'latencyMs' => $latencyMs,
                'transient' => true,
                'error' => 'Falha cURL ao chamar DeepSeek API (' . $modelName . '): ' . QueueAndStorage::maskText($curlErr, 250)
            ];
        }

        $decoded = json_decode((string)$resp, true);
        if ($httpCode < 200 || $httpCode >= 300 || !is_array($decoded)) {
            $rawErr = (string)($decoded['error']['message'] ?? $decoded['message'] ?? ('HTTP ' . $httpCode));
            $safeErr = QueueAndStorage::maskText($rawErr, 250);
            $transient = ($httpCode === 402 || $httpCode === 429 || $httpCode === 408 || $httpCode >= 500);
            $label = match ($httpCode) {
                401 => 'Chave DeepSeek inválida (HTTP 401)',
                402 => 'Sem saldo na conta DeepSeek (HTTP 402)',
                403 => 'Acesso negado pela API DeepSeek (HTTP 403)',
                429 => 'Rate limit atingido na API DeepSeek (HTTP 429)',
                default => 'Erro DeepSeek API (HTTP ' . $httpCode . ')'
            };
            return [
                'ok' => false,
                'httpStatus' => $httpCode,
                'latencyMs' => $latencyMs,
                'rawErr' => $safeErr,
                'transient' => $transient,
                'error' => $label . ' [' . $modelName . ']: ' . $safeErr
            ];
        }

        return [
            'ok' => true,
            'httpStatus' => $httpCode,
            'latencyMs' => $latencyMs,
            'data' => $decoded,
            'transient' => false
        ];
    }

    /**
     * @param array<int, array<string, mixed>> $services
     */
    private static function buildServicesSummary(array $services): string
    {
        $lines = [];
        foreach ($services as $s) {
            if (!is_array($s) || empty($s['name'])) {
                continue;
            }
            $price = number_format((float)($s['basePrice'] ?? 0), 2, ',', '.');
            $cycle = match ($s['billingCycle'] ?? 'unico') {
                'mensal' => 'mensal',
                'anual' => 'anual',
                default => 'taxa única'
            };
            $desc = trim((string)($s['description'] ?? ''));
            $lines[] = "- {$s['name']}: R$ {$price} ({$cycle}). Detalhes: " . ($desc !== '' ? $desc : 'Conforme catálogo oficial FMWS');
        }
        return !empty($lines)
            ? implode("\n", $lines)
            : 'Tabela de serviços ainda não cadastrada. NÃO cite nenhum valor em reais (R$). Informe que um consultor humano enviará o orçamento personalizado e acione shouldHandover=true se o cliente pedir preço.';
    }

    /**
     * @param array<int, mixed> $rules
     */
    private static function buildRulesSummary(array $rules): string
    {
        $ruleLines = [];
        $i = 1;
        foreach ($rules as $r) {
            $rTrim = trim((string)$r);
            if ($rTrim !== '') {
                $ruleLines[] = $i . '. ' . $rTrim;
                $i++;
            }
        }
        return !empty($ruleLines) ? implode("\n", $ruleLines) : '1. Respostas objetivas e naturais para WhatsApp.';
    }

    /**
     * @param array<int, array<string, mixed>> $services
     * @return array{text: string, adjusted: bool, forceHandover: bool}
     */
    public static function validateAtendenteReply(string $rawReply, array $services): array
    {
        $text = trim($rawReply);
        if ($text === '') {
            return [
                'text' => 'Olá! Como posso ajudar você e sua empresa hoje na Fazer Meu Website?',
                'adjusted' => true,
                'forceHandover' => false
            ];
        }

        $adjusted = false;
        $forceHandover = false;

        if (preg_match_all('/R\$\s*[\d.,]+/i', $text, $matches) && !empty($matches[0])) {
            $allowed = [];
            foreach ($services as $s) {
                if (is_array($s) && isset($s['basePrice'])) {
                    $allowed[number_format((float)$s['basePrice'], 2, '.', '')] = true;
                }
            }
            $hasUngroundedPrice = false;
            foreach ($matches[0] as $rawPrice) {
                $norm = str_replace(['R$', 'r$', '.', ' '], '', $rawPrice);
                $norm = str_replace(',', '.', $norm);
                if (!is_numeric($norm)) {
                    $hasUngroundedPrice = true;
                    break;
                }
                $key = number_format((float)$norm, 2, '.', '');
                if (!isset($allowed[$key])) {
                    $hasUngroundedPrice = true;
                    break;
                }
            }

            if (empty($services) || $hasUngroundedPrice) {
                $adjusted = true;
                $forceHandover = true;
                $text = empty($services)
                    ? 'Para informar valores e prazos exatos de acordo com o escopo do seu projeto, vou encaminhar seu atendimento para um consultor da Fazer Meu Website preparar o orçamento oficial.'
                    : 'Os investimentos dependem do plano selecionado no nosso catálogo oficial. Vou encaminhar sua solicitação para um consultor confirmar os valores e prazos exatos com você.';
            }
        }

        if (preg_match('/atendimento imediato|agora mesmo um humano|entrega em \d+ hora/i', $text)) {
            $adjusted = true;
            $forceHandover = true;
            $text = (string)preg_replace(
                '/atendimento imediato|agora mesmo um humano/i',
                'nosso time comercial assim que possível',
                $text
            );
        }

        return [
            'text' => $text,
            'adjusted' => $adjusted,
            'forceHandover' => $forceHandover
        ];
    }
}
