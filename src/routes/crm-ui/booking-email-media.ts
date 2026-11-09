import { bookingConfirmationDetailIcons } from '../../services/booking-confirmation-email-service.js'

export const bookingEmailMediaStyles = `
    #booking-email-media { margin-top: 20px; padding: clamp(12px, 2vw, 20px); border: 1px solid #425365; border-radius: 14px; min-width: 0; }
    #booking-email-media > summary { color: inherit; cursor: pointer; font-weight: 700; padding: 6px 0; }
    #booking-email-media [hidden] { display: none !important; }
    .booking-email-media-fields { border: 0; padding: 0; margin: 0; min-width: 0; }
    .booking-email-media-layout { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 0.85fr); gap: 20px; align-items: start; }
    .booking-email-media-controls, .booking-email-media-block, .booking-email-media-ranges { display: grid; gap: 10px; min-width: 0; }
    .booking-email-media-controls { gap: 18px; }
    .booking-email-media-block { padding: 12px; border: 1px solid #425365; border-radius: 10px; }
    #booking-email-media h4, #booking-email-media p { margin: 0; }
    #booking-email-media .booking-email-media-help { margin: 8px 0 14px; }
    #booking-email-media :is(select, input, button) { max-width: 100%; min-width: 0; }
    #booking-email-media input[type="range"] { width: 100%; margin: 4px 0; accent-color: #e3c877; }
    #booking-email-media :focus-visible { outline: 2px solid #e3c877; outline-offset: 3px; }
    .booking-email-media-actions { display: flex; align-items: center; flex-wrap: wrap; gap: 8px; }
    .booking-email-media-fields > .booking-email-media-actions { margin-top: 16px; }
    .booking-email-media-list { padding: 0; margin: 0; list-style: none; display: grid; gap: 8px; }
    .booking-email-media-list li { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; }
    .booking-email-media-list img { width: 36px; height: 36px; object-fit: contain; border-radius: 4px; }
    #booking-email-media-canvas { display: block; width: 100%; height: auto; cursor: grab; touch-action: none; border-radius: 6px; }
    #booking-email-media-canvas:active { cursor: grabbing; }
    .booking-email-media-preview { border: 1px solid #e4d9bf; border-radius: 10px; overflow: hidden; margin-top: 8px; background: #fffdf8; color: #2a2117; font-family: Arial, sans-serif; }
    .booking-email-media-preview strong.booking-email-media-masthead { display: block; padding: 10px 14px; background: #141009; color: #e3c877; font-size: 20px; }
    .booking-email-media-preview canvas { display: block; width: 100%; height: auto; }
    #booking-email-media-preview-banner, .booking-email-media-preview-heading img, .booking-email-media-preview-photos canvas { box-sizing: border-box; border: 1px solid #e4d9bf; border-radius: 8px; }
    #booking-email-media-preview-banner { width: calc(100% - 24px); margin: 10px 12px 0; border-radius: 12px; }
    .booking-email-media-preview-body { display: grid; gap: 10px; padding: 12px; }
    .booking-email-media-preview-heading { display: grid; gap: 6px; justify-items: center; text-align: center; }
    .booking-email-media-preview-heading strong { overflow-wrap: anywhere; font-size: 20px; }
    .booking-email-media-preview-heading img { width: 48px; height: 48px; object-fit: contain; }
    .booking-email-media-preview-status { background: #6d1f1f; color: #fffdf8; padding: 5px 10px; border-radius: 14px; font-size: 12px; font-weight: 700; }
    .booking-email-media-preview-details { display: grid; gap: 6px; padding: 10px 0; border-block: 1px solid #e4d9bf; }
    .booking-email-media-preview-details > div { display: grid; grid-template-columns: 20px minmax(0, 1fr); gap: 5px; align-items: start; }
    .booking-email-media-detail-icon, .booking-email-media-preview-details a { color: #6d1f1f; }
    .booking-email-media-preview-details a { text-decoration: underline; overflow-wrap: anywhere; }
    .booking-email-media-preview-action { text-align: center; padding: 10px; border-radius: 7px; background: #e3c877; font-weight: 700; }
    .booking-email-media-preview-photos { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 4px; }
    #booking-email-media .settings-feedback.visible { margin-top: 10px; }
    @media (max-width: 850px) { .booking-email-media-layout { grid-template-columns: minmax(0, 1fr); } }
`

