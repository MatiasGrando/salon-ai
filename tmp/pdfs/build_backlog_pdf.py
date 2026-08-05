from pathlib import Path

from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER, TA_LEFT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import (
    BaseDocTemplate,
    Frame,
    KeepTogether,
    PageTemplate,
    Paragraph,
    PageBreak,
    Spacer,
    Table,
    TableStyle,
)


ROOT = Path(__file__).resolve().parents[2]
OUTPUT = ROOT / "output" / "pdf" / "backlog-tareas-pendientes-weex.pdf"

FONT_REGULAR = Path("C:/Windows/Fonts/arial.ttf")
FONT_BOLD = Path("C:/Windows/Fonts/arialbd.ttf")
pdfmetrics.registerFont(TTFont("Arial", str(FONT_REGULAR)))
pdfmetrics.registerFont(TTFont("Arial-Bold", str(FONT_BOLD)))

NAVY = colors.HexColor("#101936")
BLUE = colors.HexColor("#3157A4")
PURPLE = colors.HexColor("#7658C8")
CORAL = colors.HexColor("#D96B57")
GREEN = colors.HexColor("#2F8B68")
CREAM = colors.HexColor("#F7F4EE")
INK = colors.HexColor("#25304A")
MUTED = colors.HexColor("#68738A")
LINE = colors.HexColor("#DDE3ED")
WHITE = colors.white


