'use strict';
// Gera prototype/tarefas-prototipo.html: a interface real (public/) com a API do protótipo, num arquivo só.
const fs = require('node:fs');
const path = require('node:path');
const read = f => fs.readFileSync(path.join(__dirname, f), 'utf8');
const safe = js => js.replace(/<\/script/gi, '<\\/script');

const html = `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Tarefas (protótipo)</title>
<style>
${read('../public/styles.css')}
#demo-bar { background: #15181d; color: #fff; padding: 8px 16px; display: flex; gap: 8px; align-items: center; flex-wrap: wrap; font-size: 13px; }
#demo-bar strong { margin-right: 4px; }
#demo-bar span { color: #c5cad1; flex: 1; min-width: 200px; }
#demo-bar button { background: transparent; color: #fff; border: 1px solid #6b7280; border-radius: 6px; padding: 3px 10px; cursor: pointer; font: inherit; }
#demo-bar button:hover { background: #2a2f37; }
</style>
</head>
<body>
<div id="demo-bar" role="region" aria-label="Protótipo">
  <strong>Protótipo</strong>
  <span>Dados fictícios, salvos só neste navegador. Senha de todos: demo1234.</span>
  <button type="button" data-as="admin">Entrar como administrador</button>
  <button type="button" data-as="member">Entrar como equipe</button>
  <button type="button" data-as="client">Entrar como cliente</button>
  <button type="button" data-reset>Restaurar dados</button>
</div>
<div id="app" aria-live="polite"></div>
<div id="toast" role="status" aria-live="polite"></div>
<script>
${safe(read('mock-api.js'))}
</script>
<script>
${safe(read('../public/main.js'))}
</script>
</body>
</html>
`;
fs.writeFileSync(path.join(__dirname, 'tarefas-prototipo.html'), html);
console.log('prototype/tarefas-prototipo.html', Buffer.byteLength(html), 'bytes');