export const bookingEmailMediaMarkup = `
          <details id="booking-email-media" hidden>
            <summary>Im&aacute;genes del correo de confirmaci&oacute;n</summary>
            <p class="booking-email-media-help">Eleg&iacute; qu&eacute; fotos aparecen en el correo del turno. Los cambios se guardan solo para el correo.</p>
            <form id="booking-email-media-form" hidden>
              <fieldset class="booking-email-media-fields">
                <div class="booking-email-media-layout">
                  <div class="booking-email-media-controls">
                    <section class="booking-email-media-block" aria-labelledby="booking-email-media-banner-title">
                      <h4 id="booking-email-media-banner-title">Portada</h4>
                      <label for="booking-email-media-source">Portada del correo</label>
                      <select class="field" id="booking-email-media-source"></select>
                      <div class="settings-field" id="booking-email-media-upload-field" hidden>
                        <label for="booking-email-media-upload">Subir una portada</label>
                        <input id="booking-email-media-upload" type="file" accept="image/jpeg,image/png,image/webp">
                        <small>JPEG, PNG o WebP.</small>
                      </div>
                      <button class="secondary" id="booking-email-media-edit-banner" type="button">Ajustar portada</button>
                    </section>
                    <section class="booking-email-media-block" aria-labelledby="booking-email-media-gallery-title">
                      <h4 id="booking-email-media-gallery-title">Fotos al pie</h4>
                      <label for="booking-email-media-gallery-source">Fotos de la galer&iacute;a</label>
                      <div class="booking-email-media-actions">
                        <select class="field" id="booking-email-media-gallery-source"></select>
                        <button class="secondary" id="booking-email-media-add" type="button">Agregar foto</button>
                      </div>
                      <small>Pod&eacute;s elegir y ordenar hasta tres fotos de la galer&iacute;a guardada.</small>
                      <ol class="booking-email-media-list" id="booking-email-media-gallery"></ol>
                    </section>
                    <section class="booking-email-media-block" id="booking-email-media-crop" aria-labelledby="booking-email-media-crop-title" hidden>
                      <h4 id="booking-email-media-crop-title" tabindex="-1">Ajustar encuadre</h4>
                      <small>Alej&aacute; para mostrar la foto completa. Arrastr&aacute; la imagen o us&aacute; los controles de posici&oacute;n.</small>
                      <canvas id="booking-email-media-canvas" role="img" aria-label="Encuadre seleccionado"></canvas>
                      <div class="booking-email-media-ranges">
                        <label>Zoom <input id="booking-email-media-zoom" type="range" min="0" max="300" value="100"></label>
                        <label>Posici&oacute;n horizontal <input id="booking-email-media-horizontal" type="range" min="0" max="100" value="50"></label>
                        <label>Posici&oacute;n vertical <input id="booking-email-media-vertical" type="range" min="0" max="100" value="50"></label>
                      </div>
                    </section>
                  </div>
                  <section aria-labelledby="booking-email-media-preview-title">
                    <h4 id="booking-email-media-preview-title">Vista previa con un turno de ejemplo</h4>
                    <div class="booking-email-media-preview" id="booking-email-media-preview">
                      <strong class="booking-email-media-masthead">Weex</strong>
                      <canvas id="booking-email-media-preview-banner" role="img" aria-label="Portada con logo" hidden></canvas>
                      <div class="booking-email-media-preview-body">
                        <div class="booking-email-media-preview-heading">
                          <img id="booking-email-media-preview-logo" alt="Logo del negocio" hidden>
                          <strong id="booking-email-media-preview-name"></strong>
                          <span class="booking-email-media-preview-status">Turno confirmado</span>
                        </div>
                        <p>Hola, tu reserva fue confirmada.</p>
                        <div class="booking-email-media-preview-details">
                          <div><span class="booking-email-media-detail-icon" aria-hidden="true">${bookingConfirmationDetailIcons.service}</span><strong>Servicio de ejemplo</strong></div>
                          <div><span class="booking-email-media-detail-icon" aria-hidden="true">${bookingConfirmationDetailIcons.date}</span><span>S&aacute;bado 14 de noviembre</span></div>
                          <div><span class="booking-email-media-detail-icon" aria-hidden="true">${bookingConfirmationDetailIcons.time}</span><strong>15:00 &ndash; 15:30 hs</strong></div>
                          <div><span class="booking-email-media-detail-icon" aria-hidden="true">${bookingConfirmationDetailIcons.professional}</span><span>Con profesional de ejemplo</span></div>
                          <div id="booking-email-media-preview-location" hidden><span class="booking-email-media-detail-icon" aria-hidden="true">${bookingConfirmationDetailIcons.location}</span><a id="booking-email-media-preview-address" target="_blank" rel="noopener noreferrer"></a></div>
                        </div>
                        <div class="booking-email-media-preview-action">Ver mi turno</div>
                        <div class="booking-email-media-preview-photos">
                          <canvas data-gallery-preview role="img" aria-label="Foto 1" hidden></canvas>
                          <canvas data-gallery-preview role="img" aria-label="Foto 2" hidden></canvas>
                          <canvas data-gallery-preview role="img" aria-label="Foto 3" hidden></canvas>
                        </div>
                        <small>Enviado por Weex</small>
                      </div>
                    </div>
                  </section>
                </div>
                <div class="booking-email-media-actions">
                  <button class="primary" id="booking-email-media-save" type="submit">Guardar im&aacute;genes del correo</button>
                  <button class="secondary" id="booking-email-media-reload" type="button">Recargar im&aacute;genes guardadas</button>
                </div>
              </fieldset>
            </form>
            <p class="settings-feedback" id="booking-email-media-feedback" role="status" aria-live="polite"></p>
            <button class="secondary" id="booking-email-media-retry" type="button" hidden>Volver a cargar</button>
          </details>
`

