# La Cochera · landing V13

Abrí `index.html` para una vista local o serví esta carpeta con cualquier servidor estático. No requiere instalación ni compilación. Las fuentes y el mapa necesitan conexión; la navegación y el selector de servicios funcionan localmente.

## Diseño e interacciones

- Cinco anclas: Servicios, Experiencia, Equipo, Reseñas y Ubicación.
- Servicios se recorre con flechas, miniaturas, teclado o gestos horizontales. El scroll vertical baja normalmente por la página y conserva el servicio seleccionado. Información a la izquierda en escritorio; retratos arriba en teléfono.
- Siete retratos de cortes con laterales de capa/camiseta reconstruidos y una única base inferior difuminada. Los PNG originales suministrados se conservan intactos; los derivados web actuales usan transparencia WebP.
- Tipografía coherente Plus Jakarta Sans con respaldo Arial. Experiencia conserva el manifiesto sin las tres tarjetas adicionales.
- Equipo con cuatro profesionales confirmados en el selector de reservas oficial y sus fotos reales. En teléfono el carrusel horizontal muestra parte de la siguiente tarjeta.
- Prueba social transparente: 4.9/5 y 91 opiniones en Google, consultadas el 23/10/2026. Las iniciales pertenecen a autores de opiniones; no se utilizan retratos ficticios como clientes reales.

## Datos y procedencia

Fuentes consultadas por el padre el **23/10/2026**:

- [Ficha pública de Google Maps](https://share.google/7HlF5PLeA5ATyXwyO): dirección Franklin D. Roosevelt 5520, C1431BXM, Villa Urquiza, CABA; valoración 4.9/5 sobre 91 opiniones.
- [Agenda pública oficial](https://lacochera.weex.com.ar/): equipo publicado, fotos, servicios, precios, contacto y horarios.
- [Reservas oficiales](https://lacochera.weex.com.ar/reservar): destino de las acciones principales para reservar.

Contacto: WhatsApp +54 9 11 6825-5414; correo blas@weex.com.ar. Horarios publicados: martes a viernes 12:30–20:00 y sábados 12:30–18:00. No se afirma que domingo o lunes estén cerrados: su disponibilidad debe consultarse en la agenda. Redes: [Instagram](https://www.instagram.com/lacochera.socialclub) y [TikTok](https://www.tiktok.com/@lacochera._).

Servicios publicados: Corte $25.000/30 min; Corte + Barba $30.000/30 min; Barba $18.000/30 min; Color Global $90.000/180 min; Reflejos $85.000/180 min. Los precios y horarios son una copia de esa consulta, no una sincronización automática.

Los cuatro perfiles del selector de [reservas oficiales](https://lacochera.weex.com.ar/reservar) son Blas, Joaco Greco, Mati Castellino y Mauro Dall’alpi. Se consultó el selector después de elegir Corte: la portada muestra solo tres y no representa el listado completo. Sus fotos se copiaron a `assets/equipo/*-crm.webp` desde los perfiles públicos; se conservan sin transformar. La foto de Mauro corresponde al profesional `cmv5mcggq001t2xm6gpkh1yxo`, recurso público `professionals/eb6e932f0b523f1dd598af3a.webp`, comprobado el 23/10/2026. No se atribuyen especialidades ni biografías no comprobadas. Las imágenes y perfiles demo anteriores quedan como archivos históricos sin uso en esta versión.

`data/google-reviews-v11.json` es la fuente de las **25 opiniones** mostradas. Cada entrada conserva autor, valoración, fecha relativa observada, fragmento de hasta 25 palabras y enlace al perfil de Google. Se incluye la opinión de una estrella con su valoración original. No son reseñas nuevas ni inventadas: son fragmentos de opiniones públicas. El JSON se copia también al bloque `googleReviews` de `index.html` para funcionar sin peticiones adicionales; el contrato comprueba su igualdad exacta. Los enlaces de cada tarjeta permiten consultar la fuente. Las fechas relativas corresponden a la observación del 23/10/2026.

## Archivos y copia única

`styles.css` conserva la base visual; `redesign.css` aplica los cambios actuales. `app.js` controla el menú, los servicios y el carrusel de opiniones. Los originales y las entregas V7–V12 se preservan en el proyecto. El ZIP V13 incluye solo los archivos necesarios para esta versión; no arrastra fotos demo, PNG históricos ni notas de versiones anteriores.

Los siete retratos `assets/servicios/*-v13.webp` se exportan desde los masters aprobados en `output/la-cochera/retratos-v13/*.png`. El padre usó ImageGen integrado para completar únicamente hombros/capas/camiseta y revisó cara, cabello, accesorios y pose. Los prompts están en `output/la-cochera/retratos-v13/prompts.json`. Los primeros intentos que conservaban cortes laterales se rechazaron; los masters finales tienen margen transparente alrededor de la silueta y base horizontal. `node scripts/la-cochera-prepare-portraits.mjs` reproduce la exportación: recorta solo lienzo transparente con margen lateral/superior de 28 px, conserva dos píxeles bajo la base y exporta WebP de hasta 900 px de alto, calidad 84 y alpha 100. El master generado y los siete PNG históricos no se sobrescriben.

Para generar un HTML único con estilos, JavaScript, opiniones e imágenes embebidos, ejecutar desde la raíz: `node scripts/la-cochera-single-file.mjs`. Se guarda en `output/la-cochera/La_Cochera_V13.html`; puede indicarse otra ruta como argumento. El empaquetado no descarga recursos ni modifica la fuente ni las entregas anteriores. Una tabla JSON contiene cada imagen una sola vez; un resolver local restaura las imágenes HTML, los fondos CSS y las fotos de cada servicio sin peticiones adicionales. La copia única utiliza Arial u otra tipografía de respaldo instalada; las imágenes y el selector funcionan localmente. El mapa, las reservas y los enlaces externos requieren Internet. Enviar el archivo como documento no equivale a publicar una web ni activa automáticamente una vista previa de enlace en WhatsApp.

## Peso y carga

El HTML único pasa de **41.988.011 bytes en V12 a 1.540.663 bytes en V13** (96,33% menos). Sus 18 imágenes de contenido suman 1.042.528 bytes únicos; los siete retratos suman 695.456, las cinco miniaturas 44.642, las cuatro fotos CRM 171.580 y logo/textura 130.850. El PNG de portada OG conserva sus 2.363.497 bytes y URL pública: no forma parte de las imágenes normales de la página ni se incrusta en el HTML único, pero se incluye en el ZIP para publicarlo en su ruta.

`node scripts/la-cochera-optimize-site.mjs` reproduce logo WebP de 768 px con compresión sin pérdida, textura WebP de 1024 px/calidad 78 y miniaturas de 200 px/calidad 80. Los originales se conservan; las fotos CRM permanecen byte a byte intactas. Se eliminó la precarga/decodificación de los siete retratos completos al abrir la página. Las fotos iniciales de Servicios, las miniaturas y las fotos CRM usan carga diferida; al seleccionar un servicio, sus fotos se cargan de inmediato. El navegador decide cuándo adelantar imágenes cercanas al viewport, por lo que estos son pesos de archivos y comprobaciones de comportamiento, no una medición de milisegundos ni de red fría. El HTML único contiene todos los recursos locales en una transferencia; la carga diferida reduce trabajo de imágenes fuera de vista, no los bytes del propio archivo HTML.

## Preparación para compartir un enlace

La URL principal indicada por el usuario es `https://weex.com.ar/lacochera`; la alternativa es `https://lacochera.weex.com.ar`. El HTML contiene canonical, Open Graph y Twitter Card con la URL principal. La portada generada está en `assets/social/portada-whatsapp-v11.png` (1730×909 píxeles), con texto y logo de La Cochera. Los metadatos conservan la URL HTTPS absoluta `https://weex.com.ar/lacochera/assets/social/portada-whatsapp-v11.png`; el empaquetado no la convierte en dataURL.

Esta entrega prepara los archivos, sin publicarlos. Para activar una vista previa al compartir un enlace, deben publicarse el HTML en las dos rutas elegidas y la imagen en la ruta HTTPS indicada; la alternativa puede conservar el canonical de la principal. La página y la imagen deben ser accesibles públicamente para los lectores de metadatos. Una vez publicada, corresponde comprobar la respuesta de esas rutas y la vista previa real de WhatsApp, que puede conservar caché. No se afirma que la imagen esté publicada ni que la vista previa ya funcione. El archivo HTML enviado como documento sigue siendo una entrega local distinta de un enlace publicado.

Validaciones desde la raíz:

```
node --import tsx scripts/la-cochera-landing-contract-test.ts
node --check sites/la-cochera/app.js
node --check scripts/la-cochera-single-file.mjs
npm run test:text-encoding
```