SECTIONS = [
    {
        "priority": "P0",
        "title": "Bloqueos y errores críticos",
        "color": CORAL,
        "items": [
            ("Permitir reservas web de servicios con seña", [
                "Mostrar el servicio aunque tenga seña.",
                "Permitir pagar o enviar comprobante.",
                "Si el cobro no puede completarse online, ofrecer contacto por teléfono o derivación.",
                "Evitar que un servicio válido desaparezca silenciosamente.",
            ]),
            ("Mejorar el rendimiento de carga", [
                "Optimizar servicios, profesionales, disponibilidad, turnos, landing pública y datos principales del CRM.",
                "Reducir consultas repetidas, revisar índices y paralelizar cargas.",
                "Mostrar estados parciales sin bloquear toda la interfaz.",
            ]),
            ("Normalizar y deduplicar números telefónicos", [
                "Normalizar código de país, código de área, espacios, guiones y prefijos.",
                "Detectar clientes duplicados antes de crearlos y unificar registros existentes de forma segura.",
                "Utilizar el teléfono normalizado en importaciones, WhatsApp y referidos.",
            ]),
            ("Mostrar correctamente precios 'Desde' en las landings", [
                "Mostrar siempre 'Desde $X' cuando el servicio tenga precio inicial.",
                "No presentarlo como precio fijo.",
                "Mantener el mismo criterio en landing, turnero, catálogo y bot.",
            ]),
        ],
    },
    {
        "priority": "P1",
        "title": "Reservas y experiencia conversacional",
        "color": PURPLE,
        "items": [
            ("Agrupar mensajes consecutivos de WhatsApp", [
                "Esperar una ventana breve y agrupar mensajes enviados con pocos segundos de diferencia.",
                "Interpretar el contenido completo y evitar respuestas intermedias contradictorias.",
                "Ejemplo: 'Hola' + 'quiero color' + 'mañana por la tarde'.",
            ]),
            ("Construir un flujo flexible de reserva", [
                "Permitir que el cliente priorice profesional o disponibilidad.",
                "Comprender si primero indica turno, fecha, horario o profesional.",
                "Conservar datos adelantados y evitar obligar a seguir un único orden.",
                "Cubrir: servicio-profesional-fecha-hora; servicio-fecha/hora-profesionales; cualquier profesional; profesional-servicios compatibles; horario puntual-alternativas.",
            ]),
            ("Resolver horarios puntuales sin disponibilidad", [
                "Ofrecer horarios cercanos o consultar si acepta otro profesional.",
                "Permitir solicitar una excepción o sobreturno.",
                "Derivar al equipo con todo el contexto cuando el cliente lo solicite.",
            ]),
            ("Manejar profesionales con nombres similares", [
                "Resolver coincidencias por nombre, apellido, nombre completo y alias.",
                "Si existen coincidencias ambiguas, preguntar cuál profesional desea antes de avanzar.",
            ]),
            ("Contemplar combos y múltiples servicios", [
                "Definir duración total, orden de servicios y si los realiza el mismo profesional.",
                "Resolver disponibilidad consecutiva, precio y seña.",
                "Crear uno o varios turnos relacionados según el caso.",
                "Requiere definir primero el modelo de reserva con múltiples servicios.",
            ]),
            ("Agregar políticas al finalizar la reserva", [
                "Comunicar políticas de cancelación, modificaciones y devoluciones.",
                "Incluir condiciones de la seña y plazo mínimo para reprogramar.",
                "Permitir textos configurables por comercio.",
            ]),
            ("Optimizar respuestas con conversaciones, web y CRM", [
                "Combinar mensaje actual, conversación reciente y estado de la reserva.",
                "Incorporar servicios, profesionales, horarios, precios y políticas del CRM.",
                "Usar contenido autorizado de la web y priorizar datos del CRM sobre inferencias.",
            ]),
        ],
    },
    {
        "priority": "P1",
        "title": "Pagos y confirmación",
        "color": BLUE,
        "items": [
            ("Integrar Mercado Pago", [
                "Incorporar enlace o checkout de pago y asociarlo con la reserva.",
                "Procesar webhooks de confirmación y vencimiento de la seña.",
                "Gestionar estados pendiente, aprobado, rechazado y vencido.",
                "Confirmar automáticamente el turno cuando corresponda.",
            ]),
            ("Interpretar comprobantes de pago", [
                "Recibir imagen o PDF y extraer importe, fecha y referencia.",
                "Comparar la información con la seña esperada.",
                "Marcar el comprobante como pendiente de revisión y permitir aprobación humana.",
                "La IA puede asistir en la lectura, pero no aprobar definitivamente sin una validación confiable.",
            ]),
        ],
    },
    {
        "priority": "P2",
        "title": "Comunicaciones y seguimiento",
        "color": GREEN,
        "items": [
            ("Mejorar envíos manuales asistidos", [
                "Unificar recordatorios, campañas y posventa.",
                "Seleccionar destinatarios, generar o editar el mensaje y mostrar una vista previa.",
                "Validar permisos y ventana de WhatsApp, evitando envíos duplicados.",
                "Mostrar progreso, resultados y errores.",
            ]),
            ("Incorporar seguimientos dentro de las 24 horas", [
                "Permitir seguimientos manuales, automáticos, programados y basados en eventos.",
                "Cubrir presupuestos sin respuesta, reservas incompletas, comprobantes pendientes, consultas sin turno y posventa.",
                "Validar la ventana de 24 horas antes de usar mensajes libres.",
            ]),
            ("Base compartida de captación y referidos", [
                "Registrar origen del cliente, campañas, enlaces y códigos de referido.",
                "Guardar comercio o profesional referente y conversiones a turnos.",
                "Evitar duplicados por teléfono.",
                "Depende de completar primero la normalización de números.",
            ]),
        ],
    },
    {
        "priority": "P2",
        "title": "CRM e integraciones",
        "color": BLUE,
        "items": [
            ("Importar clientes desde CSV o Excel", [
                "Ofrecer plantilla descargable, mapeo de columnas y vista previa.",
                "Validar teléfonos y detectar duplicados.",
                "Informar filas importadas, omitidas y con errores.",
                "Permitir actualizar registros existentes.",
            ]),
            ("Integrar Google Business Profile", [
                "Consultar, filtrar y responder reseñas desde el CRM.",
                "Generar borradores asistidos e identificar reseñas pendientes.",
                "Mostrar métricas de reputación.",
            ]),
            ("Registrar gastos del negocio y profesionales", [
                "Registrar gastos diarios, categoría, importe, fecha y responsable.",
                "Adjuntar comprobante opcional y contemplar gastos recurrentes.",
                "Crear reportes de ingresos, gastos y rentabilidad.",
            ]),
        ],
    },
    {
        "priority": "P2",
        "title": "Experiencia visual del CRM",
        "color": PURPLE,
        "items": [
            ("Auditar el feedback de todos los botones", [
                "Revisar sección por sección: transición visual, spinner y texto de carga.",
                "Deshabilitar el botón durante la acción y prevenir clics repetidos.",
                "Mostrar mensajes integrados de éxito o error.",
                "Recuperar correctamente el estado después de un fallo.",
                "Crear un componente reutilizable para mantener un comportamiento consistente.",
            ]),
        ],
    },
    {
        "priority": "P3",
        "title": "Landings y personalización",
        "color": CORAL,
        "items": [
            ("Mejorar el sistema de plantillas", [
                "Incorporar nuevas plantillas y una opción precargada como ejemplo.",
                "Mejorar vistas previas de escritorio y móvil.",
                "Indicar qué campos admite cada plantilla.",
            ]),
            ("Hacer personalizables todos los textos", [
                "Editar título, subtítulo, llamados a la acción y presentación del negocio.",
                "Personalizar servicios, profesionales, preguntas frecuentes, políticas, contacto y pie de página.",
            ]),
            ("Informar dimensiones de las imágenes", [
                "Mostrar dimensiones recomendadas, relación de aspecto, peso máximo y formatos admitidos.",
                "Incluir ejemplo de recorte y vista previa antes de guardar.",
            ]),
            ("Ofrecer landings personalizadas", [
                "Diferenciar plantilla configurable de landing personalizada.",
                "La plantilla conserva una estructura predefinida; la personalizada permite diseño y secciones específicas.",
            ]),
        ],
    },
    {
        "priority": "P3",
        "title": "Documentación y onboarding",
        "color": GREEN,
        "items": [
            ("Video de conexión con Meta", [
                "Crear la aplicación en Facebook Developers y configurar WhatsApp.",
                "Asociar Business Manager y WABA, y seleccionar el número.",
                "Configurar permisos, token y webhook.",
                "Conectar el comercio en el CRM y enviar un mensaje de prueba.",
                "Incluir una sección de errores frecuentes.",
            ]),
        ],
    },
]


