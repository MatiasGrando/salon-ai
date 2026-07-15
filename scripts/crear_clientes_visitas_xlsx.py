from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED
from xml.sax.saxutils import escape


OUTPUT = Path(__file__).resolve().parents[1] / "clientes_visitas.xlsx"

HEADERS = [
    "N°", "Cliente", "Teléfono", "Bot", "App / plataforma", "Landing",
    "Página para turnos", "Comentarios", "Verificado", "Fecha de visita",
]

ROWS = [
    [1, "Barber King ⚠️", "11-2183-1022", "No", "Dr. Turnos", "Sí / página de turnos", "app3.drturnos.com ⚠️"],
    [2, "DNA 070 ⚠️", "11-6861-5416", "No", "Sin dato", "Tiene página", "A confirmar"],
    [3, "Korte", "15-6912-8309", "No", "Sin dato", "Sin dato", "Sin dato"],
    [4, "Real Barber", "15-2662-0461", "No", "Sin dato", "Sin dato", "Sin dato"],
    [5, "Nmon Studio ⚠️", "15-3147-7676", "No / a confirmar", "Sin dato", "Sin dato", "Sin dato"],
    [6, "Peluquería Damián Breylin ⚠️", "11-5010-77??", "No", "Sin dato", "Sin dato", "Sin dato"],
    [7, "Barbería JC ⚠️", "Sin dato", "A confirmar", "Sin dato", "Sin dato", "Sin dato"],
    [8, "AM Barber", "11-3825-2468", "Sin dato", "Sin dato", "Sin dato", "Sin dato"],
    [9, "Sigman ⚠️", "11-3403-6451", "No", "Sin dato", "Sin dato", "Sin dato"],
    [10, "Mood Barber", "11-2280-235?", "Sin dato", "Sin dato", "Sin dato", "Sin dato"],
    [11, "Battista Studio", "Sin dato", "No", "Sin dato", "Sin dato", "Sin dato"],
    [12, "Sultan Barbería", "11-687?-3205 ⚠️", "Sin dato", "Sin dato", "Sin dato", "Sin dato"],
    [13, "Tesdercia Barbería ⚠️", "11-3600-5550", "No", "Sin dato", "Sin dato", "Sin dato"],
    [14, "Robin Cut", "11-6416-6102", "No", "Sin dato", "Sin dato", "Sin dato"],
    [15, "Barbería Apolo Barber Club", "11-6874-2838", "No", "Sin dato", "Sin dato", "Sin dato"],
    [16, "Barbería Prestigio", "11-7367-3974", "Sin dato", "Sin dato", "Sin dato", "Sin dato"],
    [17, "Barber Club", "11-2787-6747", "Sin dato", "Sin dato", "Sin dato", "Sin dato"],
    [18, "R. Turn Gate y Barbería ⚠️", "Sin dato", "Sin dato", "Fresha", "Sin dato", "Fresha"],
    [19, "Peluquería Dalestética Alisados ⚠️", "Sin dato", "No", "Sin dato", "Sin dato", "Sin dato"],
    [20, "Peluquería Generales Beauty ⚠️", "11-2389-7422", "No", "Sin dato", "Sin dato", "Sin dato"],
    [21, "Camilo Peluquería y Barbería", "11-5063-2664", "No", "Sin dato", "Sin dato", "Sin dato"],
    [22, "Barber Legado", "Sin dato", "Sin dato", "Sin dato", "Sí", "salonbello.com.ar ⚠️"],
    [23, "Peluquería Mis Ideas", "4571-7083", "Sin dato", "Sin dato", "Sin dato", "Sin dato"],
    [24, "María Morel Peluquería ⚠️", "11-5945-1620", "No", "Agora ⚠️", "Sin dato", "Agora ⚠️"],
    [25, "Estilo DF", "11-5143-6853", "No", "Sin dato", "Sin dato", "Sin dato"],
    [26, "Dos Locos Barbería", "11-4415-0972", "No", "Turnito", "Sin dato", "Turnito.app"],
    [27, "Barbería Fade Style “El Garage”", "11-2272-60??", "No", "Sin dato", "Sin dato", "Sin dato"],
    [28, "Vincent Barbería", "11-5349-7247", "No", "Sin dato", "Sin dato", "Sin dato"],
    [29, "Don Lucho Barbería", "11-7675-1134", "No", "Sin dato", "Sin dato", "Sin dato"],
    [30, "Barbería M2", "11-3847-0935", "No", "Sin dato", "Sin dato", "Sin dato"],
    [31, "Loco de Belleza", "11-6897-1514", "No", "Wembook ⚠️", "Sin dato", "Wembook ⚠️"],
    [32, "Six Pelu / Wayne ⚠️", "11-6874-1242", "No", "Sin dato", "Sin dato", "Sin dato"],
]


