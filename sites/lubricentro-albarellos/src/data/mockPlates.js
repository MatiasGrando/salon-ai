export const mockVehicles = {
  "AA123AA": {
    plate: "AA 123 AA",
    ownerInitials: "M. G.",
    brand: "Volkswagen",
    model: "Amarok V6 3.0 TDI Highline 4Motion",
    year: 2021,
    color: "Gris Plata",
    lastServiceDate: "2024-04-18",
    lastServiceKm: 74200,
    estimatedCurrentKm: 82400,
    recommendedNextKm: 84200,
    recommendedNextDate: "2024-10-18",
    status: "warning", // "ok" | "warning" | "danger"
    statusLabel: "Próximo servicio recomendado pronto",
    statusMessage: "Tu próximo service está a menos de 1.800 km o 30 días. Te sugerimos agendar tu turno.",
    urgencyColor: "amber",
    upcomingTasks: [
      { id: 1, item: "Cambio de Aceite Sintético 5W-30 (Norma VW 507.00)", priority: "alta" },
      { id: 2, item: "Reemplazo de Filtro de Aceite y Filtro de Combustible (Diesel)", priority: "alta" },
      { id: 3, item: "Reemplazo de Filtro de Aire de Motor y Habitáculo", priority: "media" },
      { id: 4, item: "Revisión preventiva de espesor de pastillas y discos de freno", priority: "media" }
    ],
    history: [
      {
        id: "SRV-2024-01",
        date: "18 de Abril, 2024",
        km: "74.200 km",
        technician: "Carlos (Taller Albarellos)",
        serviceType: "Service Periódico 70k + Chequeo Integral",
        summary: "Cambio de aceite sintético y filtros completos. Control de fluidos e inspección de tren delantero.",
        items: [
          { name: "Aceite Sintético Liqui Moly Top Tec 4200 5W-30", qty: "8 Litros" },
          { name: "Filtro de Aceite Mann Filter HU 8001 x", qty: "1 unidad" },
          { name: "Filtro de Aire de Motor Mann Filter", qty: "1 unidad" },
          { name: "Filtro de Polen / Habitáculo con carbón activo", qty: "1 unidad" },
          { name: "Líquido Limpiaparabrisas Liqui Moly concentrado", qty: "1 dosis" }
        ],
        inspections: [
          { system: "Frenos Delanteros", state: "Bueno (65% restante)" },
          { system: "Frenos Traseros", state: "Bueno (70% restante)" },
          { system: "Líquido Refrigerante", state: "Punto de congelamiento -25°C (Óptimo)" },
          { system: "Batería", state: "Tensión 12.6V - Prueba de carga OK" }
        ]
      },
      {
        id: "SRV-2023-02",
        date: "04 de Noviembre, 2023",
        km: "64.100 km",
        technician: "Mariano (Taller Albarellos)",
        serviceType: "Frenos + Aceite y Filtro",
        summary: "Sustitución de pastillas de freno delanteras, rectificación leve de discos y purgado de circuito.",
        items: [
          { name: "Pastillas de Freno delanteras Bosch Cerámicas", qty: "1 juego" },
          { name: "Líquido de Freno Bosch DOT 4 HP", qty: "1 Litro" },
          { name: "Aceite Sintético Liqui Moly Top Tec 4200 5W-30", qty: "8 Litros" },
          { name: "Filtro de Aceite Mann Filter", qty: "1 unidad" }
        ],
        inspections: [
          { system: "Eficacia de Frenado", state: "Calibración y prueba en banco OK" },
          { system: "Tren Delantero", state: "Bujes y extremos sin juego" }
        ]
      },
      {
        id: "SRV-2023-01",
        date: "12 de Mayo, 2023",
        km: "53.800 km",
        technician: "Carlos (Taller Albarellos)",
        serviceType: "Service Anual + Batería",
        summary: "Mantenimiento preventivo anual y cambio de batería por pérdida de retención de carga.",
        items: [
          { name: "Batería Moura EFB 80Ah (Start-Stop)", qty: "1 unidad con garantía 18 meses" },
          { name: "Aceite Castrol EDGE 5W-30 Sintético", qty: "8 Litros" },
          { name: "Filtros de Aceite, Combustible y Aire", qty: "Set completo" }
        ],
        inspections: [
          { system: "Sistema de Carga y Alternador", state: "14.2V regulando - Perfecto" }
        ]
      }
    ]
  },

  "AB987CD": {
    plate: "AB 987 CD",
    ownerInitials: "R. P.",
    brand: "Toyota",
    model: "Corolla 2.0 SEG CVT",
    year: 2022,
    color: "Blanco Perlado",
    lastServiceDate: "2024-06-10",
    lastServiceKm: 39500,
    estimatedCurrentKm: 42100,
    recommendedNextKm: 49500,
    recommendedNextDate: "2025-06-10",
    status: "ok",
    statusLabel: "Mantenimiento al día",
    statusMessage: "Tu vehículo está en condiciones óptimas. Tu próximo chequeo es a los 49.500 km o Junio 2025.",
    urgencyColor: "emerald",
    upcomingTasks: [
      { id: 1, item: "Control rutinario de presión de neumáticos y niveles de fluidos", priority: "baja" },
      { id: 2, item: "Próximo service regular de 50.000 km", priority: "normal" }
    ],
    history: [
      {
        id: "SRV-2024-08",
        date: "10 de Junio, 2024",
        km: "39.500 km",
        technician: "Mariano (Taller Albarellos)",
        serviceType: "Service Oficial 40.000 km",
        summary: "Cambio de aceite sintético 0W-20 y filtros. Rotación y balanceo de neumáticos.",
        items: [
          { name: "Aceite Sintético Toyota Genuine 0W-20", qty: "4.2 Litros" },
          { name: "Filtro de Aceite Original Toyota Denso", qty: "1 unidad" },
          { name: "Filtro de Aire y Cabina", qty: "2 unidades" }
        ],
        inspections: [
          { system: "Pastillas de Freno", state: "80% de vida útil restante" },
          { system: "Neumáticos", state: "Dibujo 6.2 mm uniforme" }
        ]
      }
    ]
  },

  "AF345XY": {
    plate: "AF 345 XY",
    ownerInitials: "J. L.",
    brand: "Ford",
    model: "Ranger 3.2 TDCi Limited 4x4",
    year: 2020,
    color: "Azul Oxford",
    lastServiceDate: "2023-09-14",
    lastServiceKm: 98000,
    estimatedCurrentKm: 114500,
    recommendedNextKm: 108000,
    recommendedNextDate: "2024-03-14",
    status: "danger",
    statusLabel: "¡Servicio vencido por tiempo y kilometraje!",
    statusMessage: "Superaste los 10.000 km y 12 meses desde la última intervención. Recomendamos ingresar de urgencia para proteger el turbo y el motor.",
    urgencyColor: "rose",
    upcomingTasks: [
      { id: 1, item: "Cambio Urgente de Aceite 5W-30 y Filtro", priority: "urgente" },
      { id: 2, item: "Sustitución de Filtro de Gasoil Trampa de Agua", priority: "urgente" },
      { id: 3, item: "Chequeo urgente de discos y pastillas de freno", priority: "urgente" },
      { id: 4, item: "Escaneo computarizado de inyección y sensores", priority: "alta" }
    ],
    history: [
      {
        id: "SRV-2023-11",
        date: "14 de Septiembre, 2023",
        km: "98.000 km",
        technician: "Carlos (Taller Albarellos)",
        serviceType: "Service 100k Preventivo",
        summary: "Cambio de fluidos de motor y filtro de combustible.",
        items: [
          { name: "Aceite Sintético Motorcraft 5W-30", qty: "9.8 Litros" },
          { name: "Filtro de Aceite y Combustible", qty: "2 unidades" }
        ],
        inspections: [
          { system: "Observación", state: "Se avisó al cliente que pastillas de freno estaban al límite" }
        ]
      }
    ]
  }
};