styles = getSampleStyleSheet()
styles.add(ParagraphStyle(
    name="TitleCustom", fontName="Arial-Bold", fontSize=27, leading=31,
    textColor=NAVY, alignment=TA_LEFT, spaceAfter=8,
))
styles.add(ParagraphStyle(
    name="SubtitleCustom", fontName="Arial", fontSize=11.2, leading=16,
    textColor=MUTED, alignment=TA_LEFT,
))
styles.add(ParagraphStyle(
    name="SectionTitle", fontName="Arial-Bold", fontSize=19, leading=23,
    textColor=NAVY, spaceAfter=5,
))
styles.add(ParagraphStyle(
    name="PriorityPill", fontName="Arial-Bold", fontSize=9, leading=11,
    textColor=WHITE, alignment=TA_CENTER,
))
styles.add(ParagraphStyle(
    name="TaskTitle", fontName="Arial-Bold", fontSize=12.3, leading=15,
    textColor=NAVY, spaceAfter=5,
))
styles.add(ParagraphStyle(
    name="Body", fontName="Arial", fontSize=9.6, leading=13.5,
    textColor=INK,
))
styles.add(ParagraphStyle(
    name="BulletCustom", fontName="Arial", fontSize=9.4, leading=13.2,
    textColor=INK, leftIndent=12, firstLineIndent=-8, bulletIndent=2,
    spaceAfter=2,
))
styles.add(ParagraphStyle(
    name="Small", fontName="Arial", fontSize=8.5, leading=11,
    textColor=MUTED,
))


def header_footer(canvas, doc):
    canvas.saveState()
    width, height = A4
    canvas.setFillColor(NAVY)
    canvas.rect(0, height - 9 * mm, width, 9 * mm, fill=1, stroke=0)
    canvas.setFont("Arial-Bold", 8.5)
    canvas.setFillColor(WHITE)
    canvas.drawString(18 * mm, height - 5.8 * mm, "WEEX · BACKLOG DE PRODUCTO")
    canvas.setStrokeColor(LINE)
    canvas.line(18 * mm, 13 * mm, width - 18 * mm, 13 * mm)
    canvas.setFillColor(MUTED)
    canvas.setFont("Arial", 8)
    canvas.drawString(18 * mm, 8.7 * mm, "Tareas pendientes organizadas por prioridad y área")
    canvas.drawRightString(width - 18 * mm, 8.7 * mm, f"Página {doc.page}")
    canvas.restoreState()


class BacklogDocTemplate(BaseDocTemplate):
    def __init__(self, filename):
        super().__init__(
            filename,
            pagesize=A4,
            leftMargin=18 * mm,
            rightMargin=18 * mm,
            topMargin=18 * mm,
            bottomMargin=18 * mm,
            title="Backlog de tareas pendientes - Weex",
            author="Weex",
        )
        frame = Frame(
            self.leftMargin,
            self.bottomMargin,
            self.width,
            self.height,
            id="main",
            leftPadding=0,
            rightPadding=0,
            topPadding=0,
            bottomPadding=0,
        )
        self.addPageTemplates([PageTemplate(id="backlog", frames=[frame], onPage=header_footer)])


def priority_chip(priority, color):
    chip = Table([[Paragraph(priority, styles["PriorityPill"])]], colWidths=[14 * mm], rowHeights=[7 * mm])
    chip.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, -1), color),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("BOX", (0, 0), (-1, -1), 0, color),
        ("ROUNDEDCORNERS", [3 * mm]),
    ]))
    return chip


