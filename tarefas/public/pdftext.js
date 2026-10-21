'use strict';
// Texto de um PDF, sem bibliotecas: lê as páginas em ordem, descomprime o conteúdo e traduz as letras
// pelas tabelas das fontes (ToUnicode). Feito para os PDFs que o Google Docs gera (as "Anotações do
// Gemini" do Meet). Usado no navegador (DecompressionStream) e nos testes (zlib).
(function (root) {
  const latin1 = bytes => { let s = ''; for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000)); return s; };

  async function inflateBrowser(bytes) {
    const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate'));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  }

  function parseCMap(text) {
    const map = new Map();
    const hex = h => parseInt(h, 16);
    const uni = h => { let s = ''; for (let i = 0; i < h.length; i += 4) s += String.fromCharCode(hex(h.slice(i, i + 4))); return s; };
    for (const block of text.matchAll(/beginbfchar([\s\S]*?)endbfchar/g)) {
      for (const m of block[1].matchAll(/<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]+)>/g)) map.set(hex(m[1]), uni(m[2]));
    }
    for (const block of text.matchAll(/beginbfrange([\s\S]*?)endbfrange/g)) {
      for (const m of block[1].matchAll(/<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]+)>\s*(\[[^\]]*\]|<[0-9a-fA-F]+>)/g)) {
        const lo = hex(m[1]), hi = hex(m[2]);
        if (m[3][0] === '[') {
          const list = [...m[3].matchAll(/<([0-9a-fA-F]+)>/g)].map(x => uni(x[1]));
          for (let c = lo; c <= hi && c - lo < list.length; c++) map.set(c, list[c - lo]);
        } else {
          const base = hex(m[3].slice(1, -1));
          for (let c = lo; c <= hi; c++) map.set(c, String.fromCharCode(base + c - lo));
        }
      }
    }
    return map;
  }

  // Lexer do conteúdo da página: números, nomes, textos (literais e hexadecimais), listas e operadores.
  function* tokens(s) {
    let i = 0;
    const n = s.length;
    while (i < n) {
      const c = s[i];
      if (c <= ' ') { i++; continue; }
      if (c === '%') { while (i < n && s[i] !== '\n' && s[i] !== '\r') i++; continue; }
      if (c === '(') {
        let depth = 1, out = ''; i++;
        while (i < n && depth) {
          const ch = s[i++];
          if (ch === '\\') {
            const e = s[i++];
            if (e === 'n') out += '\n'; else if (e === 'r') out += '\r'; else if (e === 't') out += '\t';
            else if (e === 'b' || e === 'f') out += ''; else if (/[0-7]/.test(e)) { let o = e; while (o.length < 3 && /[0-7]/.test(s[i])) o += s[i++]; out += String.fromCharCode(parseInt(o, 8)); }
            else if (e === '\n' || e === '\r') { if (e === '\r' && s[i] === '\n') i++; } else out += e;
          } else if (ch === '(') { depth++; out += ch; } else if (ch === ')') { if (--depth) out += ch; } else out += ch;
        }
        yield { t: 'str', v: out }; continue;
      }
      if (c === '<' && s[i + 1] === '<') { i += 2; yield { t: 'op', v: '<<' }; continue; }
      if (c === '>' && s[i + 1] === '>') { i += 2; yield { t: 'op', v: '>>' }; continue; }
      if (c === '<') {
        const e = s.indexOf('>', i);
        let h = s.slice(i + 1, e).replace(/\s+/g, ''); if (h.length % 2) h += '0';
        let out = ''; for (let k = 0; k < h.length; k += 2) out += String.fromCharCode(parseInt(h.slice(k, k + 2), 16));
        i = e + 1; yield { t: 'str', v: out }; continue;
      }
      if (c === '[' || c === ']') { i++; yield { t: c }; continue; }
      if (c === '/') { let j = i + 1; while (j < n && !/[\s/[\]<>(){}%]/.test(s[j])) j++; yield { t: 'name', v: s.slice(i + 1, j) }; i = j; continue; }
      let j = i; while (j < n && !/[\s/[\]<>(){}%]/.test(s[j])) j++;
      const w = s.slice(i, j) || s[i]; i = j > i ? j : i + 1;
      if (/^[+-]?(\d+\.?\d*|\.\d+)$/.test(w)) yield { t: 'num', v: parseFloat(w) }; else yield { t: 'op', v: w };
    }
  }

  const mul = (a, b) => [a[0] * b[0] + a[1] * b[2], a[0] * b[1] + a[1] * b[3], a[2] * b[0] + a[3] * b[2], a[2] * b[1] + a[3] * b[3],
    a[4] * b[0] + a[5] * b[2] + b[4], a[4] * b[1] + a[5] * b[3] + b[5]];

  async function pdfText(bytes, { inflate = inflateBrowser, maxPages = 400, until } = {}) {
    const src = latin1(bytes);
    const offsets = new Map();
    for (const m of src.matchAll(/(?:^|[\r\n\s])(\d+)\s+(\d+)\s+obj\b/g)) offsets.set(Number(m[1]), m.index + m[0].length);
    const body = n => { const at = offsets.get(n); if (at === undefined) return ''; const e = src.indexOf('endobj', at); return src.slice(at, e < 0 ? undefined : e); };
    const dictOf = n => { const b = body(n); const k = b.indexOf('stream'); return k >= 0 ? b.slice(0, k) : b; };
    const ref = (dict, key) => { const m = new RegExp(`/${key}\\s+(\\d+)\\s+\\d+\\s+R`).exec(dict); return m ? Number(m[1]) : null; };
    async function streamOf(n) {
      const b = body(n); const k = b.indexOf('stream'); if (k < 0) return '';
      let s = k + 6; if (b[s] === '\r') s++; if (b[s] === '\n') s++;
      const dict = b.slice(0, k);
      const lenM = /\/Length\s+(\d+)(\s+\d+\s+R)?/.exec(dict);
      let len = lenM && !lenM[2] ? Number(lenM[1]) : b.lastIndexOf('endstream') - s;
      if (lenM && lenM[2]) { const ln = /^\s*(\d+)/.exec(body(Number(lenM[1]))); if (ln) len = Number(ln[1]); }
      const raw = Uint8Array.from(b.slice(s, s + len), ch => ch.charCodeAt(0));
      if (/\/FlateDecode/.test(dict)) return latin1(await inflate(raw));
      return latin1(raw);
    }
    // Páginas na ordem da árvore /Pages.
    const catalogM = /\/Type\s*\/Catalog[\s\S]*?\/Pages\s+(\d+)\s+\d+\s+R/.exec(src);
    const rootPages = catalogM ? Number(catalogM[1]) : null;
    const pages = [];
    const walk = n => {
      const d = dictOf(n);
      if (/\/Type\s*\/Pages\b/.test(d)) { const kids = /\/Kids\s*\[([^\]]*)\]/.exec(d); if (kids) for (const m of kids[1].matchAll(/(\d+)\s+\d+\s+R/g)) walk(Number(m[1])); }
      else pages.push(n);
    };
    if (rootPages) walk(rootPages);
    const fontCache = new Map();
    async function fontsOf(pageDict) {
      let res = /\/Resources\s*(<<[\s\S]*?>>\s*>>|\d+\s+\d+\s+R)/.exec(pageDict);
      let resText = res ? res[1] : '';
      const resRef = /^(\d+)\s+\d+\s+R$/.exec(resText.trim()); if (resRef) resText = dictOf(Number(resRef[1]));
      let fontDict = /\/Font\s*<<([\s\S]*?)>>/.exec(resText);
      let fd = fontDict ? fontDict[1] : '';
      const fRef = /\/Font\s+(\d+)\s+\d+\s+R/.exec(resText); if (!fontDict && fRef) fd = dictOf(Number(fRef[1]));
      const fonts = {};
      for (const m of fd.matchAll(/\/([^\s/]+)\s+(\d+)\s+\d+\s+R/g)) {
        const num = Number(m[2]);
        if (!fontCache.has(num)) {
          const d = dictOf(num);
          const tu = ref(d, 'ToUnicode');
          const two = /\/Subtype\s*\/Type0/.test(d);
          // Larguras das letras (milésimos do tamanho): /W da fonte descendente (Type0) ou /Widths (simples).
          const widths = new Map(); let dw = two ? 1000 : 500;
          if (two) {
            const desc = /\/DescendantFonts\s*\[\s*(\d+)\s+\d+\s+R/.exec(d);
            const dd = desc ? dictOf(Number(desc[1])) : '';
            const dwm = /\/DW\s+(\d+)/.exec(dd); if (dwm) dw = Number(dwm[1]);
            let w = /\/W\s*\[([\s\S]*?\])\s*\]/.exec(dd)?.[1] || '';
            const wr = /\/W\s+(\d+)\s+\d+\s+R/.exec(dd); if (wr) w = body(Number(wr[1])).replace(/^\s*\[|\]\s*$/g, '');
            const toks = w.match(/\[|\]|[\d.]+/g) || [];
            for (let i = 0; i < toks.length;) {
              const first = Number(toks[i++]);
              if (toks[i] === '[') { i++; let c = first; while (i < toks.length && toks[i] !== ']') widths.set(c++, Number(toks[i++])); i++; }
              else { const last = Number(toks[i++]), wv = Number(toks[i++]); for (let c = first; c <= last; c++) widths.set(c, wv); }
            }
          } else {
            const fc = /\/FirstChar\s+(\d+)/.exec(d), ws = /\/Widths\s*\[([^\]]*)\]/.exec(d);
            if (fc && ws) ws[1].trim().split(/\s+/).forEach((v, k) => widths.set(Number(fc[1]) + k, Number(v)));
          }
          fontCache.set(num, { two, widths, dw, map: tu ? parseCMap(await streamOf(tu)) : null });
        }
        fonts[m[1]] = fontCache.get(num);
      }
      return fonts;
    }
    const decode = (font, str) => {
      if (!font) return str;
      let out = '';
      if (font.two) { for (let i = 0; i + 1 < str.length; i += 2) { const c = (str.charCodeAt(i) << 8) | str.charCodeAt(i + 1); out += font.map?.get(c) ?? ''; } }
      else for (const ch of str) out += font.map?.get(ch.charCodeAt(0)) ?? ch;
      return out;
    };

    const lines = [];
    for (const p of pages.slice(0, maxPages)) {
      const pd = dictOf(p);
      const fonts = await fontsOf(pd);
      const contents = [];
      const cArr = /\/Contents\s*\[([^\]]*)\]/.exec(pd);
      if (cArr) for (const m of cArr[1].matchAll(/(\d+)\s+\d+\s+R/g)) contents.push(Number(m[1]));
      else { const c = ref(pd, 'Contents'); if (c) contents.push(c); }
      let content = '';
      for (const c of contents) content += (await streamOf(c)) + '\n';
      // Posição de cada pedaço de texto na página; depois, linhas por altura.
      const runs = [];
      let ctm = [1, 0, 0, 1, 0, 0];
      const stack = [];
      let tm = [1, 0, 0, 1, 0, 0], tlm = tm, font = null, size = 12, leading = 0;
      let args = [];
      const show = str => {
        const text = decode(font, str);
        const m = mul(tm, ctm);
        // Avanço do texto (para saber onde ele termina e se há espaço até o próximo pedaço).
        let w = 0;
        if (font) {
          if (font.two) for (let i = 0; i + 1 < str.length; i += 2) w += font.widths.get((str.charCodeAt(i) << 8) | str.charCodeAt(i + 1)) ?? font.dw;
          else for (const ch of str) w += font.widths.get(ch.charCodeAt(0)) ?? font.dw;
        } else w = str.length * 500;
        const scale = Math.hypot(m[0], m[1]) || 1;
        const adv = (w / 1000) * size * scale;
        tm = mul([1, 0, 0, 1, (w / 1000) * size, 0], tm);
        if (text) runs.push({ x: m[4], y: m[5], h: Math.abs(size * scale) || size, adv, text });
      };
      for (const tok of tokens(content)) {
        if (tok.t === 'op') {
          const op = tok.v, a = args;
          if (op === 'q') stack.push(ctm);
          else if (op === 'Q') ctm = stack.pop() || [1, 0, 0, 1, 0, 0];
          else if (op === 'cm' && a.length >= 6) ctm = mul(a.slice(-6), ctm);
          else if (op === 'BT') { tm = tlm = [1, 0, 0, 1, 0, 0]; }
          else if (op === 'Tf') { font = fonts[a[a.length - 2]] || null; size = a[a.length - 1] || size; }
          else if (op === 'TL') leading = a[0];
          else if (op === 'Tm' && a.length >= 6) { tm = tlm = a.slice(-6); }
          else if (op === 'Td' || op === 'TD') { if (op === 'TD') leading = -a[1]; tlm = mul([1, 0, 0, 1, a[0], a[1]], tlm); tm = tlm; }
          else if (op === 'T*') { tlm = mul([1, 0, 0, 1, 0, -leading], tlm); tm = tlm; }
          else if (op === 'Tj') { if (typeof a[a.length - 1] === 'string') show(a[a.length - 1]); }
          else if (op === "'" || op === '"') { tlm = mul([1, 0, 0, 1, 0, -leading], tlm); tm = tlm; if (typeof a[a.length - 1] === 'string') show(a[a.length - 1]); }
          else if (op === 'TJ') { const arr = a[a.length - 1]; if (Array.isArray(arr)) show(arr.filter(x => typeof x === 'string').join('')); }
          args = [];
        } else if (tok.t === '[') { args.push('['); }
        else if (tok.t === ']') { const k = args.lastIndexOf('['); const arr = args.slice(k + 1); args = args.slice(0, k); args.push(arr); }
        else if (tok.t === 'name') args.push(tok.v);
        else if (tok.t === 'str' || tok.t === 'num') args.push(tok.v);
      }
      // Agrupa por linha (mesma altura) mantendo a ordem em que foram desenhados.
      let line = null;
      for (const r of runs) {
        if (line && Math.abs(r.y - line.y) <= Math.max(2, line.h * 0.4)) {
          const gap = r.x - line.end;
          if (gap > line.h * 0.15 && !/\s$/.test(line.text) && !/^\s/.test(r.text)) line.text += ' ';
          line.text += r.text; line.end = r.x + r.adv;
        } else {
          if (line) lines.push(line.text);
          line = { y: r.y, h: r.h, text: r.text, end: r.x + r.adv };
        }
      }
      if (line) lines.push(line.text);
      lines.push('');
      if (until && until(lines)) break;
    }
    return lines.join('\n').normalize('NFKC').replace(/[\u200b\u00a0]/g, ' ').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n');
  }

  root.PdfText = { pdfText, parseCMap };
})(typeof self !== 'undefined' ? self : this);
