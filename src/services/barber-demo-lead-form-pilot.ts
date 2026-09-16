// Draft configuration for the existing, handcrafted Barber Demo contact form.
// No database write or feature activation happens merely by importing this file.
export const BARBER_DEMO_FORM_PILOT = {
  businessCustomerCode: 'WX-38N6UG',
  publicSlug: 'barber-demo-course-lead',
  name: 'Consulta de cursos y asesoría',
  status: 'DRAFT',
  rewardMode: 'NONE',
  schemaVersion: 1,
  fields: [
    { key: 'nombre', label: 'Nombre y apellido', type: 'TEXT', required: true, order: 0, mapping: { target: 'CONTACT_NAME' } },
    { key: 'telefono', label: 'WhatsApp / teléfono', type: 'PHONE', required: true, order: 1, mapping: { target: 'PHONE' } },
    { key: 'email', label: 'Correo electrónico', type: 'EMAIL', required: true, order: 2, mapping: { target: 'EMAIL' } },
    { key: 'curso_interes', label: 'Curso de interés', type: 'SELECT', required: true, order: 3, mapping: { target: 'CUSTOM_DATA', customKey: 'curso_interes' }, options: [
      { value: 'Asesoría personalizada (Entrevista 1 a 1)', label: 'Asesoría personalizada' },
      { value: 'Curso Demo 1 — Marketing Digital', label: 'Marketing digital' },
      { value: 'Curso Demo 2 — Redes Sociales', label: 'Redes sociales' },
      { value: 'Curso Demo 3 — Ventas Online', label: 'Ventas online' },
      { value: 'Pack Completo (3 Cursos)', label: 'Pack completo' }
    ] },
    { key: 'agendar_entrevista', label: 'Solicita entrevista', type: 'CHECKBOX', required: false, order: 4, mapping: { target: 'CUSTOM_DATA', customKey: 'agendar_entrevista' } },
    { key: 'fecha_entrevista', label: 'Día preferido', type: 'TEXT', required: false, order: 5, mapping: { target: 'CUSTOM_DATA', customKey: 'fecha_entrevista' } },
    { key: 'horario_entrevista', label: 'Horario preferido', type: 'TEXT', required: false, order: 6, mapping: { target: 'CUSTOM_DATA', customKey: 'horario_entrevista' } },
    { key: 'mensaje', label: 'Consulta', type: 'TEXTAREA', required: false, order: 7, mapping: { target: 'CUSTOM_DATA', customKey: 'mensaje' } }
  ]
} as const
