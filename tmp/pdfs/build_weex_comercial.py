from reportlab.lib.colors import HexColor
from reportlab.lib.enums import TA_CENTER, TA_LEFT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.platypus import (
    BaseDocTemplate,
    Frame,
    KeepTogether,
    NextPageTemplate,
    PageBreak,
    PageTemplate,
    Paragraph,
    Spacer,
    Table,
    TableStyle,
)


OUTPUT = r"C:\Users\cpu\salon-ai\output\pdf\weex-presentacion-comercial.pdf"

PAGE_W, PAGE_H = A4
INK = HexColor("#17140F")
CREAM = HexColor("#F6F0E4")
PAPER = HexColor("#FFFCF6")
GOLD = HexColor("#C89E45")
GOLD_LIGHT = HexColor("#E8D4A2")
GREEN = HexColor("#2F6956")
MUTED = HexColor("#665F54")
LINE = HexColor("#DED3BF")
WHITE = HexColor("#FFFFFF")

styles = getSampleStyleSheet()

eyebrow = ParagraphStyle(
    "Eyebrow", parent=styles["Normal"], fontName="Helvetica-Bold", fontSize=9,
    leading=11, textColor=GOLD, tracking=1.5, spaceAfter=7,
)
title = ParagraphStyle(
    "Title", parent=styles["Title"], fontName="Helvetica-Bold", fontSize=29,
    leading=32, textColor=INK, alignment=TA_LEFT, spaceAfter=13,
)
cover_title = ParagraphStyle(
    "CoverTitle", parent=title, fontSize=38, leading=41, textColor=WHITE,
    alignment=TA_CENTER, spaceAfter=16,
)
cover_sub = ParagraphStyle(
    "CoverSub", parent=styles["Normal"], fontName="Helvetica", fontSize=15,
    leading=21, textColor=GOLD_LIGHT, alignment=TA_CENTER,
)
lead = ParagraphStyle(
    "Lead", parent=styles["Normal"], fontName="Helvetica", fontSize=13.2,
    leading=19, textColor=MUTED, spaceAfter=14,
)
body = ParagraphStyle(
    "Body", parent=styles["Normal"], fontName="Helvetica", fontSize=10.5,
    leading=15, textColor=INK, spaceAfter=8,
)
body_small = ParagraphStyle(
    "BodySmall", parent=body, fontSize=9.2, leading=12.6, spaceAfter=0,
)
card_title = ParagraphStyle(
    "CardTitle", parent=body, fontName="Helvetica-Bold", fontSize=10.5,
    leading=13, textColor=INK, spaceAfter=4,
)
quote = ParagraphStyle(
    "Quote", parent=styles["Normal"], fontName="Helvetica-Bold", fontSize=17,
    leading=22, textColor=INK, alignment=TA_LEFT,
)
promise_title = ParagraphStyle(
    "PromiseTitle", parent=title, fontSize=26, leading=29,
)
cta = ParagraphStyle(
    "CTA", parent=styles["Normal"], fontName="Helvetica-Bold", fontSize=13,
    leading=17, textColor=WHITE, alignment=TA_CENTER,
)
footer_style = ParagraphStyle(
    "Footer", parent=styles["Normal"], fontName="Helvetica", fontSize=8,
    leading=10, textColor=HexColor("#9A9182"),
)
point_num = ParagraphStyle(
    "PointNum", parent=body, fontName="Helvetica-Bold", fontSize=13,
    textColor=WHITE, alignment=TA_CENTER, leading=15,
)
ab_label = ParagraphStyle(
    "ABLabel", parent=body_small, fontName="Helvetica-Bold", fontSize=8,
    leading=10, textColor=GREEN,
)


def page_background(canvas, doc):
    canvas.saveState()
    canvas.setFillColor(PAPER)
    canvas.rect(0, 0, PAGE_W, PAGE_H, fill=1, stroke=0)
    canvas.setFillColor(INK)
    canvas.rect(0, PAGE_H - 9 * mm, PAGE_W, 9 * mm, fill=1, stroke=0)
    canvas.setFillColor(GOLD)
    canvas.circle(16 * mm, PAGE_H - 4.5 * mm, 1.5 * mm, fill=1, stroke=0)
    canvas.setFont("Helvetica-Bold", 8)
    canvas.setFillColor(WHITE)
    canvas.drawString(21 * mm, PAGE_H - 6.2 * mm, "WEEX")
    canvas.setFont("Helvetica", 8)
    canvas.setFillColor(HexColor("#8F877A"))
    canvas.drawRightString(PAGE_W - 16 * mm, 10 * mm, f"WEEX  ·  {doc.page}")
    canvas.restoreState()


