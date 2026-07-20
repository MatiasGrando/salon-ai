import csv
import json
from collections import Counter
from datetime import datetime
from pathlib import Path


SOURCE = Path(r"C:\Users\cpu\Downloads\export_customer_list_2026-07-16.csv")
OUTPUT = Path(r"C:\Users\cpu\salon-ai\customer-list-2026-07-16.html")


def read_rows():
    with SOURCE.open("r", encoding="utf-8-sig", newline="") as handle:
        reader = csv.DictReader(handle)
        headers = reader.fieldnames or []
        rows = [
            row for row in reader
            if any((value or "").strip() for key, value in row.items() if key is not None)
        ]
    return headers, rows


def build_html(headers, rows):
    def cell(row, name):
        return (row.get(name) or "").strip()

    blocked = sum(cell(row, "Bloqueado").lower() in {"sí", "si", "yes"} for row in rows)
    with_email = sum(bool(cell(row, "Email")) for row in rows)
    with_mobile = sum(bool(cell(row, "Número de móvil")) for row in rows)
    marketing = sum(cell(row, "Aceptas las comunicaciones de marketing").lower() in {"sí", "si", "yes"} for row in rows)
    sources = Counter(cell(row, "Fuente de procedencia del cliente") or "Sin especificar" for row in rows)

    payload = json.dumps(
        {"headers": headers, "rows": rows},
        ensure_ascii=False,
        separators=(",", ":"),
    ).replace("</", "<\\/")
    generated = datetime.now().strftime("%d/%m/%Y %H:%M")
    top_sources = " · ".join(f"{name}: {count}" for name, count in sources.most_common(4))

    return f'''<!doctype html>
<html lang="es">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Listado de clientes · 16/07/2026</title>
  <style>
    :root {{
      color-scheme: light;
      --ink: #18201d;
      --muted: #64706b;
      --line: #dfe6e2;
      --paper: #ffffff;
      --canvas: #f4f7f5;
      --brand: #176b55;
      --brand-dark: #0e4d3d;
      --brand-soft: #e2f2ec;
      --warning: #a03c28;
      --shadow: 0 14px 34px rgba(28, 48, 41, .09);
    }}
    * {{ box-sizing: border-box; }}
    body {{ margin: 0; background: var(--canvas); color: var(--ink); font: 14px/1.45 Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }}
    .shell {{ width: min(100% - 32px, 1600px); margin: 28px auto 48px; }}
    .hero {{ display: flex; align-items: end; justify-content: space-between; gap: 24px; margin-bottom: 20px; }}
    .eyebrow {{ color: var(--brand); font-size: 12px; font-weight: 800; letter-spacing: .12em; text-transform: uppercase; }}
    h1 {{ margin: 5px 0 4px; font-size: clamp(28px, 4vw, 44px); line-height: 1.05; letter-spacing: -.035em; }}
    .subtitle {{ margin: 0; color: var(--muted); }}
    .meta {{ color: var(--muted); font-size: 12px; white-space: nowrap; }}
    .stats {{ display: grid; grid-template-columns: repeat(4, minmax(145px, 1fr)); gap: 12px; margin-bottom: 16px; }}
    .stat {{ padding: 17px 18px; background: var(--paper); border: 1px solid var(--line); border-radius: 16px; box-shadow: var(--shadow); }}
    .stat strong {{ display: block; font-size: 26px; letter-spacing: -.03em; }}
    .stat span {{ color: var(--muted); font-size: 12px; }}
    .panel {{ overflow: hidden; background: var(--paper); border: 1px solid var(--line); border-radius: 18px; box-shadow: var(--shadow); }}
    .toolbar {{ display: grid; grid-template-columns: minmax(230px, 1fr) auto auto; gap: 10px; padding: 14px; border-bottom: 1px solid var(--line); }}
    input, select, button {{ min-height: 42px; border: 1px solid var(--line); border-radius: 11px; background: #fff; color: var(--ink); font: inherit; }}
    input {{ width: 100%; padding: 0 14px; outline: none; }}
    input:focus, select:focus, button:focus-visible {{ border-color: var(--brand); box-shadow: 0 0 0 3px rgba(23,107,85,.14); outline: none; }}
    select, button {{ padding: 0 12px; cursor: pointer; }}
    button:hover {{ border-color: #b6c5bf; background: #f9fbfa; }}
    .filters {{ display: flex; flex-wrap: wrap; gap: 8px; padding: 0 14px 14px; border-bottom: 1px solid var(--line); }}
    .chip {{ min-height: 34px; padding: 0 12px; border-radius: 999px; color: var(--muted); }}
    .chip.active {{ border-color: var(--brand); background: var(--brand-soft); color: var(--brand-dark); font-weight: 700; }}
    .status {{ display: flex; justify-content: space-between; gap: 16px; padding: 10px 14px; color: var(--muted); font-size: 12px; }}
    .source-summary {{ overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }}
    .table-wrap {{ max-height: 68vh; overflow: auto; border-top: 1px solid var(--line); }}
    table {{ width: 100%; border-collapse: separate; border-spacing: 0; white-space: nowrap; }}
    th, td {{ max-width: 330px; padding: 11px 13px; border-bottom: 1px solid #edf1ef; border-right: 1px solid #f0f3f2; text-align: left; overflow: hidden; text-overflow: ellipsis; }}
    th {{ position: sticky; top: 0; z-index: 2; background: #f7faf8; color: #47534e; font-size: 11px; letter-spacing: .035em; text-transform: uppercase; cursor: pointer; user-select: none; }}
    th:hover {{ background: #eef5f1; }}
    tbody tr:hover td {{ background: #f7fbf9; }}
    td:first-child, th:first-child {{ position: sticky; left: 0; z-index: 1; background: var(--paper); }}
    th:first-child {{ z-index: 3; background: #f7faf8; }}
    .badge {{ display: inline-flex; align-items: center; min-height: 24px; padding: 0 9px; border-radius: 999px; background: #edf3f0; color: #53605a; font-size: 11px; font-weight: 700; }}
    .badge.yes {{ background: var(--brand-soft); color: var(--brand-dark); }}
    .badge.blocked {{ background: #fbe8e4; color: var(--warning); }}
    .empty {{ padding: 52px 20px; text-align: center; color: var(--muted); }}
    .pagination {{ display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 14px; border-top: 1px solid var(--line); }}
    .page-controls {{ display: flex; align-items: center; gap: 8px; }}
    button:disabled {{ opacity: .45; cursor: not-allowed; }}
    @media (max-width: 760px) {{
      .shell {{ width: min(100% - 18px, 1600px); margin-top: 16px; }}
      .hero {{ align-items: start; flex-direction: column; gap: 8px; }}
      .stats {{ grid-template-columns: 1fr 1fr; }}
      .toolbar {{ grid-template-columns: 1fr 1fr; }}
      .toolbar input {{ grid-column: 1 / -1; }}
      .source-summary {{ display: none; }}
    }}
  </style>
</head>
<body>
  <main class="shell">
    <header class="hero">
      <div>
        <div class="eyebrow">CRM · Exportación</div>
        <h1>Listado de clientes</h1>
        <p class="subtitle">Datos exportados el 16 de julio de 2026</p>
      </div>
      <div class="meta">HTML generado el {generated}</div>
    </header>

    <section class="stats" aria-label="Resumen">
      <article class="stat"><strong>{len(rows):,}</strong><span>clientes totales</span></article>
      <article class="stat"><strong>{with_mobile:,}</strong><span>con número móvil</span></article>
      <article class="stat"><strong>{with_email:,}</strong><span>con email</span></article>
      <article class="stat"><strong>{marketing:,}</strong><span>aceptan marketing</span></article>
    </section>

    <section class="panel">
      <div class="toolbar">
        <input id="search" type="search" placeholder="Buscar por nombre, teléfono, email, ciudad…" autocomplete="off">
        <select id="pageSize" aria-label="Filas por página">
          <option value="25">25 por página</option>
          <option value="50" selected>50 por página</option>
          <option value="100">100 por página</option>
          <option value="250">250 por página</option>
        </select>
        <button id="download" type="button">Descargar filtrados</button>
      </div>
      <div class="filters" aria-label="Filtros rápidos">
        <button class="chip active" data-filter="all" type="button">Todos</button>
        <button class="chip" data-filter="mobile" type="button">Con móvil</button>
        <button class="chip" data-filter="email" type="button">Con email</button>
        <button class="chip" data-filter="marketing" type="button">Aceptan marketing</button>
        <button class="chip" data-filter="blocked" type="button">Bloqueados ({blocked})</button>
      </div>
      <div class="status">
        <span id="resultCount"></span>
        <span class="source-summary">Principales fuentes: {top_sources}</span>
      </div>
      <div class="table-wrap">
        <table>
          <thead id="thead"></thead>
          <tbody id="tbody"></tbody>
        </table>
        <div id="empty" class="empty" hidden>No hay clientes que coincidan con la búsqueda.</div>
      </div>
      <div class="pagination">
        <span id="pageLabel"></span>
        <div class="page-controls">
          <button id="prev" type="button">Anterior</button>
          <button id="next" type="button">Siguiente</button>
        </div>
      </div>
    </section>
  </main>

  <script id="customer-data" type="application/json">{payload}</script>
  <script>
    const data = JSON.parse(document.getElementById('customer-data').textContent);
    const displayHeaders = data.headers.map(h => h === 'ldentificación del cliente' ? 'Identificación del cliente' : h);
    const search = document.getElementById('search');
    const tbody = document.getElementById('tbody');
    const thead = document.getElementById('thead');
    const pageSize = document.getElementById('pageSize');
    const resultCount = document.getElementById('resultCount');
    const pageLabel = document.getElementById('pageLabel');
    const empty = document.getElementById('empty');
    let page = 1;
    let filter = 'all';
    let sortIndex = data.headers.indexOf('Añadido');
    let sortDirection = -1;

    const normalize = value => String(value ?? '').normalize('NFD').replace(/[\\u0300-\\u036f]/g, '').toLowerCase();
    const yes = value => ['sí', 'si', 'yes'].includes(normalize(value).trim());
    const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, char => ({{'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}}[char]));

    thead.innerHTML = '<tr>' + displayHeaders.map((header, index) => `<th data-index="${{index}}" title="Ordenar por ${{escapeHtml(header)}}">${{escapeHtml(header)}} <span></span></th>`).join('') + '</tr>';

    function matchesQuickFilter(row) {{
      if (filter === 'mobile') return Boolean(row['Número de móvil']?.trim());
      if (filter === 'email') return Boolean(row['Email']?.trim());
      if (filter === 'marketing') return yes(row['Aceptas las comunicaciones de marketing']);
      if (filter === 'blocked') return yes(row['Bloqueado']);
      return true;
    }}

    function filteredRows() {{
      const query = normalize(search.value.trim());
      return data.rows
        .filter(matchesQuickFilter)
        .filter(row => !query || data.headers.some(header => normalize(row[header]).includes(query)))
        .sort((a, b) => {{
          const av = normalize(a[data.headers[sortIndex]]);
          const bv = normalize(b[data.headers[sortIndex]]);
          return av.localeCompare(bv, 'es', {{ numeric: true }}) * sortDirection;
        }});
    }}

    function renderCell(header, value) {{
      const safe = escapeHtml(value || '—');
      if (header === 'Bloqueado') return `<span class="badge ${{yes(value) ? 'blocked' : ''}}">${{safe}}</span>`;
      if (header.includes('marketing')) return `<span class="badge ${{yes(value) ? 'yes' : ''}}">${{safe}}</span>`;
      if (header === 'Email' && value) return `<a href="mailto:${{encodeURIComponent(value)}}">${{safe}}</a>`;
      if ((header === 'Número de móvil' || header === 'Teléfono') && value) return `<a href="tel:${{String(value).replace(/[^+\\d]/g, '')}}">${{safe}}</a>`;
      return safe;
    }}

    function render() {{
      const rows = filteredRows();
      const size = Number(pageSize.value);
      const totalPages = Math.max(1, Math.ceil(rows.length / size));
      page = Math.min(page, totalPages);
      const visible = rows.slice((page - 1) * size, page * size);

      tbody.innerHTML = visible.map(row => '<tr>' + data.headers.map(header => `<td title="${{escapeHtml(row[header])}}">${{renderCell(header, row[header])}}</td>`).join('') + '</tr>').join('');
      empty.hidden = rows.length !== 0;
      document.querySelector('table').hidden = rows.length === 0;
      resultCount.textContent = `${{rows.length.toLocaleString('es-AR')}} de ${{data.rows.length.toLocaleString('es-AR')}} clientes`;
      pageLabel.textContent = `Página ${{page}} de ${{totalPages}}`;
      document.getElementById('prev').disabled = page <= 1;
      document.getElementById('next').disabled = page >= totalPages;
      document.querySelectorAll('th span').forEach((span, index) => span.textContent = index === sortIndex ? (sortDirection === 1 ? '↑' : '↓') : '');
    }}

    function csvEscape(value) {{
      const text = String(value ?? '');
      return /[",\\n]/.test(text) ? `"${{text.replace(/"/g, '""')}}"` : text;
    }}

    search.addEventListener('input', () => {{ page = 1; render(); }});
    pageSize.addEventListener('change', () => {{ page = 1; render(); }});
    document.getElementById('prev').addEventListener('click', () => {{ page--; render(); }});
    document.getElementById('next').addEventListener('click', () => {{ page++; render(); }});
    document.querySelectorAll('.chip').forEach(button => button.addEventListener('click', () => {{
      document.querySelectorAll('.chip').forEach(chip => chip.classList.remove('active'));
      button.classList.add('active');
      filter = button.dataset.filter;
      page = 1;
      render();
    }}));
    thead.addEventListener('click', event => {{
      const th = event.target.closest('th');
      if (!th) return;
      const index = Number(th.dataset.index);
      sortDirection = sortIndex === index ? sortDirection * -1 : 1;
      sortIndex = index;
      render();
    }});
    document.getElementById('download').addEventListener('click', () => {{
      const rows = filteredRows();
      const csv = '\\ufeff' + [data.headers, ...rows.map(row => data.headers.map(header => row[header]))].map(line => line.map(csvEscape).join(',')).join('\\r\\n');
      const url = URL.createObjectURL(new Blob([csv], {{ type: 'text/csv;charset=utf-8' }}));
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = 'clientes-filtrados.csv';
      anchor.click();
      URL.revokeObjectURL(url);
    }});

    render();
  </script>
</body>
</html>'''


def main():
    headers, rows = read_rows()
    OUTPUT.write_text(build_html(headers, rows), encoding="utf-8")
    print(f"Created {OUTPUT} with {len(rows)} rows and {len(headers)} columns")


if __name__ == "__main__":
    main()
