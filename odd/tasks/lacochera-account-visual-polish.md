# Retoques visuales de cuenta y portada La Cochera

## Objetivo y autorización
2026-11-05: usuario solicita icono reconocible de Google en el acceso de cuenta y retratos nuevos en lugar de iniciales sobre el puntaje de la portada. Su aclaración requiere únicamente hombres: La Cochera atiende hombres. Luego de ver la propuesta generada, autoriza expresamente integrar la foto real del frente en El ritual del barrio. No modificar autenticación, navegación, disponibilidad o datos. Sin push, servidor, DB ni revisión externa.

## Exploración y alcance
Dos fuentes: landing-ui.ts tiene acceso de invitado sin icono y botones de acceso con una G textual; published-v13.html contiene cuatro iniciales en círculos. Conservar los flujos existentes y paletas. Usar icono SVG multicolor en los botones de Google, y sprite PNG 2x2 de cuatro hombres adultos ficticios generado con herramienta integrada por el padre. Guardar activo y prompt en sites/la-cochera/assets/people; incluir data URI en portada para conservar CSP y ambas rutas existentes. Indicar Imágenes ilustrativas sin asociar retratos a las reseñas reales ni alterar el puntaje.

## Tareas
- [x] P1 — Delegated direct: icono y alineación responsive/foco en cuenta, sin cambiar controladores ni accesibilidad del texto. Dos fuentes no triviales activan escritor delegado.
- [x] P2 — Delegated direct: retratos generados en círculos, etiqueta ilustrativa, activo y prompt persistidos; conservar puntaje/enlaces. Sintaxis, UTF-8, diferencias y codificación verificadas antes del commit.
- [x] P3 — Delegated direct: integrar la fotografía real aprobada, título y texto existentes, foto grande redondeada con leyenda Nos vemos en La Cochera y manifiesto oscuro; diseño apilado en móvil y grilla en escritorio. No usar la maqueta como contenido de la web. Conservar párrafos e interacciones de resaltado.

## Comprobaciones y entrega
TDD STRICT heredado de booking-yellow-black-theme.md, limitado por la preferencia explícita de no ejecutar flujos, suites, IA/DB, tipos, build ni reinicios. No declarar RED/GREEN. Permitido: parseo TypeScript y JavaScript inline sin ejecutar, diff, UTF-8 y npm run test:text-encoding. Runner relacionado existente: npm run test:booking-theme-ui; no ejecutarlo. Verificación visual de app real y funcional pendiente de prueba manual.
Forecast 100–200 líneas authored, activos binarios excluidos; estrategia ask-on-risk, sin PR. Base main 0da1935, rama codex/lacochera-account-visual-polish. RDD por padre al cierre. Engram no disponible: espejo odd/lacochera-account-visual-polish/tasks pendiente.

## Progreso
P1 implementado con icono SVG multicolor reutilizado en el acceso de invitados y dos botones existentes de Google. Texto accesible, controladores y comportamiento de login sin cambios. Comprobación estática, sin observación visual del icono en app real.
P2 implementado con cuatro hombres ficticios del activo generado final aprobado, sprite 2x2 e identificación ilustrativa visible. No usar la primera generación descartada. PNG y prompt exacto persistidos en sites/la-cochera/assets/people/illustrative-portraits-v1.png y .prompt.txt. Método built-in image_gen. Puntaje y opiniones de Google intactos.
P3 implementado usando sites/la-cochera/assets/storefront/la-cochera-front-original.jpeg, copia byte a byte del JPEG aportado. SHA256 original y copia: D528C79BD52035BDD3D96B07A40D1DA4E886C03B6D752ACDE0EFB7BDE345B53A. La foto se recorta únicamente mediante CSS, con leyenda y tarjeta superpuesta en móvil; grilla de dos columnas en escritorio. Texto completo e IDs de resaltado conservados.

## Evidencia observada
PASS: parseo TypeScript sin importar app; JavaScript inline de cuenta y portada parseado sin ejecutar; UTF-8 estricto; invariantes de activos/estructura; git diff --check; npm run test:text-encoding (exit 0). El primer intento del comprobador temporal confundió un bloque application/json de la portada con JavaScript: el clasificador se corrigió y el nuevo chequeo pasó, sin cambios necesarios en la fuente.
El padre revisó el diff y observó capturas aisladas de hero, experiencia móvil y experiencia escritorio: fotos masculinas y leyenda correctas, fotografía real y composición aprobadas. La emulación móvil pedía 390 pero el ancho CSS observado fue 398 tanto en baseline 0da1935 como en la versión actual: no se atribuye desborde nuevo ni se afirma verificación exacta a 390 o ausencia global de overflow. Capturas en C:/Users/cpu/.codex/visualizations/2026/10/29/01a18814-9892-7d01-9ed2-a8e4aeac57bf/lacochera-polish-preview/: mobile-detail-hero.png, mobile-detail-experience.png y desktop-detail-experience.png. Escritorio observado a 1440 px CSS exactos.
Sin app real, flujo Google, reservas, suites, tipos, build, IA/DB, reinicios o push. Activos se incrustan como data URI conforme al patrón existente/CSP; HTML crece aproximadamente 3,6 MB por los dos recursos, además de las copias originales en assets. Próximo paso: commit local observado, assessment RDD por el padre y prueba manual del usuario. Engram pendiente por herramientas ausentes.

## Unidad guardada
Commit c6ad470cb9b75fe96baed5dc84a7cc94744f6999 observado: seis archivos; P1, P2 y P3 guardados, fuentes y activos verificados, árbol limpio al cierre. Assessment nativo observado por el padre desde e02b8ff: medium, 95 líneas authored y seis paths, review_due=false/under_budget. RDD ON global; sin revisión externa, nueva solicitud de consentimiento ni push. El slice continúa pendiente y el espejo Engram sigue pendiente por herramientas ausentes. El padre observó las tres capturas indicadas. El icono Google queda con comprobación estática y prueba manual pendiente.
