'use strict';
// "Hoje", os avisos de prazo e o resumo de segunda às 8h usam o fuso do processo: Brasília por padrão.
process.env.TZ = process.env.TZ || 'America/Sao_Paulo';
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { open, createOrg, createUser, seedDemo, backup, OPPS_SYMBOL } = require('./db');
const { createHandler } = require('./app');
const { createNotifier } = require('./notify');
const meetings = require('./meetings');

const file = process.env.DB_FILE || path.join(__dirname, 'data', 'tarefas.db');
fs.mkdirSync(path.dirname(file), { recursive: true });
const db = open(file);

// Primeira execução: cria a organização e o primeiro administrador.
if (!db.prepare('select 1 from orgs').get()) {
  if (process.env.DEMO === '1') {
    seedDemo(db);
    console.log('Dados de demonstração criados. Logins (senha demo1234): admin@demo.local, equipe@demo.local, analista@demo.local, cliente@demo.local');
  } else {
    const email = process.env.ADMIN_EMAIL;
    if (!email) {
      console.error('Primeira execução: defina ADMIN_EMAIL (e, se quiser, ADMIN_PASSWORD e ORG_NAME). Ou rode "npm run demo".');
      process.exit(1);
    }
    const password = process.env.ADMIN_PASSWORD || crypto.randomBytes(9).toString('base64url');
    const orgId = createOrg(db, process.env.ORG_NAME || 'Opps Consultoria');
    db.prepare('update orgs set logo = ? where id = ?').run(OPPS_SYMBOL, orgId);
    createUser(db, { orgId, name: 'Administrador', email, password, role: 'admin' });
    console.log(`Administrador criado: ${email}` + (process.env.ADMIN_PASSWORD ? '' : `, senha temporária: ${password} (troque no primeiro acesso)`));
  }
}

// Backup: uma cópia do banco por dia em BACKUP_DIR (padrão: data/backups ao lado do banco), guardando 14 dias.
// Copie essa pasta para fora do servidor de vez em quando (ou aponte BACKUP_DIR para um disco separado).
const backupDir = process.env.BACKUP_DIR || path.join(path.dirname(file), 'backups');
const runBackup = () => { try { const f = backup(db, backupDir); if (f) console.log(`Backup: ${f}`); } catch (e) { console.error('Backup falhou:', e.message); } };
runBackup();
setInterval(runBackup, 60 * 60e3).unref();

// Avisos. Na demonstração os e-mails são fictícios (@demo.local), então nada é enviado:
// os avisos ficam registrados na tela Avisos como "não enviado".
const demo = process.env.DEMO === '1';
const notifier = createNotifier(db, { env: demo ? { APP_URL: process.env.APP_URL } : process.env });
notifier.start();
const st = notifier.status();
console.log(`Avisos: e-mail ${st.email.configured ? 'ligado' : 'desligado'}, WhatsApp ${st.whatsapp.configured ? 'ligado' : 'desligado'}${demo ? ' (demonstração: nada é enviado)' : ''}`);

// Leitura das atas de reunião pela IA (Anthropic). Sem ANTHROPIC_API_KEY, a triagem funciona à mão.
const ai = meetings.config();
const extractor = ai && (args => meetings.extract(ai, args));
console.log(`Reuniões: leitura por IA ${ai ? 'ligada' : 'desligada (defina ANTHROPIC_API_KEY)'}`);

const port = Number(process.env.PORT) || 3000;
http.createServer(createHandler(db, { notifier, extractor })).listen(port, () => console.log(`Rodando em http://localhost:${port}`));
