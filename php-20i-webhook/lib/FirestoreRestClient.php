<?php
declare(strict_types=1);

if (!defined('FMWS_WEBHOOK_BOOT')) {
    http_response_code(403);
    exit('Forbidden');
}

/**
 * Cliente REST puro para Cloud Firestore usando Conta de Serviço Google (JWT RS256 -> OAuth2).
 * Compatível com hospedagem compartilhada 20i (requer apenas ext-openssl, ext-curl e ext-json).
 */
final class FirestoreRestClient
{
    private string $projectId;
    private string $databaseId;
    private string $serviceAccountPath;
    private string $tokenCachePath;
    private ?array $serviceAccount = null;

    public function __construct(
        string $projectId,
        string $databaseId,
        string $serviceAccountPath,
        string $cacheDir
    ) {
        $this->projectId = trim($projectId);
        $this->databaseId = trim($databaseId);
        $this->serviceAccountPath = $serviceAccountPath;
        $this->tokenCachePath = rtrim($cacheDir, '/\\') . '/google_oauth_token.json';
    }

    public static function timestamp(?string $iso = null): array
    {
        $ts = $iso ?: gmdate('Y-m-d\TH:i:s\Z');
        return ['__fs_timestamp' => $ts];
    }

    private function loadServiceAccount(): array
    {
        if ($this->serviceAccount !== null) {
            return $this->serviceAccount;
        }
        if (!is_file($this->serviceAccountPath)) {
            throw new RuntimeException('Arquivo firebase-service-account.json não encontrado em: ' . $this->serviceAccountPath);
        }
        $raw = @file_get_contents($this->serviceAccountPath);
        $decoded = is_string($raw) ? json_decode($raw, true) : null;
        if (!is_array($decoded) || empty($decoded['client_email']) || empty($decoded['private_key'])) {
            throw new RuntimeException('Arquivo firebase-service-account.json inválido (client_email ou private_key ausente).');
        }
        $this->serviceAccount = $decoded;
        return $this->serviceAccount;
    }

    private static function base64UrlEncode(string $data): string
    {
        return rtrim(strtr(base64_encode($data), '+/', '-_'), '=');
    }

    public function getAccessToken(): string
    {
        // 1) Cache em disco (evita pedir token a cada webhook; margem de segurança de 120s)
        if (is_file($this->tokenCachePath)) {
            $cachedRaw = @file_get_contents($this->tokenCachePath);
            $cached = is_string($cachedRaw) ? json_decode($cachedRaw, true) : null;
            if (
                is_array($cached) &&
                !empty($cached['access_token']) &&
                isset($cached['expires_at']) &&
                (int)$cached['expires_at'] > (time() + 120)
            ) {
                return (string)$cached['access_token'];
            }
        }

        // 2) Assina JWT RS256 com a chave privada da Service Account
        $sa = $this->loadServiceAccount();
        $now = time();
        $tokenUri = (string)($sa['token_uri'] ?? 'https://oauth2.googleapis.com/token');

        $header = self::base64UrlEncode((string)json_encode(['alg' => 'RS256', 'typ' => 'JWT']));
        $claim = self::base64UrlEncode((string)json_encode([
            'iss' => $sa['client_email'],
            'scope' => 'https://www.googleapis.com/auth/datastore',
            'aud' => $tokenUri,
            'iat' => $now,
            'exp' => $now + 3600
        ]));

        $signingInput = $header . '.' . $claim;
        $signature = '';
        $ok = openssl_sign($signingInput, $signature, (string)$sa['private_key'], OPENSSL_ALGO_SHA256);
        if (!$ok) {
            throw new RuntimeException('Falha no openssl_sign ao gerar JWT da Conta de Serviço Google.');
        }
        $jwt = $signingInput . '.' . self::base64UrlEncode($signature);

        // 3) Troca JWT por OAuth2 Access Token
        $ch = curl_init($tokenUri);
        curl_setopt_array($ch, [
            CURLOPT_POST => true,
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_TIMEOUT => 12,
            CURLOPT_CONNECTTIMEOUT => 5,
            CURLOPT_HTTPHEADER => ['Content-Type: application/x-www-form-urlencoded'],
            CURLOPT_POSTFIELDS => http_build_query([
                'grant_type' => 'urn:ietf:params:oauth:grant-type:jwt-bearer',
                'assertion' => $jwt
            ])
        ]);
        $resp = curl_exec($ch);
        $httpCode = (int)curl_getinfo($ch, CURLINFO_HTTP_CODE);
        $curlErr = curl_error($ch);
        curl_close($ch);

        if ($resp === false || $httpCode < 200 || $httpCode >= 300) {
            throw new RuntimeException('Erro OAuth2 Google (' . $httpCode . '): ' . ($curlErr ?: substr((string)$resp, 0, 300)));
        }

        $data = json_decode((string)$resp, true);
        if (!is_array($data) || empty($data['access_token'])) {
            throw new RuntimeException('Resposta OAuth2 Google sem access_token.');
        }

        $ttl = (int)($data['expires_in'] ?? 3500);
        @file_put_contents(
            $this->tokenCachePath,
            (string)json_encode([
                'access_token' => $data['access_token'],
                'expires_at' => $now + $ttl
            ]),
            LOCK_EX
        );

        return (string)$data['access_token'];
    }