export const bookingEmailMediaScript = String.raw`
    function bookingEmailMediaEditor(root, dependencies) {
      const find = (suffix) => root.querySelector('#booking-email-media-' + suffix)
      const form = find('form')
      const fields = form.querySelector('fieldset')
      const feedback = find('feedback')
      const source = find('source')
      const gallerySource = find('gallery-source')
      const cropCanvas = find('canvas')
      const zoom = find('zoom')
      const horizontal = find('horizontal')
      const vertical = find('vertical')
      const previews = [...root.querySelectorAll('[data-gallery-preview]')]
      const bannerSize = { width: 1200, height: 400, footer: 80 }
      const gallerySize = { width: 360, height: 240, footer: 0 }
      const defaultMessage = 'No pudimos preparar una imagen. Probá cargar otra copia desde el CRM.'
      const clamp = (value, minimum, maximum) => Math.min(maximum, Math.max(minimum, value))
      const loadedImages = new Map()
      let businessId = null
      let model = null
      let activePhoto = null
      let activeDimensions = null
      let draftChanged = false
      let busy = false
      let loadVersion = 0
      let cropVersion = 0
      let previewVersion = 0
      let drag = null

      function message(text, type = '') {
        feedback.textContent = text
        feedback.className = 'settings-feedback' + (text ? ' visible' : '') + (type ? ' ' + type : '')
      }

      function businessPath(suffix) {
        return '/businesses/' + encodeURIComponent(businessId) + '/' + suffix
      }

      function image(url) {
        if (!loadedImages.has(url)) {
          loadedImages.set(url, new Promise((resolve, reject) => {
            const element = new Image()
            if (!url.startsWith('data:')) element.crossOrigin = 'anonymous'
            element.onload = () => resolve(element)
            element.onerror = () => reject(new Error(defaultMessage))
            element.src = url
          }))
        }
        return loadedImages.get(url)
      }

      function cropScale(element, size, factor) {
        const horizontalScale = size.width / element.naturalWidth
        const verticalScale = size.height / element.naturalHeight
        const cover = Math.max(horizontalScale, verticalScale)
        if (factor >= 1) return cover * factor
        const contain = Math.min(horizontalScale, verticalScale)
        return contain + (cover - contain) * factor
      }

      function cropBounds(element, size, factor) {
        if (factor === 0) return { width: 1, height: 1, fillRatio: 0 }
        const scale = cropScale(element, size, factor)
        const bounds = {
          width: Math.min(1, size.width / (scale * element.naturalWidth)),
          height: Math.min(1, size.height / (scale * element.naturalHeight))
        }
        return factor < 1 ? { ...bounds, fillRatio: factor } : bounds
      }

      function cropAt(bounds, x = 50, y = 50) {
        return { x: (1 - bounds.width) * x / 100, y: (1 - bounds.height) * y / 100, ...bounds }
      }

      async function prepare(photo, size, logoUrl) {
        const [original, logo] = await Promise.all([image(photo.url), logoUrl ? image(logoUrl).catch(() => {
          throw new Error('No pudimos incluir el logo. Volvé a subirlo en Ajustes del negocio o elegí Sin portada.')
        }) : null])
        return { original, logo, crop: photo.crop || cropAt(cropBounds(original, size, 1)) }
      }

      function draw(canvas, size, picture) {
        canvas.width = size.width
        canvas.height = size.height + (picture.logo ? size.footer : 0)
        const context = canvas.getContext('2d', { alpha: false })
        if (!context) throw new Error(defaultMessage)
        context.fillStyle = '#fffdf8'
        context.fillRect(0, 0, canvas.width, canvas.height)
        const { crop, original, logo } = picture
        const sourceWidth = crop.width * original.naturalWidth
        const sourceHeight = crop.height * original.naturalHeight
        const scale = crop.fillRatio === undefined ? null : cropScale(original, size, crop.fillRatio)
        const width = scale === null ? size.width : Math.min(size.width, sourceWidth * scale)
        const height = scale === null ? size.height : Math.min(size.height, sourceHeight * scale)
        context.drawImage(original, crop.x * original.naturalWidth, crop.y * original.naturalHeight,
          sourceWidth, sourceHeight, (size.width - width) / 2, (size.height - height) / 2, width, height)
        if (logo) {
          const radius = 70
          const center = size.width / 2
          const scale = 108 / Math.max(logo.naturalWidth, logo.naturalHeight)
          const width = logo.naturalWidth * scale
          const height = logo.naturalHeight * scale
          context.beginPath()
          context.arc(center, size.height, radius, 0, Math.PI * 2)
          context.fill()
          context.drawImage(logo, center - width / 2, size.height - height / 2, width, height)
        }
      }

      function activeSize() {
        return activePhoto === model.banner ? bannerSize : gallerySize
      }

      function renderPreviewAddress() {
        const { address, mapsUrl } = dependencies.businessLocation()
        const row = find('preview-location')
        const link = find('preview-address')
        row.hidden = !address
        link.textContent = address
        if (!address) {
          link.removeAttribute('href')
          return
        }
        const fallback = 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(address)
        let href = fallback
        if (typeof mapsUrl === 'string' && /^https:\/\//i.test(mapsUrl) && !/[\s\\]/u.test(mapsUrl)) {
          try {
            const url = new URL(mapsUrl)
            if (!url.username && !url.password) href = url.href
          } catch {}
        }
        link.href = href
      }

      function renderPreview() {
        renderPreviewAddress()
        if (!model) return
        const version = ++previewVersion
        const logo = find('preview-logo')
        logo.hidden = Boolean(model.banner) || !model.logo.url
        if (!logo.hidden) logo.src = model.logo.url
        const pictures = [[find('preview-banner'), model.banner, bannerSize, model.logo.url],
          ...previews.map((canvas, index) => [canvas, model.gallery[index], gallerySize, null])]
        for (const [canvas, photo, size, logoUrl] of pictures) {
          canvas.hidden = !photo
          if (!photo) continue
          prepare(photo, size, logoUrl).then((picture) => {
            if (version === previewVersion) draw(canvas, size, picture)
          }).catch((error) => {
            if (version !== previewVersion) return
            canvas.hidden = true
            message(error.message, 'error')
          })
        }
      }

      async function edit(photo, focus = false) {
        const version = ++cropVersion
        activePhoto = photo
        activeDimensions = null
        find('crop').hidden = true
        if (!photo) return
        const size = activeSize()
        try {
          const picture = await prepare(photo, size, photo === model.banner ? model.logo.url : null)
          if (version !== cropVersion) return
          activeDimensions = picture
          const fit = cropBounds(picture.original, size, 1)
          const crop = picture.crop
          const factor = crop.fillRatio ?? clamp(fit.width / crop.width, 1, 3)
          zoom.value = String(Math.round(factor * 100))
          horizontal.value = String(crop.width < 1 ? Math.round(100 * crop.x / (1 - crop.width)) : 50)
          vertical.value = String(crop.height < 1 ? Math.round(100 * crop.y / (1 - crop.height)) : 50)
          horizontal.disabled = crop.width >= 1
          vertical.disabled = crop.height >= 1
          const index = model.gallery.indexOf(photo)
          find('crop-title').textContent = index < 0 ? 'Ajustar portada' : 'Ajustar foto ' + (index + 1)
          find('crop').hidden = false
          draw(cropCanvas, size, picture)
          if (focus) find('crop-title').focus()
        } catch (error) {
          if (version === cropVersion) message(error.message, 'error')
        }
      }

      function changeCrop() {
        if (!activeDimensions || busy) return
        const bounds = cropBounds(activeDimensions.original, activeSize(), Number(zoom.value) / 100)
        horizontal.disabled = bounds.width >= 1
        vertical.disabled = bounds.height >= 1
        activePhoto.crop = cropAt(bounds, Number(horizontal.value), Number(vertical.value))
        activeDimensions.crop = activePhoto.crop
        draftChanged = true
        draw(cropCanvas, activeSize(), activeDimensions)
        renderPreview()
      }

      function galleryButton(text, label, action, disabled = false) {
        const button = document.createElement('button')
        button.className = 'secondary'
        button.type = 'button'
        button.textContent = text
        button.setAttribute('aria-label', label)
        button.disabled = disabled
        button.addEventListener('click', action)
        return button
      }

      function movePhoto(index, target) {
        const [photo] = model.gallery.splice(index, 1)
        model.gallery.splice(target, 0, photo)
        draftChanged = true
        renderGallery()
        renderPreview()
        void edit(photo)
        find('gallery').children[target].querySelector('button').focus()
      }

      function renderGallery() {
        const available = model.sources.filter((photo) => photo.source === 'gallery' && !model.gallery.some((entry) => entry.ref === photo.ref))
        gallerySource.replaceChildren(new Option(available.length ? 'Elegí una foto' : 'No hay más fotos disponibles', ''),
          ...available.map((photo) => new Option(photo.label, photo.key.split(':')[1])))
        gallerySource.disabled = !available.length || model.gallery.length >= 3
        find('add').disabled = true
        find('gallery').replaceChildren(...model.gallery.map((photo, index) => {
          const item = document.createElement('li')
          const thumb = document.createElement('img')
          const position = index + 1
          thumb.alt = photo.label
          thumb.src = photo.url
          item.append(thumb,
            galleryButton('Ajustar', 'Ajustar foto ' + position, () => { void edit(photo, true) }),
            galleryButton('↑', 'Mover foto ' + position + ' arriba', () => movePhoto(index, index - 1), index === 0),
            galleryButton('↓', 'Mover foto ' + position + ' abajo', () => movePhoto(index, index + 1), index === model.gallery.length - 1),
            galleryButton('Quitar', 'Quitar foto ' + position, () => {
              model.gallery.splice(index, 1)
              draftChanged = true
              renderGallery()
              renderPreview()
              void edit(model.banner)
              const next = find('gallery').children[Math.min(index, model.gallery.length - 1)]
              const focusTarget = next?.querySelector('button') || (gallerySource.disabled ? source : gallerySource)
              focusTarget.focus()
            }))
          return item
        }))
      }

      function galleryOriginals(value) {
        try {
          const items = JSON.parse(value || '[]')
          return Array.isArray(items) ? items.slice(0, 6) : []
        } catch {
          return []
        }
      }

      function applyMedia(media) {
        const saved = media.bookingEmailMedia
        const refs = media.bookingEmailMediaSources || {}
        const gallery = galleryOriginals(media.landingGalleryImages)
        const sources = [
          { key: 'cover', source: 'cover', label: 'Portada actual del negocio', ref: refs.cover, url: media.coverImageUrl },
          ...gallery.map((url, index) => ({ key: 'gallery:' + index, source: 'gallery', label: 'Foto ' + (index + 1) + ' de la galería', ref: refs.gallery?.[index], url }))
        ].filter((photo) => photo.ref && photo.url)
        const match = (photo, kind) => sources.find((item) => item.source === kind && item.ref === photo?.sourceUrl)
        const savedSource = match(saved?.banner, saved?.banner?.source)
        const uploaded = saved?.banner?.source === 'upload'
          ? { key: 'upload', source: 'upload', ref: saved.banner.sourceUrl, url: saved.banner.sourceUrl, crop: saved.banner.crop }
          : null
        const cover = sources.find((photo) => photo.key === 'cover')
        model = {
          media, sources, uploaded,
          logo: { ref: refs.logo || null, url: refs.logo ? media.logoUrl : null },
          banner: saved?.banner === null ? null : uploaded || (savedSource ? { ...savedSource, crop: saved.banner.crop } : cover ? { ...cover } : null),
          gallery: (saved?.gallery || []).flatMap((photo) => {
            const item = match(photo, 'gallery')
            return item ? [{ ...item, crop: photo.crop }] : []
          })
        }
        source.replaceChildren(new Option('Sin portada', 'none'), ...sources.map((photo) => new Option(photo.label, photo.key)),
          new Option('Imagen exclusiva del correo', 'upload'))
        source.value = model.banner?.key || 'none'
        find('upload').value = ''
        find('preview-name').textContent = dependencies.businessName() || 'Tu negocio'
        draftChanged = false
        updateBannerControls()
        renderGallery()
        renderPreview()
        void edit(model.banner)
      }

      function updateBannerControls() {
        find('upload-field').hidden = source.value !== 'upload'
        find('edit-banner').disabled = !model.banner
        find('save').disabled = source.value === 'upload' && !model.banner
      }

      async function load() {
        if (!businessId) return
        const version = ++loadVersion
        form.hidden = true
        find('retry').hidden = true
        message('Cargando imágenes del negocio…')
        loadedImages.clear()
        try {
          const media = await dependencies.getJson(businessPath('media'))
          if (version !== loadVersion) return
          if (!media.bookingEmailMediaSources) throw new Error('No pudimos cargar las imágenes de este negocio.')
          message('')
          applyMedia(media)
          form.hidden = false
        } catch (error) {
          if (version !== loadVersion) return
          message(error.message, 'error')
          find('retry').hidden = false
        }
      }

      async function renderPhoto(photo, size, logoUrl, byteLimit) {
        const picture = await prepare(photo, size, logoUrl)
        const canvas = document.createElement('canvas')
        draw(canvas, size, picture)
        for (const quality of [0.9, 0.75, 0.55]) {
          const imageDataUrl = canvas.toDataURL('image/jpeg', quality)
          if (imageDataUrl.startsWith('data:image/jpeg;base64,') && imageDataUrl.length < byteLimit * 4 / 3) {
            return { sourceUrl: photo.ref, crop: picture.crop, imageDataUrl }
          }
        }
        throw new Error('No pudimos reducir el tamaño de una imagen. Elegí otra foto.')
      }

      root.addEventListener('toggle', () => { if (root.open && !draftChanged && !busy) void load() })
      find('reload').addEventListener('click', () => { void load() })
      find('retry').addEventListener('click', () => { void load() })
      find('edit-banner').addEventListener('click', () => { void edit(model.banner, true) })
      source.addEventListener('change', () => {
        const next = model.sources.find((photo) => photo.key === source.value)
        model.banner = source.value === 'upload' ? model.uploaded : next ? { ...next } : null
        draftChanged = true
        message('')
        updateBannerControls()
        renderPreview()
        void edit(model.banner)
      })
      find('upload').addEventListener('change', async (event) => {
        const file = event.target.files?.[0]
        if (!file) return
        const currentModel = model
        fields.disabled = true
        message('Preparando portada…')
        try {
          if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type) || file.size > 12 * 1024 * 1024) {
            throw new Error('Elegí un archivo JPEG, PNG o WebP de hasta 12 MB.')
          }
          const originalDataUrl = await dependencies.optimizeImageFile(file, 1600)
          if (model !== currentModel) return
          if (originalDataUrl.length >= 2 * 1024 * 1024 * 4 / 3) throw new Error('La portada sigue siendo muy pesada. Elegí una imagen más liviana.')
          model.banner = model.uploaded = { key: 'upload', source: 'upload', url: originalDataUrl, originalDataUrl }
          draftChanged = true
          message('')
          updateBannerControls()
          renderPreview()
          void edit(model.banner)
        } catch (error) {
          if (model === currentModel) message(error.message, 'error')
        } finally {
          if (model === currentModel) fields.disabled = false
          event.target.value = ''
        }
      })
      gallerySource.addEventListener('change', () => { find('add').disabled = !gallerySource.value })
      find('add').addEventListener('click', () => {
        const candidate = model.sources.find((photo) => photo.key === 'gallery:' + gallerySource.value)
        if (!candidate || model.gallery.length === 3) return
        const photo = { ...candidate }
        model.gallery.push(photo)
        draftChanged = true
        renderGallery()
        renderPreview()
        void edit(photo)
        find('gallery').lastElementChild.querySelector('button').focus()
      })
      for (const control of [zoom, horizontal, vertical]) control.addEventListener('input', changeCrop)
      cropCanvas.addEventListener('pointerdown', (event) => {
        if (!activeDimensions || busy || event.button !== 0) return
        cropCanvas.setPointerCapture(event.pointerId)
        drag = { id: event.pointerId, x: event.clientX, y: event.clientY, horizontal: Number(horizontal.value), vertical: Number(vertical.value) }
      })
      cropCanvas.addEventListener('pointermove', (event) => {
        if (!drag || drag.id !== event.pointerId || !activeDimensions) return
        const { width, height } = activeDimensions.crop
        const box = cropCanvas.getBoundingClientRect()
        if (width < 1) horizontal.value = String(clamp(drag.horizontal - 100 * (event.clientX - drag.x) * width / box.width / (1 - width), 0, 100))
        const photoHeight = box.width * activeSize().height / activeSize().width
        if (height < 1) vertical.value = String(clamp(drag.vertical - 100 * (event.clientY - drag.y) * height / photoHeight / (1 - height), 0, 100))
        changeCrop()
      })
      cropCanvas.addEventListener('lostpointercapture', () => { drag = null })

      form.addEventListener('submit', async (event) => {
        event.preventDefault()
        if (!model || busy || find('save').disabled) return
        const currentModel = model
        const path = businessPath('booking-email-media')
        busy = true
        fields.disabled = true
        form.setAttribute('aria-busy', 'true')
        message('Guardando imágenes…')
        try {
          const [banner, gallery] = await Promise.all([
            model.banner ? renderPhoto(model.banner, bannerSize, model.logo.url, 600 * 1024) : null,
            Promise.all(model.gallery.map((photo) => renderPhoto(photo, gallerySize, null, 250 * 1024)))
          ])
          if (model !== currentModel) return
          if (banner) {
            banner.source = model.banner.source
            if (model.banner.originalDataUrl) banner.originalDataUrl = model.banner.originalDataUrl
          }
          const result = await dependencies.getJson(path, {
            method: 'PATCH', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ banner, gallery, logoUrl: model.logo.ref })
          })
          if (model !== currentModel) return
          applyMedia({ ...model.media, bookingEmailMedia: result.bookingEmailMedia })
          message('Imágenes del correo guardadas.', 'success')
        } catch (error) {
          if (model === currentModel) message(error.message, 'error')
        } finally {
          busy = false
          fields.disabled = false
          form.removeAttribute('aria-busy')
        }
      })

      return () => {
        const nextId = dependencies.canEdit() ? dependencies.businessId() : null
        root.hidden = !nextId
        if (businessId === nextId) {
          if (model) renderPreviewAddress()
          return
        }
        businessId = nextId
        loadVersion++
        cropVersion++
        previewVersion++
        model = null
        draftChanged = false
        root.open = false
        form.hidden = true
        message('')
      }
    }
`
