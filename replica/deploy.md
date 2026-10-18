# Publicação: Painel de Tarefas Opps

Checklist do replica-deploy, adaptado ao sistema (Node 22 + SQLite, sem etapa de build, sem app de loja).

## 1. Preflight (18/10/2026)

| Verificação | Resultado |
| --- | --- |
| Testes da API (`cd tarefas && npm test`) | 39 de 39 passando |
| Teste de tela (Playwright, protótipo, computador e celular) | Fluxos de tarefas, avisos, reuniões e checklist sem erro |
| Paridade (`parity.py replica/features.csv`) | 95,2 / 100; obrigatórias 9 de 9 |
| Troca de marca (`sweep.py tarefas --config replica/brand.json`) | Limpa (exit 0) |
| Instalação de produção (`npm ci --omit=dev`) e primeira execução | OK: cria o administrador, faz o backup, sobe na porta |
| Imagem Docker | Dockerfile pronto; não deu para gerar a imagem aqui (sem Docker rodando), gerar na hospedagem |
| Título, ícone e marca | Do Painel de Tarefas Opps |

Corrigido antes de publicar:
- Limite de tentativas de login atrás do proxy da hospedagem (`TRUST_PROXY=1`): sem isso, 10 senhas erradas de qualquer pessoa travariam o login de todos.
- Senha esquecida: o administrador define uma senha temporária em Pessoas → Nova senha.
- Backup diário do banco (`VACUUM INTO`), 14 dias, em `data/backups`.
- `/api/health` para o monitor de disponibilidade.

Pendente (decisão da Opps):
- Hospedagem e endereço (abaixo).
- Página de privacidade (LGPD): o sistema guarda dados de clientes e envia dados a operadores (hospedagem, Google, Meta, Anthropic). Texto a revisar pelo jurídico da Opps.
- Excluir conta: hoje a pessoa é desativada, não apagada. Pedido de exclusão (LGPD) é feito pelo administrador direto no banco, se houver.
- Ainda não tem: anexos, aviso de ajuste, recuperação de senha por e-mail.

## 2. Serviços de produção

| Serviço | Variáveis | Quem faz |
| --- | --- | --- |
| Hospedagem com disco persistente | `ADMIN_EMAIL`, `APP_URL` (ver `tarefas/.env.example`) | Opps cria a conta |
| E-mail Google Workspace | `SMTP_USER`, `SMTP_PASS` (senha de app), `SMTP_FROM` | Opps |
| WhatsApp (opcional) | `WHATSAPP_TOKEN`, `WHATSAPP_PHONE_ID` + 3 modelos aprovados | Opps |
| IA das atas (opcional) | `ANTHROPIC_API_KEY` | Opps |

## 3. Hospedagem e domínio

A definir.

## 4. Acompanhar na primeira semana

- `/api/health` num monitor de disponibilidade com alerta por e-mail.
- Tela Avisos: e-mails com "Falhou".
- Pasta de backups: uma cópia por dia; baixar uma por semana para fora do servidor.
