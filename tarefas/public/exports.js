'use strict';
// Exportação de relatórios para Excel (.xlsx) e PDF, sem bibliotecas: os dois formatos são montados aqui.
// Entrada comum: { title, subtitle, columns: [{ label, align, width }], rows: [[...]], footer }.
(function (root) {
  // ---------- ZIP (sem compressão) para o .xlsx ----------
  const CRC = (() => {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
    return t;
  })();
  const crc32 = bytes => { let c = 0xffffffff; for (const b of bytes) c = CRC[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const utf8 = s => new TextEncoder().encode(s);
  function zip(files) {
    const parts = [], central = [];
    let offset = 0;
    const u16 = n => [n & 0xff, (n >>> 8) & 0xff];
    const u32 = n => [n & 0xff, (n >>> 8) & 0xff, (n >>> 16) & 0xff, (n >>> 24) & 0xff];
    for (const f of files) {
      const name = utf8(f.name), data = utf8(f.data), crc = crc32(data);
      const head = [...u32(0x04034b50), ...u16(20), ...u16(0x0800), ...u16(0), ...u16(0), ...u16(0x21), ...u32(crc), ...u32(data.length), ...u32(data.length), ...u16(name.length), ...u16(0)];
      parts.push(new Uint8Array(head), name, data);
      central.push(new Uint8Array([...u32(0x02014b50), ...u16(20), ...u16(20), ...u16(0x0800), ...u16(0), ...u16(0), ...u16(0x21), ...u32(crc),
        ...u32(data.length), ...u32(data.length), ...u16(name.length), ...u16(0), ...u16(0), ...u16(0), ...u16(0), ...u32(0), ...u32(offset)]), name);
      offset += head.length + name.length + data.length;
    }
    const size = central.reduce((n, p) => n + p.length, 0);
    const end = new Uint8Array([...u32(0x06054b50), ...u16(0), ...u16(0), ...u16(files.length), ...u16(files.length), ...u32(size), ...u32(offset), ...u16(0)]);
    return new Blob([...parts, ...central, end], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  }

  // ---------- Excel ----------
  const xml = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '');
  const colName = i => { let s = ''; i++; while (i) { const m = (i - 1) % 26; s = String.fromCharCode(65 + m) + s; i = Math.floor((i - 1) / 26); } return s; };
  function xlsx(rep) {
    const cell = (v, r, c, style) => {
      const ref = `${colName(c)}${r}`;
      if (typeof v === 'number' && Number.isFinite(v)) return `<c r="${ref}"${style ? ` s="${style}"` : ''}><v>${v}</v></c>`;
      return `<c r="${ref}" t="inlineStr"${style ? ` s="${style}"` : ''}><is><t xml:space="preserve">${xml(v ?? '')}</t></is></c>`;
    };
    const rows = [];
    let r = 1;
    rows.push(`<row r="${r}">${cell(rep.title, r, 0, 2)}</row>`); r++;
    if (rep.subtitle) { rows.push(`<row r="${r}">${cell(rep.subtitle, r, 0)}</row>`); r++; }
    r++;
    const headRow = r;
    rows.push(`<row r="${r}">${rep.columns.map((c, i) => cell(c.label, r, i, 1)).join('')}</row>`); r++;
    for (const row of rep.rows) { rows.push(`<row r="${r}">${row.map((v, i) => cell(v, r, i)).join('')}</row>`); r++; }
    if (rep.footer) { r++; rows.push(`<row r="${r}">${cell(rep.footer, r, 0)}</row>`); }
    const widths = rep.columns.map((c, i) => Math.min(60, Math.max(c.label.length, ...rep.rows.map(row => String(row[i] ?? '').length)) + 2));
    const sheet = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView workbookViewId="0"><pane ySplit="${headRow}" topLeftCell="A${headRow + 1}" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>
<cols>${widths.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join('')}</cols>
<sheetData>${rows.join('')}</sheetData>
<autoFilter ref="A${headRow}:${colName(rep.columns.length - 1)}${headRow + rep.rows.length}"/></worksheet>`;
    const name = xml((rep.sheet || 'Relatório').slice(0, 31).replace(/[\\/?*[\]:]/g, ' '));
    return zip([
      { name: '[Content_Types].xml', data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>' },
      { name: '_rels/.rels', data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>' },
      { name: 'xl/workbook.xml', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="${name}" sheetId="1" r:id="rId1"/></sheets><definedNames><definedName name="_xlnm._FilterDatabase" localSheetId="0" hidden="1">'${name}'!$A$${headRow}:$${colName(rep.columns.length - 1)}$${headRow + rep.rows.length}</definedName></definedNames></workbook>` },
      { name: 'xl/_rels/workbook.xml.rels', data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>' },
      { name: 'xl/styles.xml', data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="3"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font><font><b/><sz val="14"/><name val="Calibri"/></font></fonts><fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FFD34211"/><bgColor indexed="64"/></patternFill></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="3"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/><xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>' },
      { name: 'xl/worksheets/sheet1.xml', data: sheet },
    ]);
  }

  // ---------- PDF (A4 deitado, Helvetica) ----------
  // Larguras aproximadas da Helvetica (em milésimos do tamanho), para cortar o texto que não cabe na coluna.
  const charW = ch => (/[ilIj.,:;'!|]/.test(ch) ? 260 : /[ftr()[\]\- ]/.test(ch) ? 320 : /[mwMW@]/.test(ch) ? 850 : /[A-Z]/.test(ch) ? 680 : /[0-9]/.test(ch) ? 556 : 520);
  const textW = (s, size, bold) => [...String(s)].reduce((n, ch) => n + charW(ch), 0) * size / 1000 * (bold ? 1.06 : 1);
  const WIN = { '–': 0x96, '—': 0x97, '…': 0x85, '•': 0x95, '“': 0x93, '”': 0x94, '‘': 0x91, '’': 0x92, '€': 0x80 };
  const pdfText = s => [...String(s)].map(ch => {
    const code = WIN[ch] ?? ch.charCodeAt(0);
    const c = code < 256 ? String.fromCharCode(code) : '?';
    return c === '(' || c === ')' || c === '\\' ? '\\' + c : c;
  }).join('');
  const fit = (s, size, max, bold) => {
    s = String(s ?? '');
    if (textW(s, size, bold) <= max) return s;
    while (s.length > 1 && textW(s + '…', size, bold) > max) s = s.slice(0, -1);
    return s + '…';
  };
  function pdf(rep) {
    const PW = 842, PH = 595, M = 36, rowH = 18, size = 8.5;
    const usable = PW - M * 2;
    // Largura das colunas: proporcional ao conteúdo, com mínimo e máximo.
    const want = rep.columns.map((c, i) => Math.min(260, Math.max(48, textW(c.label, size, true) + 12,
      ...rep.rows.slice(0, 300).map(r => textW(String(r[i] ?? ''), size) + 12))));
    // Cabe tudo: o espaço que sobra vai para as colunas de texto longo (as que bateram no máximo).
    const total = want.reduce((x, y) => x + y, 0);
    const capped = want.map((w, i) => w >= 260 || rep.rows.some(r => textW(String(r[i] ?? ''), size) + 12 > w));
    const widths = total > usable ? want.map(w => w * usable / total)
      : capped.some(Boolean) ? want.map((w, i) => (capped[i] ? w + (usable - total) / capped.filter(Boolean).length : w))
        : want.map(w => w * usable / total);
    const pages = [];
    let ops = [], y = 0, page = 0;
    const color = (r, g, b) => `${r} ${g} ${b}`;
    const txt = (x, yy, s, sz, bold, rgb = color(0.07, 0.09, 0.15)) => ops.push(`BT /${bold ? 'F2' : 'F1'} ${sz} Tf ${rgb} rg ${x.toFixed(1)} ${yy.toFixed(1)} Td (${pdfText(s)}) Tj ET`);
    const rect = (x, yy, w, hh, rgb) => ops.push(`${rgb} rg ${x.toFixed(1)} ${yy.toFixed(1)} ${w.toFixed(1)} ${hh.toFixed(1)} re f`);
    const header = () => {
      rect(0, PH - 8, PW, 8, color(0.984, 0.31, 0.078));
      txt(M, PH - 40, rep.title, 16, true);
      if (rep.subtitle) txt(M, PH - 58, fit(rep.subtitle, 9.5, usable), 9.5, false, color(0.36, 0.39, 0.46));
      y = PH - 80;
      rect(M, y - rowH + 5, usable, rowH, color(0.827, 0.259, 0.067));
      let x = M;
      rep.columns.forEach((c, i) => {
        const s = fit(c.label, size, widths[i] - 8, true);
        txt(c.align === 'right' ? x + widths[i] - 4 - textW(s, size, true) : x + 4, y - 7, s, size, true, color(1, 1, 1));
        x += widths[i];
      });
      y -= rowH;
    };
    const newPage = () => { if (ops.length) pages.push(ops); ops = []; page++; header(); };
    newPage();
    rep.rows.forEach((r, n) => {
      if (y < M + rowH) newPage();
      if (n % 2) rect(M, y - rowH + 5, usable, rowH, color(0.965, 0.969, 0.98));
      let x = M;
      r.forEach((v, i) => {
        const s = fit(v, size, widths[i] - 8);
        txt(rep.columns[i].align === 'right' ? x + widths[i] - 4 - textW(s, size) : x + 4, y - 7, s, size, false);
        x += widths[i];
      });
      y -= rowH;
    });
    if (!rep.rows.length) { txt(M + 4, y - 7, 'Nenhum dado com estes filtros.', size, false); y -= rowH; }
    if (rep.footer) { if (y < M + rowH * 2) newPage(); txt(M, y - 14, fit(rep.footer, 9, usable), 9, true); }
    pages.push(ops);
    // Monta o arquivo: catálogo, páginas, fontes e o rodapé com o número da página.
    const objs = [];
    const add = s => { objs.push(s); return objs.length; };
    const catalog = add(null), pagesId = add(null);
    const f1 = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');
    const f2 = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>');
    const kids = [];
    pages.forEach((p, i) => {
      const foot = `BT /F1 8 Tf 0.54 0.58 0.64 rg ${M} 18 Td (${pdfText(`${rep.brand || ''}  ·  Página ${i + 1} de ${pages.length}`)}) Tj ET`;
      const stream = p.concat(foot).join('\n');
      const content = add(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);
      kids.push(add(`<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 ${PW} ${PH}] /Resources << /Font << /F1 ${f1} 0 R /F2 ${f2} 0 R >> >> /Contents ${content} 0 R >>`));
    });
    objs[catalog - 1] = `<< /Type /Catalog /Pages ${pagesId} 0 R >>`;
    objs[pagesId - 1] = `<< /Type /Pages /Kids [${kids.map(k => `${k} 0 R`).join(' ')}] /Count ${kids.length} >>`;
    let out = '%PDF-1.4\n%\xe2\xe3\xcf\xd3\n';
    const offsets = [];
    objs.forEach((o, i) => { offsets.push(out.length); out += `${i + 1} 0 obj\n${o}\nendobj\n`; });
    const xref = out.length;
    out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offsets.map(o => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}`;
    out += `trailer\n<< /Size ${objs.length + 1} /Root ${catalog} 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
    const bytes = new Uint8Array(out.length);
    for (let i = 0; i < out.length; i++) bytes[i] = out.charCodeAt(i) & 0xff;
    return new Blob([bytes], { type: 'application/pdf' });
  }

  function download(blob, name) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = name; a.rel = 'noopener';
    document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  }

  root.Exports = { xlsx, pdf, download, zip, crc32 };
})(typeof self !== 'undefined' ? self : this);
