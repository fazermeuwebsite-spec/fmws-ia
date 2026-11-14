<?php
declare(strict_types=1);

if (!defined('FMWS_WEBHOOK_BOOT')) {
    http_response_code(403);
    exit('Forbidden');
}

/**
 * Integração direta PHP -> Google Gemini REST API com as instruções, regras e catálogo
 * sincronizados a partir do Firestore (workspaces/{workspaceId}/buckets/aiAgents & services).
 */
final class GeminiClient
{
    private string $apiKey;
    private string $defaultModel;
    private int $timeoutSec;
    private FirestoreRestClient $firestore;
    private string $workspaceId;
    private string $cacheDir;

    public function __construct(
        string $apiKey,
        string $defaultModel,
        int $timeoutSec,
        FirestoreRestClient $firestore,
        string $workspaceId,
        string $cacheDir
    ) {
        $this->apiKey = trim($apiKey);
        $this->defaultModel = trim($defaultModel) ?: 'gemini-4-hydrogen';
        $this->timeoutSec = max(8, $timeoutSec);
        $this->firestore = $firestore;
        $this->workspaceId = trim($workspaceId);
        $this->cacheDir = rtrim($cacheDir, '/\\');
    }

    public function hasApiKey(): bool
    {
        return $this->apiKey !== '' && strpos($this->apiKey, 'COLE_AQUI') === false;
    }

    private function loadBucketWithShortCache(string $bucketKey, int $ttlSec = 10): array
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
            // Em caso de falha transitória, usa cache anterior mesmo expirado se existir
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

    /**
     * @param array<int, array{sender: string, text: string}> $chatHistory
     * @return array{replyText: string, shouldHandover: bool, suggestedLeadStatus?: string, modelUsed: string, error?: string}
     */
    public function generateAtendenteReply(string $contactName, string $incomingText, array $chatHistory): array
    {
        if ($this->apiKey === '' || strpos($this->apiKey, 'COLE_AQUI') !== false) {
            return [
                'replyText' => '',
                'shouldHandover' => true,
                'modelUsed' => $this->defaultModel,
                'error' => 'GEMINI_API_KEY não configurada no config.php do webhook PHP.'
            ];
        }

        $agents = $this->loadBucketWithShortCache('aiAgents', 60);
        $services = $this->loadBucketWithShortCache('services', 60);
        $integrationsCfg = $this->loadBucketWithShortCache('integrationsConfig', 60);

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
                'modelUsed' => (string)($atendenteConfig['model'] ?? $this->defaultModel),
                'error' => 'Atendente IA está pausado nas configurações de Governança.'
            ];
        }

        $geminiEnabled = true;
        $globalModel = $this->defaultModel;
        if (!empty($integrationsCfg[0]['gemini']) && is_array($integrationsCfg[0]['gemini'])) {
            $gCfg = $integrationsCfg[0]['gemini'];
            if (array_key_exists('enabled', $gCfg)) {
                $geminiEnabled = (bool)$gCfg['enabled'];
            }
            if (!empty($gCfg['model']) && is_string($gCfg['model'])) {
                $globalModel = trim($gCfg['model']);
            }
        }

        if (!$geminiEnabled) {
            return [
                'replyText' => '',
                'shouldHandover' => true,
                'modelUsed' => $globalModel,
                'error' => 'Google Gemini está desativado nas configurações do CRM.'
            ];
        }

        $safeGlobalModel = (
            stripos($globalModel, 'gemini-') === 0 &&
            strpos($globalModel, 'gemini-2.') !== 0 &&
            strpos($globalModel, 'gemini-1.') !== 0
        ) ? $globalModel : $this->defaultModel;

        $candidateModel = is_array($atendenteConfig) && !empty($atendenteConfig['model'])
            ? trim((string)$atendenteConfig['model'])
            : $safeGlobalModel;

        $modelName = (
            $candidateModel !== '' &&
            stripos($candidateModel, 'gemini-') === 0 &&
            strpos($candidateModel, 'gemini-2.') !== 0 &&
            strpos($candidateModel, 'gemini-1.') !== 0
        ) ? $candidateModel : $safeGlobalModel;

        // Monta resumo do catálogo de serviços igual ao CRM
        if (!empty($services)) {
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
            $servicesSummary = !empty($lines)
                ? implode("\n", $lines)
                : 'Tabela de serviços ainda não cadastrada. NÃO cite nenhum valor em reais (R$). Informe que um consultor humano enviará o orçamento personalizado e acione shouldHandover=true se o cliente pedir preço.';
        } else {
            $servicesSummary = 'Tabela de serviços ainda não cadastrada. NÃO cite nenhum valor em reais (R$). Informe que um consultor humano enviará o orçamento personalizado e acione shouldHandover=true se o cliente pedir preço.';
        }

        $agentName = (string)($atendenteConfig['name'] ?? 'Atendente IA FMWS');
        $personality = (string)($atendenteConfig['personality'] ?? 'Cordial, profissional e ágil');
        $instructions = (string)($atendenteConfig['instructions'] ?? 'Atenda pelo WhatsApp e qualifique o cliente com objetividade.');

        $rules = is_array($atendenteConfig['rules'] ?? null) ? $atendenteConfig['rules'] : [];
        if (!empty($rules)) {
            $ruleLines = [];
            $i = 1;
            foreach ($rules as $r) {
                $rTrim = trim((string)$r);
                if ($rTrim !== '') {
                    $ruleLines[] = $i . '. ' . $rTrim;
                    $i++;
                }
            }
            $rulesSummary = !empty($ruleLines) ? implode("\n", $ruleLines) : '1. Respostas objetivas e naturais para WhatsApp.';
        } else {
            $rulesSummary = '1. Respostas objetivas e naturais para WhatsApp.';
        }

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

        $recentHistory = array_slice($chatHistory, -8);
        $historyLines = [];
        foreach ($recentHistory as $h) {
            $label = (($h['sender'] ?? '') === 'contact') ? $contactName : 'Atendente';
            $historyLines[] = $label . ': ' . trim((string)($h['text'] ?? ''));
        }
        $historyContext = !empty($historyLines) ? implode("\n", $historyLines) : 'Início de atendimento';

        $userPrompt = <<<USER