def task_card(number, title, bullets, color):
    bullet_flowables = [
        Paragraph(f"• {text}", styles["BulletCustom"])
        for text in bullets
    ]
    content = [
        Paragraph(f"{number}. {title}", styles["TaskTitle"]),
        *bullet_flowables,
    ]
    table = Table([[content]], colWidths=[165 * mm], hAlign="LEFT")
    table.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, -1), WHITE),
        ("BOX", (0, 0), (-1, -1), 0.7, LINE),
        ("LINEBEFORE", (0, 0), (0, -1), 4, color),
        ("LEFTPADDING", (0, 0), (-1, -1), 12),
        ("RIGHTPADDING", (0, 0), (-1, -1), 12),
        ("TOPPADDING", (0, 0), (-1, -1), 9),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 9),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("ROUNDEDCORNERS", [3 * mm]),
    ]))
    return KeepTogether([table, Spacer(1, 4 * mm)])


def build_story():
    story = []
    story.append(Spacer(1, 11 * mm))
    story.append(Paragraph("Backlog de tareas pendientes", styles["TitleCustom"]))
    story.append(Paragraph(
        "Tareas consolidadas y organizadas por prioridad y área funcional. "
        "Los puntos repetidos fueron agrupados para facilitar su planificación y seguimiento.",
        styles["SubtitleCustom"],
    ))
    story.append(Spacer(1, 9 * mm))

    summary_data = [
        ["P0", "Bloqueos críticos", "4 tareas"],
        ["P1", "Reservas, conversación y pagos", "9 tareas"],
        ["P2", "Comunicaciones, CRM y experiencia visual", "7 tareas"],
        ["P3", "Landings, personalización y onboarding", "5 tareas"],
    ]
    summary = Table(summary_data, colWidths=[18 * mm, 110 * mm, 37 * mm], rowHeights=[9 * mm] * 4)
    summary.setStyle(TableStyle([
        ("FONTNAME", (0, 0), (-1, -1), "Arial"),
        ("FONTNAME", (0, 0), (0, -1), "Arial-Bold"),
        ("FONTNAME", (-1, 0), (-1, -1), "Arial-Bold"),
        ("FONTSIZE", (0, 0), (-1, -1), 9.5),
        ("TEXTCOLOR", (0, 0), (-1, -1), INK),
        ("TEXTCOLOR", (0, 0), (0, -1), WHITE),
        ("BACKGROUND", (0, 0), (-1, -1), WHITE),
        ("BACKGROUND", (0, 0), (0, 0), CORAL),
        ("BACKGROUND", (0, 1), (0, 1), PURPLE),
        ("BACKGROUND", (0, 2), (0, 2), GREEN),
        ("BACKGROUND", (0, 3), (0, 3), BLUE),
        ("GRID", (0, 0), (-1, -1), 0.5, LINE),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("LEFTPADDING", (0, 0), (-1, -1), 8),
        ("RIGHTPADDING", (0, 0), (-1, -1), 8),
    ]))
    story.append(summary)
    story.append(Spacer(1, 6 * mm))
    story.append(Paragraph(
        "Criterio: P0 bloquea operaciones o ingresos; P1 afecta el núcleo de reservas y pagos; "
        "P2 mejora operación, seguimiento e integraciones; P3 amplía personalización y onboarding.",
        styles["Small"],
    ))
    story.append(PageBreak())

    task_number = 1
    for section_index, section in enumerate(SECTIONS):
        if section_index > 0:
            story.append(PageBreak())
        story.append(Spacer(1, 4 * mm))
        heading = Table(
            [[priority_chip(section["priority"], section["color"]), Paragraph(section["title"], styles["SectionTitle"])]],
            colWidths=[19 * mm, 146 * mm],
        )
        heading.setStyle(TableStyle([
            ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
            ("LEFTPADDING", (0, 0), (-1, -1), 0),
            ("RIGHTPADDING", (0, 0), (-1, -1), 5),
            ("TOPPADDING", (0, 0), (-1, -1), 0),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 0),
        ]))
        story.append(heading)
        story.append(Spacer(1, 5 * mm))
        for title, bullets in section["items"]:
            story.append(task_card(task_number, title, bullets, section["color"]))
            task_number += 1
    return story


def main():
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    doc = BacklogDocTemplate(str(OUTPUT))
    doc.build(build_story())
    print(OUTPUT)


if __name__ == "__main__":
    main()