    private function baseDocumentsUrl(): string
    {
        return 'https://firestore.googleapis.com/v1/projects/'
            . rawurlencode($this->projectId)
            . '/databases/'
            . rawurlencode($this->databaseId)
            . '/documents';
    }

    private function request(string $method, string $url, ?array $body = null): array
    {
        $token = $this->getAccessToken();
        $headers = [
            'Authorization: Bearer ' . $token,
            'Content-Type: application/json'
        ];

        $ch = curl_init($url);
        curl_setopt_array($ch, [
            CURLOPT_CUSTOMREQUEST => $method,
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_TIMEOUT => 15,
            CURLOPT_CONNECTTIMEOUT => 5,
            CURLOPT_HTTPHEADER => $headers
        ]);
        if ($body !== null) {
            $json = json_encode($body, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
            curl_setopt($ch, CURLOPT_POSTFIELDS, $json === false ? '{}' : $json);
        }

        $resp = curl_exec($ch);
        $httpCode = (int)curl_getinfo($ch, CURLINFO_HTTP_CODE);
        $curlErr = curl_error($ch);
        curl_close($ch);

        if ($resp === false) {
            throw new RuntimeException('Falha cURL ao acessar Firestore REST API: ' . $curlErr);
        }

        $decoded = json_decode((string)$resp, true);
        return [
            'status' => $httpCode,
            'data' => is_array($decoded) ? $decoded : null,
            'raw' => (string)$resp
        ];
    }

    public function getDocument(string $relativePath): ?array
    {
        $cleanPath = ltrim($relativePath, '/');
        $url = $this->baseDocumentsUrl() . '/' . $cleanPath;
        $res = $this->request('GET', $url);
        if ($res['status'] === 404) {
            return null;
        }
        if ($res['status'] < 200 || $res['status'] >= 300 || !is_array($res['data'])) {
            throw new RuntimeException('Erro Firestore GET (' . $res['status'] . '): ' . substr($res['raw'], 0, 300));
        }
        return self::decodeDocument($res['data']);
    }

    public function patchDocument(string $relativePath, array $fields, array $updateMaskFields = []): array
    {
        $cleanPath = ltrim($relativePath, '/');
        $url = $this->baseDocumentsUrl() . '/' . $cleanPath;
        if (!empty($updateMaskFields)) {
            $queryParts = [];
            foreach ($updateMaskFields as $fp) {
                $queryParts[] = 'updateMask.fieldPaths=' . rawurlencode($fp);
            }
            $url .= '?' . implode('&', $queryParts);
        }

        $payload = ['fields' => self::encodeFields($fields)];
        $res = $this->request('PATCH', $url, $payload);
        if ($res['status'] < 200 || $res['status'] >= 300 || !is_array($res['data'])) {
            throw new RuntimeException('Erro Firestore PATCH (' . $res['status'] . '): ' . substr($res['raw'], 0, 300));
        }
        return self::decodeDocument($res['data']);
    }

    /**
     * Cria documento somente se ainda não existir (garante idempotência contra concorrência).
     * Retorna array do documento se criado, ou null se já existia (HTTP 409 ALREADY_EXISTS).
     */
    public function createDocumentIfAbsent(string $relativePath, array $fields): ?array
    {
        $cleanPath = ltrim($relativePath, '/');
        $url = $this->baseDocumentsUrl() . '/' . $cleanPath . '?currentDocument.exists=false';
        $payload = ['fields' => self::encodeFields($fields)];
        $res = $this->request('PATCH', $url, $payload);
        if ($res['status'] === 409) {
            return null;
        }
        if ($res['status'] < 200 || $res['status'] >= 300 || !is_array($res['data'])) {
            throw new RuntimeException('Erro Firestore CREATE (' . $res['status'] . '): ' . substr($res['raw'], 0, 300));
        }
        return self::decodeDocument($res['data']);
    }

    /**
     * @return array<int, array{docId: string, data: array}>
     */
    public function queryCollectionEquals(string $parentRelativePath, string $collectionId, string $fieldPath, string $value, int $limit = 10): array
    {
        $parent = $parentRelativePath !== ''
            ? ($this->baseDocumentsUrl() . '/' . ltrim($parentRelativePath, '/'))
            : $this->baseDocumentsUrl();
        $url = $parent . ':runQuery';

        $body = [
            'structuredQuery' => [
                'from' => [['collectionId' => $collectionId]],
                'where' => [
                    'fieldFilter' => [
                        'field' => ['fieldPath' => $fieldPath],
                        'op' => 'EQUAL',
                        'value' => ['stringValue' => $value]
                    ]
                ],
                'limit' => $limit
            ]
        ];

        $res = $this->request('POST', $url, $body);
        if ($res['status'] < 200 || $res['status'] >= 300 || !is_array($res['data'])) {
            throw new RuntimeException('Erro Firestore runQuery (' . $res['status'] . '): ' . substr($res['raw'], 0, 300));
        }

        $out = [];
        foreach ($res['data'] as $row) {
            if (!empty($row['document']['name'])) {
                $name = (string)$row['document']['name'];
                $parts = explode('/', $name);
                $docId = end($parts) ?: '';
                $out[] = [
                    'docId' => $docId,
                    'data' => self::decodeDocument($row['document'])
                ];
            }
        }
        return $out;
    }

    /**
     * @return array<int, array{docId: string, data: array}>
     */
    public function listSubcollection(string $parentRelativePath, string $collectionId, int $limit = 20): array
    {
        $parent = $parentRelativePath !== ''
            ? ($this->baseDocumentsUrl() . '/' . ltrim($parentRelativePath, '/'))
            : $this->baseDocumentsUrl();
        $url = $parent . '/' . rawurlencode($collectionId) . '?pageSize=' . $limit;
        $res = $this->request('GET', $url);
        if ($res['status'] === 404) {
            return [];
        }
        if ($res['status'] < 200 || $res['status'] >= 300 || !is_array($res['data'])) {
            throw new RuntimeException('Erro Firestore LIST (' . $res['status'] . '): ' . substr($res['raw'], 0, 300));
        }
        $docs = $res['data']['documents'] ?? [];
        $out = [];
        foreach ($docs as $doc) {
            if (!empty($doc['name'])) {
                $parts = explode('/', (string)$doc['name']);
                $out[] = [
                    'docId' => end($parts) ?: '',
                    'data' => self::decodeDocument($doc)
                ];
            }
        }
        return $out;
    }

    public static function encodeFields(array $assoc): array
    {
        $encoded = [];
        foreach ($assoc as $key => $val) {
            if ($val === null) {
                continue;
            }
            $encoded[(string)$key] = self::encodeValue($val);
        }
        return $encoded;
    }

    private static function encodeValue($val): array
    {
        if (is_array($val) && isset($val['__fs_timestamp'])) {
            return ['timestampValue' => (string)$val['__fs_timestamp']];
        }
        if (is_bool($val)) {
            return ['booleanValue' => $val];
        }
        if (is_int($val)) {
            return ['integerValue' => (string)$val];
        }
        if (is_float($val)) {
            return ['doubleValue' => $val];
        }
        if (is_string($val)) {
            return ['stringValue' => $val];
        }
        if (is_array($val)) {
            $isList = ($val === []) || (array_keys($val) === range(0, count($val) - 1));
            if ($isList) {
                $values = [];
                foreach ($val as $item) {
                    $values[] = self::encodeValue($item);
                }
                return ['arrayValue' => ['values' => $values]];
            }
            return ['mapValue' => ['fields' => self::encodeFields($val)]];
        }
        return ['stringValue' => (string)$val];
    }

    public static function decodeDocument(array $doc): array
    {
        $fields = $doc['fields'] ?? [];
        if (!is_array($fields)) {
            return [];
        }
        $out = [];
        foreach ($fields as $k => $v) {
            if (is_array($v)) {
                $out[$k] = self::decodeValue($v);
            }
        }
        return $out;
    }

    private static function decodeValue(array $val)
    {
        if (array_key_exists('stringValue', $val)) {
            return (string)$val['stringValue'];
        }
        if (array_key_exists('booleanValue', $val)) {
            return (bool)$val['booleanValue'];
        }
        if (array_key_exists('integerValue', $val)) {
            return (int)$val['integerValue'];
        }
        if (array_key_exists('doubleValue', $val)) {
            return (float)$val['doubleValue'];
        }
        if (array_key_exists('timestampValue', $val)) {
            return (string)$val['timestampValue'];
        }
        if (array_key_exists('nullValue', $val)) {
            return null;
        }
        if (array_key_exists('arrayValue', $val)) {
            $items = $val['arrayValue']['values'] ?? [];
            $out = [];
            foreach ($items as $item) {
                $out[] = self::decodeValue($item);
            }
            return $out;
        }
        if (array_key_exists('mapValue', $val)) {
            $fields = $val['mapValue']['fields'] ?? [];
            $out = [];
            foreach ($fields as $k => $v) {
                $out[$k] = self::decodeValue($v);
            }
            return $out;
        }
        return null;
    }
}