def cover_background(canvas, doc):
    canvas.saveState()
    canvas.setFillColor(INK)
    canvas.rect(0, 0, PAGE_W, PAGE_H, fill=1, stroke=0)
    canvas.setFillColor(HexColor("#201B14"))
    canvas.circle(PAGE_W * 0.88, PAGE_H * 0.84, 75 * mm, fill=1, stroke=0)
    canvas.setStrokeColor(GOLD)
    canvas.setLineWidth(1.2)
    canvas.circle(PAGE_W * 0.88, PAGE_H * 0.84, 54 * mm, fill=0, stroke=1)
    canvas.setFillColor(GOLD)
    canvas.circle(PAGE_W * 0.12, PAGE_H * 0.13, 16 * mm, fill=1, stroke=0)
    canvas.restoreState()


doc = BaseDocTemplate(
    OUTPUT, pagesize=A4, leftMargin=18 * mm, rightMargin=18 * mm,
    topMargin=20 * mm, bottomMargin=17 * mm,
    title="Weex - Presentación comercial",
    author="Weex",
)

cover_frame = Frame(22 * mm, 28 * mm, PAGE_W - 44 * mm, PAGE_H - 56 * mm, id="cover")
body_frame = Frame(18 * mm, 17 * mm, PAGE_W - 36 * mm, PAGE_H - 38 * mm, id="body")
doc.addPageTemplates([
    PageTemplate(id="Cover", frames=[cover_frame], onPage=cover_background),
    PageTemplate(id="Body", frames=[body_frame], onPage=page_background),
])


def feature_card(text):
    return Table(
        [[Paragraph("|", ParagraphStyle("Dot", parent=body, fontName="Helvetica-Bold", textColor=GOLD, fontSize=13, leading=13)),
          Paragraph(text, body_small)]],
        colWidths=[8 * mm, 73 * mm],
        style=TableStyle([
            ("BACKGROUND", (0, 0), (-1, -1), CREAM),
            ("BOX", (0, 0), (-1, -1), 0.6, LINE),
            ("VALIGN", (0, 0), (-1, -1), "TOP"),
            ("LEFTPADDING", (0, 0), (-1, -1), 7),
            ("RIGHTPADDING", (0, 0), (-1, -1), 7),
            ("TOPPADDING", (0, 0), (-1, -1), 8),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 8),
        ]),
    )


def transformation_row(number, before, after):
    number_cell = Table(
        [[Paragraph(str(number), point_num)]], colWidths=[10 * mm], rowHeights=[10 * mm],
        style=TableStyle([
            ("BACKGROUND", (0, 0), (-1, -1), GREEN),
            ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
            ("ALIGN", (0, 0), (-1, -1), "CENTER"),
        ]),
    )
    before_cell = [Paragraph("PUNTO A", ab_label), Paragraph(before, body_small)]
    after_cell = [Paragraph("PUNTO B", ab_label), Paragraph(after, body_small)]
    row = Table(
        [[number_cell, before_cell, Paragraph(">", ParagraphStyle("Arrow", parent=body, fontName="Helvetica-Bold", fontSize=15, textColor=GOLD, alignment=TA_CENTER)), after_cell]],
        colWidths=[13 * mm, 64 * mm, 10 * mm, 76 * mm],
        style=TableStyle([
            ("BACKGROUND", (0, 0), (-1, -1), WHITE),
            ("BOX", (0, 0), (-1, -1), 0.6, LINE),
            ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
            ("LEFTPADDING", (0, 0), (-1, -1), 7),
            ("RIGHTPADDING", (0, 0), (-1, -1), 7),
            ("TOPPADDING", (0, 0), (-1, -1), 7),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 7),
        ]),
    )
    return KeepTogether([row, Spacer(1, 5)])


story = []