def col_name(number):
    name = ""
    while number:
        number, rem = divmod(number - 1, 26)
        name = chr(65 + rem) + name
    return name


def cell(ref, value, style=0):
    if isinstance(value, int):
        return f'<c r="{ref}" s="{style}"><v>{value}</v></c>'
    text = escape(str(value))
    return f'<c r="{ref}" s="{style}" t="inlineStr"><is><t>{text}</t></is></c>'


sheet_rows = []
sheet_rows.append('<row r="1" ht="28" customHeight="1">' + "".join(
    cell(f"{col_name(i)}1", value, 1) for i, value in enumerate(HEADERS, 1)
) + "</row>")

for r_idx, source in enumerate(ROWS, 2):
    values = source + ["", "Pendiente", ""]
    cells = []
    for c_idx, value in enumerate(values, 1):
        uncertain = "⚠️" in str(value) or "?" in str(value) or str(value) == "A confirmar"
        style = 2 if uncertain else 0
        cells.append(cell(f"{col_name(c_idx)}{r_idx}", value, style))
    sheet_rows.append(f'<row r="{r_idx}" ht="22" customHeight="1">' + "".join(cells) + "</row>")

sheet_xml = f'''<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>
  <cols>
    <col min="1" max="1" width="6" customWidth="1"/><col min="2" max="2" width="34" customWidth="1"/>
    <col min="3" max="3" width="19" customWidth="1"/><col min="4" max="4" width="18" customWidth="1"/>
    <col min="5" max="5" width="22" customWidth="1"/><col min="6" max="6" width="23" customWidth="1"/>
    <col min="7" max="7" width="28" customWidth="1"/><col min="8" max="8" width="40" customWidth="1"/>
    <col min="9" max="9" width="16" customWidth="1"/><col min="10" max="10" width="18" customWidth="1"/>
  </cols>
  <sheetData>{''.join(sheet_rows)}</sheetData>
  <autoFilter ref="A1:J{len(ROWS)+1}"/>
  <dataValidations count="1"><dataValidation type="list" allowBlank="1" sqref="I2:I{len(ROWS)+1}"><formula1>"Pendiente,Sí,No"</formula1></dataValidation></dataValidations>
</worksheet>'''

files = {
    "[Content_Types].xml": '''<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
</Types>''',
    "_rels/.rels": '''<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>''',
    "xl/workbook.xml": '''<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<sheets><sheet name="Clientes a visitar" sheetId="1" r:id="rId1"/></sheets></workbook>''',
    "xl/_rels/workbook.xml.rels": '''<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>''',
    "xl/styles.xml": '''<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><color rgb="FFFFFFFF"/><sz val="11"/><name val="Calibri"/></font></fonts>
<fills count="4"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF17365D"/><bgColor indexed="64"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFFFE699"/><bgColor indexed="64"/></patternFill></fill></fills>
<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="3"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment vertical="center" wrapText="1"/></xf><xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyAlignment="1"><alignment vertical="center" wrapText="1"/></xf><xf numFmtId="0" fontId="0" fillId="3" borderId="0" xfId="0" applyAlignment="1"><alignment vertical="center" wrapText="1"/></xf></cellXfs>
<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>''',
    "xl/worksheets/sheet1.xml": sheet_xml,
}

with ZipFile(OUTPUT, "w", ZIP_DEFLATED) as archive:
    for name, content in files.items():
        archive.writestr(name, content.encode("utf-8"))

print(OUTPUT)
