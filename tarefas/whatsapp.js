'use strict';
// WhatsApp pela API oficial da Meta (WhatsApp Business Platform, Cloud API).
// Mensagens iniciadas pela empresa precisam de modelos aprovados pela Meta; os nomes e os
// parâmetros esperados de cada modelo estão em TEMPLATES e no README.
const TEMPLATES = {
  created: { env: 'WHATSAPP_TEMPLATE_CREATED', name: 'tarefa_criada' },
  due: { env: 'WHATSAPP_TEMPLATE_DUE', name: 'tarefa_vencendo' },
  overdue: { env: 'WHATSAPP_TEMPLATE_DUE', name: 'tarefa_vencendo' },
  weekly: { env: 'WHATSAPP_TEMPLATE_WEEKLY', name: 'resumo_semanal' },
};

function config(env = process.env) {
  if (!env.WHATSAPP_TOKEN || !env.WHATSAPP_PHONE_ID) return null;
  return {
    token: env.WHATSAPP_TOKEN,
    phoneId: env.WHATSAPP_PHONE_ID,
    version: env.WHATSAPP_API_VERSION || 'v21.0',
    language: env.WHATSAPP_LANGUAGE || 'pt_BR',
    template: kind => env[TEMPLATES[kind].env] || TEMPLATES[kind].name,
  };
}

// Número só com dígitos e DDI (ex.: 5511987654321). Aceita "(11) 98765-4321" e completa o 55.
function normalizePhone(raw) {
  if (raw === null || raw === undefined || raw === '') return null;
  let d = String(raw).replace(/\D/g, '');
  if (d.length === 10 || d.length === 11) d = '55' + d;
  return /^\d{12,15}$/.test(d) ? d : undefined;
}

async function send(cfg, { to, kind, params }, fetchImpl = fetch) {
  const res = await fetchImpl(`https://graph.facebook.com/${cfg.version}/${cfg.phoneId}/messages`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${cfg.token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      messaging_product: 'whatsapp', to, type: 'template',
      template: {
        name: cfg.template(kind), language: { code: cfg.language },
        components: [{ type: 'body', parameters: params.map(text => ({ type: 'text', text: String(text).slice(0, 900) })) }],
      },
    }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`WhatsApp ${res.status}: ${body.slice(0, 300)}`);
  }
}

module.exports = { config, send, normalizePhone, TEMPLATES };