Histórico recente da conversa:
{$historyContext}

Nova mensagem recebida de {$contactName}:
"{$incomingText}"

Responda em formato JSON.
USER;

        $url = sprintf(
            'https://generativelanguage.googleapis.com/v1beta/models/%s:generateContent',
            rawurlencode($modelName)
        );

        // Não enviar temperature/topP/topK para modelos gemini-4-hydrogen (usa configuração padrão recomendada)
        $body = json_encode([
            'contents' => [
                [
                    'role' => 'user',
                    'parts' => [
                        ['text' => $systemPrompt . "\n\n" . $userPrompt]
                    ]
                ]
            ],
            'generationConfig' => [
                'responseMimeType' => 'application/json'
            ]
        ], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);

        $ch = curl_init($url);
        curl_setopt_array($ch, [
            CURLOPT_POST => true,
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_TIMEOUT => $this->timeoutSec,
            CURLOPT_CONNECTTIMEOUT => 5,
            CURLOPT_HTTPHEADER => [
                'Content-Type: application/json',
                'x-goog-api-key: ' . $this->apiKey
            ],
            CURLOPT_POSTFIELDS => $body === false ? '{}' : $body
        ]);

        $resp = curl_exec($ch);
        $httpCode = (int)curl_getinfo($ch, CURLINFO_HTTP_CODE);
        $curlErr = curl_error($ch);
        curl_close($ch);

        if ($resp === false) {
            return [
                'replyText' => '',
                'shouldHandover' => true,
                'modelUsed' => $modelName,
                'error' => 'Falha cURL ao chamar Gemini API (' . $modelName . '): ' . $curlErr
            ];
        }

        $data = json_decode((string)$resp, true);
        if ($httpCode < 200 || $httpCode >= 300 || !is_array($data)) {
            $errMsg = (string)($data['error']['message'] ?? ('HTTP ' . $httpCode));
            return [
                'replyText' => '',
                'shouldHandover' => true,
                'modelUsed' => $modelName,
                'error' => 'Erro Gemini API (' . $modelName . ' / HTTP ' . $httpCode . '): ' . $errMsg
            ];
        }

        $rawText = (string)($data['candidates'][0]['content']['parts'][0]['text'] ?? '');
        $parsed = json_decode($rawText, true);
        if (!is_array($parsed)) {
            // Fallback se o modelo envolveu JSON em ```json
            if (preg_match('/\{[\s\S]*\}/', $rawText, $m)) {
                $parsed = json_decode($m[0], true);
            }
        }

        $replyRaw = is_array($parsed) && isset($parsed['replyText'])
            ? (string)$parsed['replyText']
            : trim($rawText);
        $shouldHandover = is_array($parsed) && !empty($parsed['shouldHandover']);
        $suggestedStatus = is_array($parsed) && !empty($parsed['suggestedLeadStatus'])
            ? (string)$parsed['suggestedLeadStatus']
            : null;

        $validated = self::validateAtendenteReply($replyRaw, $services);

        return [
            'replyText' => $validated['text'],
            'shouldHandover' => $shouldHandover || $validated['forceHandover'],
            'suggestedLeadStatus' => $suggestedStatus ?: 'qualificacao',
            'modelUsed' => $modelName
        ];
    }

    /**
     * Mesmas guardrails do backend CRM: valida preços contra o catálogo oficial e evita promessas irreais.
     * @return array{text: string, adjusted: bool, forceHandover: bool}
     */
    private static function validateAtendenteReply(string $rawReply, array $services): array
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