# Cover
story += [
    Spacer(1, 48 * mm),
    Paragraph("WEEX", ParagraphStyle("Brand", parent=eyebrow, fontSize=12, textColor=GOLD, alignment=TA_CENTER, tracking=3)),
    Spacer(1, 8 * mm),
    Paragraph("Presentación comercial", cover_title),
    Paragraph("Una propuesta para emprendedores de servicios y terapeutas", cover_sub),
    Spacer(1, 26 * mm),
    Table(
        [[Paragraph("Conversaciones automatizadas", cta)],
         [Paragraph("Reservas  ·  Agenda  ·  Clientes  ·  Seguimiento", ParagraphStyle("CoverTags", parent=cover_sub, fontSize=10, leading=14))]],
        colWidths=[125 * mm],
        style=TableStyle([
            ("BOX", (0, 0), (-1, -1), 0.8, GOLD),
            ("BACKGROUND", (0, 0), (-1, -1), HexColor("#231E17")),
            ("TOPPADDING", (0, 0), (-1, 0), 11),
            ("BOTTOMPADDING", (0, 0), (-1, 0), 5),
            ("TOPPADDING", (0, 1), (-1, 1), 3),
            ("BOTTOMPADDING", (0, 1), (-1, 1), 11),
        ]),
    ),
    Spacer(1, 25 * mm),
    Paragraph("Lanzamiento previsto en 20 a 30 días", ParagraphStyle("Launch", parent=cover_sub, fontName="Helvetica-Bold", fontSize=11, textColor=WHITE)),
    NextPageTemplate("Body"),
    PageBreak(),
]

# Page 2
story += [
    Paragraph("01  ·  PRESENTACIÓN DEL PROYECTO", eyebrow),
    Paragraph("Tu trabajo merece crecer sin que la organización te quite tiempo.", title),
    Paragraph(
        "Estamos creando <b>Weex</b>, una plataforma pensada para emprendedores de servicios y terapeutas que hoy organizan sus turnos, clientes y consultas entre WhatsApp, Instagram, cuadernos, calendarios y planillas.",
        lead,
    ),
    Paragraph("Con Weex vas a poder reunir en un solo lugar:", card_title),
    Spacer(1, 2 * mm),
]

features = [
    "Tu página profesional para mostrar quién sos y qué ofrecés.",
    "Reservas online disponibles las 24 horas.",
    "Agenda, horarios y disponibilidad.",
    "Información e historial de tus clientes.",
    "Conversaciones automatizadas en WhatsApp e Instagram.",
    "Recordatorios y herramientas para ordenar y hacer crecer tu actividad.",
]
for i in range(0, len(features), 2):
    story.append(Table([[feature_card(features[i]), feature_card(features[i + 1])]], colWidths=[84 * mm, 84 * mm], hAlign="LEFT",
                       style=TableStyle([("VALIGN", (0, 0), (-1, -1), "TOP"), ("LEFTPADDING", (0, 0), (-1, -1), 0), ("RIGHTPADDING", (0, 0), (-1, -1), 3), ("BOTTOMPADDING", (0, 0), (-1, -1), 6)])))

story += [
    Spacer(1, 3 * mm),
    Paragraph("Nuestro objetivo es simple: que dediques menos tiempo a administrar y más tiempo a acompañar a tus clientes, brindar tus servicios y desarrollar tu proyecto.", body),
    Paragraph("Estamos preparando el primer lanzamiento para dentro de <b>20 a 30 días</b> y buscamos emprendedores y terapeutas que quieran ser parte de esta primera etapa.", body),
    Spacer(1, 3 * mm),
    Table([[Paragraph("SUMATE A LA LISTA DE LANZAMIENTO DE WEEX", cta)]], colWidths=[169 * mm],
          style=TableStyle([("BACKGROUND", (0, 0), (-1, -1), GREEN), ("TOPPADDING", (0, 0), (-1, -1), 11), ("BOTTOMPADDING", (0, 0), (-1, -1), 11)])),
    Spacer(1, 3 * mm),
    Paragraph("Tendrás prioridad de acceso, novedades antes del lanzamiento y la posibilidad de ayudarnos a construir una herramienta adaptada a tu forma de trabajar. Anotarte no te obliga a contratar el servicio.", footer_style),
    PageBreak(),
]

