'use strict';
// Gera o protótipo em arquivo único: tarefas-prototipo.html (para baixar) e tarefas-pagina.html (para publicar no claude.ai).
const fs = require('node:fs');
const path = require('node:path');
const read = f => fs.readFileSync(path.join(__dirname, f), 'utf8');
const safe = js => js.replace(/<\/script/gi, '<\\/script');

const fonts = `<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700&display=swap">`;
const style = `<style>
${read('../public/styles.css')}
#demo-bar { position: relative; z-index: 45; background: #0b0f17; color: #ffffff; padding-block: 8px; padding-left: var(--gutter-l); padding-right: var(--gutter-r); display: flex; gap: 8px; align-items: center; flex-wrap: wrap; font-size: 13px; }
#demo-bar strong { margin-right: 4px; }
@media (min-width: 861px) { .sidebar { height: calc(100dvh - 44px); } }
#demo-bar span { color: #c5cad1; flex: 1; min-width: 200px; }
#demo-bar button { background: transparent; color: #ffffff; border: 1px solid #6b7280; border-radius: 6px; padding: 3px 10px; cursor: pointer; font: inherit; }
#demo-bar button:hover { background: #2a2f37; }
</style>`;

const body = `<div id="demo-bar" role="region" aria-label="Protótipo">
  <strong>Protótipo</strong>
  <span>Dados fictícios, salvos só neste navegador. Senha de todos: demo1234.</span>
  <button type="button" data-as="admin">Entrar como administrador</button>
  <button type="button" data-as="member">Entrar como equipe Opps</button>
  <button type="button" data-as="client">Entrar como cliente</button>
  <button type="button" data-reset>Restaurar dados</button>
</div>
<div id="app" aria-live="polite"></div>
<div id="toast" role="status" aria-live="polite"></div>
<script>
${safe(read('../shared.js'))}
</script>
<script>
${safe(read('mock-api.js'))}
</script>
<script>
${safe(read('../public/main.js'))}
</script>`;

// Arquivo para baixar e abrir no navegador.
const html = `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>Tarefas (protótipo)</title>
${fonts}
${style}
</head>
<body>
${body}
</body>
</html>
`;

// Página publicada no claude.ai: o publicador coloca o esqueleto (doctype, head, body).
const page = `<title>Tarefas da Consultoria</title>
<meta name="claude:viewport-fit-sides" content="cover">
${fonts}
${style}
${body}
`;

fs.writeFileSync(path.join(__dirname, 'tarefas-prototipo.html'), html);
fs.writeFileSync(path.join(__dirname, 'tarefas-pagina.html'), page);
console.log('prototype/tarefas-prototipo.html', Buffer.byteLength(html), 'bytes');
console.log('prototype/tarefas-pagina.html', Buffer.byteLength(page), 'bytes');
