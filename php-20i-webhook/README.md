# FMWS SALES AI — Webhook WhatsApp Autônomo (Hospedagem 20i + Gemini + Firestore)

Esta pasta contém o backend PHP completo para operar a **WhatsApp Cloud API (Meta)** na sua hospedagem **20i** (`https://crm.fazermeuwebsite.com.br/api/webhooks/whatsapp.php`), **sem publicar o aplicativo no Cloud Run pago** e **sem depender da URL privada `ais-dev-*.run.app`**.

## Fluxo da Arquitetura

1. **Meta Cloud API -> `whatsapp.php` (20i PHP 8.x)**  
   Valida `hub.verify_token` no GET e assinatura `X-Hub-Signature-256` no POST, grava o payload em fila atômica no disco (`storage/queue/pending/`) e responde `HTTP 200` imediato.
2. **`WhatsAppProcessor.php` + `FirestoreRestClient.php` (20i PHP -> Firestore)**  
   Autentica no Firestore usando Conta de Serviço Google (JWT RS256 -> OAuth2), aplica deduplicação dupla (`wamid`), lock por telefone e rate limits, registra contatos/mensagens/status/logs no Firestore e lê as instruções do **Atendente IA** e **Catálogo de Serviços** diretamente do Firestore.
3. **`GeminiClient.php` + `MetaCloudClient.php`**  
   Se a conversa estiver em `ai_active` e `aiPaused == false`, consulta a Gemini REST API no servidor PHP, revalida no Firestore se nenhum humano assumiu ou pausou a conversa durante a geração, e envia a resposta oficial pela Meta Graph API `v22.0`.
4. **Google AI Studio Preview (CRM UI)**  
   O módulo **WhatsApp Oficial** recebe todas as mensagens, status e controles em tempo real pelos listeners (`onSnapshot`) do Firestore e espelha ações manuais (enviar mensagem, pausar IA, assumir atendimento, finalizar) de volta ao Firestore.

---

## Passo 1 — Gerar o JSON da Conta de Serviço Firebase (Gratuito, sem ativar Cloud Billing)

1. Acesse o [Console do Firebase](https://console.firebase.google.com/) e selecione o projeto `gen-lang-client-0335571545`.
2. Vá em **Configurações do Projeto (ícone de engrenagem)** → aba **Contas de serviço**.
3. Clique em **Gerar nova chave privada** → **Gerar chave**.
4. Um arquivo `.json` será baixado no seu computador. Renomeie para `firebase-service-account.json`.

---

## Passo 2 — Enviar arquivos para a hospedagem 20i

No Gerenciador de Arquivos (ou SFTP/FTP) da sua hospedagem **20i**, na pasta pública correspondente a:  
`https://crm.fazermeuwebsite.com.br/api/webhooks/`

Envie exatamente esta estrutura:

```text
api/webhooks/
├── .htaccess
├── config.php                        (copiado de config.example.php)
├── whatsapp.php
├── cron_worker.php
├── lib/
│   ├── FirestoreRestClient.php
│   ├── GeminiClient.php
│   ├── MetaCloudClient.php
│   ├── QueueAndStorage.php
│   └── WhatsAppProcessor.php
└── secrets/
    └── firebase-service-account.json (permissão recomendada 0640)
```

> A pasta `storage/` é criada automaticamente pelo PHP com `.htaccess` bloqueando acesso HTTP direto.

---

## Passo 3 — Preencher `config.php`

Copie `config.example.php` para `config.php` e preencha:

- `META_VERIFY_TOKEN`: mesmo token cadastrado no Meta Developers e em Configurações no CRM.
- `META_APP_SECRET`: App Secret do aplicativo Meta (Settings → Basic).
- `META_PHONE_NUMBER_ID`: ID do número no WhatsApp Business API.
- `META_ACCESS_TOKEN`: **Token permanente de Usuário do Sistema (Meta Business)** com permissões `whatsapp_business_messaging` e `whatsapp_business_management`.
- `GEMINI_API_KEY`: sua chave da Google Gemini API (fica apenas no servidor PHP, nunca vai para o navegador).
- `FIREBASE_PROJECT_ID`: `gen-lang-client-0335571545`
- `FIREBASE_DATABASE_ID`: `ai-studio-fmwssalesai-76b5f5f7-00d8-4765-ba38-022e322e6811`
- `FIREBASE_WORKSPACE_ID`: copie o campo **FIREBASE_WORKSPACE_ID** exibido em **Configurações → Integrações → WhatsApp Cloud API** no CRM.

---

## Passo 4 — Proteção & Cron de reprocessamento na 20i

1. Teste acessar `https://crm.fazermeuwebsite.com.br/api/webhooks/config.php` e `https://crm.fazermeuwebsite.com.br/api/webhooks/secrets/firebase-service-account.json` no navegador: ambos devem retornar **HTTP 403 Forbidden**.
2. No painel **20i → Scheduled Tasks**, crie uma tarefa a cada 1 minuto (opcional, recomendada para retry de falhas transitórias e limpeza de fila):
   ```bash
   /usr/bin/php /home/SEU_USUARIO/public_html/api/webhooks/cron_worker.php
   ```

---

## Passo 5 — Teste Real Obrigatório

1. No painel FMWS SALES AI, faça login e confirme no topo que a conta Google do Firebase está conectada (**Sincronizado**) e que o `FIREBASE_WORKSPACE_ID` foi copiado corretamente para `config.php`.
2. Em **Configurações → Integrações → WhatsApp Cloud API**, clique em **Verificar Webhook** (esperado HTTP 200) e **Testar Conexão** (esperado número verificado).
3. Envie uma mensagem real do seu celular para o número WhatsApp Business conectado.
4. Confirme que:
   - A mensagem aparece automaticamente no módulo **WhatsApp Oficial** (sem recarregar a página).
   - O **Atendente IA** responde pelo WhatsApp seguindo as instruções cadastradas (quando a conversa estiver em `ai_active` e não pausada).
   - Ao clicar em **Pausar IA** ou **Assumir Atendimento**, novas mensagens do cliente **não** acionam resposta da IA.