# Page 3
story += [
    Paragraph("02  ·  PROMESA DE VENTA", eyebrow),
    Paragraph("Más consultas atendidas. Más reservas. Menos tiempo frente al celular.", promise_title),
    Spacer(1, 3 * mm),
    Table(
        [[Paragraph("“Con Weex vas a convertir más consultas en clientes y recuperar tiempo para tu profesión, automatizando las conversaciones de WhatsApp e Instagram, las reservas, los recordatorios y el seguimiento, todo desde un solo lugar.”", quote)]],
        colWidths=[155 * mm], hAlign="CENTER",
        style=TableStyle([
            ("BACKGROUND", (0, 0), (-1, -1), CREAM),
            ("BOX", (0, 0), (-1, -1), 0.8, GOLD),
            ("LEFTPADDING", (0, 0), (-1, -1), 16),
            ("RIGHTPADDING", (0, 0), (-1, -1), 16),
            ("TOPPADDING", (0, 0), (-1, -1), 17),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 17),
        ]),
    ),
    Spacer(1, 7 * mm),
    Paragraph("La propuesta", eyebrow),
    Paragraph("Weex ayuda a emprendedores y terapeutas a ordenar y hacer crecer su actividad sin quedar atrapados respondiendo mensajes todo el día.", lead),
    Paragraph("Automatizamos las conversaciones de <b>WhatsApp e Instagram</b> para responder consultas frecuentes, presentar tus servicios, captar nuevos clientes y guiarlos hasta la reserva de un turno.", body),
    Paragraph("Mientras Weex se ocupa de la atención inicial, la agenda, las reservas y los recordatorios, vos podés enfocarte en lo más importante: brindar un gran servicio y hacer crecer tu proyecto.", body),
    Spacer(1, 4 * mm),
    Table(
        [[Paragraph("FRASE PARA ANUNCIOS", ParagraphStyle("AdLabel", parent=eyebrow, textColor=GOLD_LIGHT, alignment=TA_CENTER)),
          Paragraph("Automatizá WhatsApp e Instagram, convertí consultas en reservas y administrá tu actividad desde un solo lugar con Weex.", cta)]],
        colWidths=[36 * mm, 129 * mm],
        style=TableStyle([
            ("BACKGROUND", (0, 0), (-1, -1), INK),
            ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
            ("LEFTPADDING", (0, 0), (-1, -1), 10),
            ("RIGHTPADDING", (0, 0), (-1, -1), 10),
            ("TOPPADDING", (0, 0), (-1, -1), 13),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 13),
        ]),
    ),
    PageBreak(),
]

# Page 4
story += [
    Paragraph("03  ·  DEL PUNTO A AL PUNTO B", eyebrow),
    Paragraph("De trabajar de forma manual a crecer con Weex.", title),
    Paragraph("Seis mejoras concretas para ordenar la actividad, responder mejor y transformar más consultas en clientes.", lead),
]

transformations = [
    ("Responder cada consulta manualmente.", "Automatizar conversaciones de WhatsApp e Instagram, incluso cuando no estás disponible."),
    ("Perder consultas entre mensajes.", "Registrar y acompañar cada oportunidad hasta convertirla en cliente o reserva."),
    ("Coordinar turnos mensaje por mensaje.", "Permitir que tus clientes consulten disponibilidad y reserven online las 24 horas."),
    ("Usar cuadernos, calendarios y planillas separadas.", "Administrar agenda, servicios, clientes y comunicaciones desde un solo lugar."),
    ("Depender de recordatorios manuales.", "Enviar confirmaciones y recordatorios automáticos para reducir olvidos y ausencias."),
    ("Trabajar sin información clara sobre tu actividad.", "Conocer mejor a tus clientes, hacer seguimiento y tomar decisiones para crecer."),
]
for idx, (before, after) in enumerate(transformations, start=1):
    story.append(transformation_row(idx, before, after))

story += [
    Spacer(1, 3 * mm),
    Table([[Paragraph("Con Weex pasás de administrar mensajes y turnos todo el día a tener un sistema que trabaja con vos, automatiza tareas y te ayuda a convertir más consultas en clientes.", cta)]],
          colWidths=[169 * mm], style=TableStyle([("BACKGROUND", (0, 0), (-1, -1), GREEN), ("LEFTPADDING", (0, 0), (-1, -1), 13), ("RIGHTPADDING", (0, 0), (-1, -1), 13), ("TOPPADDING", (0, 0), (-1, -1), 11), ("BOTTOMPADDING", (0, 0), (-1, -1), 11)])),
]

doc.build(story)
print(OUTPUT)
