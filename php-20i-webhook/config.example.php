<?php
declare(strict_types=1);

/**
 * FMWS SALES AI — Configuração do Backend PHP 20i (WhatsApp + Gemini + Firestore)
 * Copie este arquivo para `config.php` na mesma pasta de `whatsapp.php`
 * NUNCA envie `config.php` ou a pasta `secrets/` para repositório público.
 */
if (!defined('FMWS_WEBHOOK_BOOT')) {
    http_response_code(403);
    exit('Forbidden');
}

// 1) Credenciais Meta WhatsApp Cloud API (NUNCA expor no navegador)
define('META_VERIFY_TOKEN', getenv('META_VERIFY_TOKEN') ?: 'COLE_AQUI_SEU_VERIFY_TOKEN');
define('META_APP_SECRET', getenv('META_APP_SECRET') ?: 'COLE_AQUI_SEU_APP_SECRET');
define('META_PHONE_NUMBER_ID', getenv('META_PHONE_NUMBER_ID') ?: 'COLE_AQUI_SEU_PHONE_NUMBER_ID');
define('META_ACCESS_TOKEN', getenv('META_ACCESS_TOKEN') ?: 'COLE_AQUI_SEU_TOKEN_PERMANENTE_SYSTEM_USER');
define('META_GRAPH_VERSION', 'v22.0');

// 2) Google Gemini API (apenas no servidor PHP — para o Atendente IA)
define('GEMINI_API_KEY', getenv('GEMINI_API_KEY') ?: 'COLE_AQUI_SUA_GEMINI_API_KEY');
define('GEMINI_DEFAULT_MODEL', 'gemini-4-hydrogen');
define('GEMINI_TIMEOUT_SEC', 20);

// 3) Firebase Firestore (mesmo projeto e banco do CRM — sem Cloud Run e sem faturamento)
// Copie estes valores em Configurações > Integrações > WhatsApp Cloud API no painel FMWS SALES AI
define('FIREBASE_PROJECT_ID', getenv('FIREBASE_PROJECT_ID') ?: 'gen-lang-client-0335571545');
define('FIREBASE_DATABASE_ID', getenv('FIREBASE_DATABASE_ID') ?: 'ai-studio-fmwssalesai-76b5f5f7-00d8-4765-ba38-022e322e6811');
define('FIREBASE_WORKSPACE_ID', getenv('FIREBASE_WORKSPACE_ID') ?: 'COLE_AQUI_SEU_FIREBASE_WORKSPACE_ID');

// Caminho do arquivo JSON da Conta de Serviço Google (permissão Firebase / Cloud Datastore User)
// Recomenda-se guardar dentro de `secrets/firebase-service-account.json` protegido por .htaccess
define('FIREBASE_SERVICE_ACCOUNT_PATH', __DIR__ . '/secrets/firebase-service-account.json');

// 4) Limites, fila e proteção contra flood / custos inesperados
define('FMWS_STORAGE_DIR', __DIR__ . '/storage');
define('FMWS_DEDUPE_TTL_SEC', 604800);        // 7 dias de proteção contra reentrega Meta (wamid)
define('FMWS_AI_COOLDOWN_PER_PHONE_SEC', 4); // Mínimo de segundos entre respostas da IA por contato
define('FMWS_AI_MAX_PER_PHONE_HOUR', 15);    // Máximo de respostas IA por contato em 1 hora
define('FMWS_AI_MAX_PER_DAY', 1000);         // Teto diário global de chamadas Gemini no PHP
define('FMWS_QUEUE_MAX_ATTEMPTS', 5);        // Re-tentativas pelo cron_worker.php em falhas transitórias
define('FMWS_REQUIRE_SIGNATURE', true);      // Exige X-Hub-Signature-256 válida quando META_APP_SECRET estiver definido
