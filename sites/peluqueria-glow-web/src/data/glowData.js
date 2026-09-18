// Centralized data for Peluqueria Glow
export const BRANCHES = {
  urquiza: {
    id: "urquiza",
    name: "Villa Urquiza",
    tagline: "Sede Central & Barber Studio",
    address: "Av. Olazábal 5036",
    neighborhood: "Villa Urquiza, CABA",
    phone: "011 4523-8117",
    phoneClean: "01145238117",
    whatsapp: "5491138123043",
    hours: "Martes a Sábados de 11:00 a 20:00 hs",
    mapUrl: "https://maps.google.com/?q=Av.+Olazabal+5036,+Villa+Urquiza,+Buenos+Aires",
    features: ["Especialistas en Rubios", "Barbería Exclusiva", "Tratamientos Moleculares", "Uñas & Manicura"],
    badge: "Sede Urquiza",
  },
  canitas: {
    id: "canitas",
    name: "Las Cañitas",
    tagline: "Boutique Color & Hair Spa",
    address: "Teodoro García 1828",
    neighborhood: "Las Cañitas (Palermo), CABA",
    phone: "011 5754-4991",
    phoneClean: "01157544991",
    whatsapp: "5491157544991",
    hours: "Martes a Sábados de 11:00 a 20:00 hs",
    mapUrl: "https://maps.google.com/?q=Teodoro+Garcia+1828,+Palermo,+Buenos+Aires",
    features: ["Colorimetría Premium", "Balayage & Babylights", "Cortes Tendencia", "Nail Bar & Spa"],
    badge: "Sede Cañitas",
  }
};

export const CATEGORIES = [
  { id: "all", name: "Todos" },
  { id: "color", name: "Color & Balayage" },
  { id: "cortes", name: "Cortes & Peinados" },
  { id: "tratamientos", name: "Tratamientos Capilares" },
  { id: "barberia", name: "Barbería Masculina" },
  { id: "unas", name: "Uñas & Beauty" },
];

export const SERVICES = [
  {
    id: "balayage-signature",
    name: "Balayage Signature Glow",
    category: "color",
    duration: "3h 30m",
    priceRange: "Desde $55.000",
    popular: true,
    featured: true,
    badge: "Más Solicitado",
    bannerTag: "SERVICIO DESTACADO",
    image: "https://images.unsplash.com/photo-1519699047748-de8e457a634e?q=80&w=800&auto=format&fit=crop",
    description: "Degradé luminoso sin efecto raíz evidente. Aporta dimensión, luz natural y un brillo deslumbrante personalizado según tu base y tono de piel.",
    includes: ["Diagnóstico capilar personalizado", "Decoloración cuidada con protector de enlaces", "Matización / Tonalización", "Brushing y styling con ondas Glow"]
  },
  {
    id: "babylights-blonde",
    name: "Babylights & Full Blonde",
    category: "color",
    duration: "3h 45m",
    priceRange: "Desde $58.000",
    popular: true,
    featured: true,
    badge: "Tendencia",
    bannerTag: "TENDENCIA",
    image: "https://images.unsplash.com/photo-1580618672591-eb180b1a973f?q=80&w=800&auto=format&fit=crop",
    description: "Micro-mechas ultra finas desde la raíz para un rubio uniforme, vibrante y multidimensional sin cortes abruptos.",
    includes: ["Técnica de foil micro-tejido", "Matiz platino, manteca o beige", "Nutrición selladora de cutícula", "Modelado final"]
  },
  {
    id: "tratamiento-molecular",
    name: "Restauración Molecular Profunda",
    category: "tratamientos",
    duration: "1h 15m",
    priceRange: "Desde $28.000",
    popular: true,
    featured: true,
    badge: "Recuperación",
    bannerTag: "EXCLUSIVO GLOW",
    image: "/alisado-after.png",
    description: "Tratamiento de choque que reconstruye los enlaces de queratina rotos por decoloraciones o calor extremo. Devuelve elasticidad y brillo espejo.",
    includes: ["Lavado purificante", "Inyección de péptidos y aminoácidos", "Sellado térmico y ampolla de brillo"]
  },
  {
    id: "morena-iluminada",
    name: "Morena Iluminada Glow",
    category: "color",
    duration: "3h",
    priceRange: "Desde $50.000",
    popular: true,
    featured: true,
    badge: "Favorito",
    bannerTag: "FAVORITO",
    image: "https://images.unsplash.com/photo-1522337360788-8b13dee7a37e?q=80&w=800&auto=format&fit=crop",
    description: "Puntos de luz en tonos avellana, miel, caramelo o canela sobre cabellos oscuros o castaños. Luz natural sin alterar tu base.",
    includes: ["Técnica a mano alzada / contouring", "Baño de luz y glossing", "Nutrición intensiva"]
  },
  {
    id: "corte-femenino-styling",
    name: "Corte Femenino & Styling Glow",
    category: "cortes",
    duration: "50 min",
    priceRange: "Desde $18.000",
    popular: true,
    featured: false,
    badge: "Esencial",
    bannerTag: "ESENCIAL",
    image: "https://images.unsplash.com/photo-1595476108010-b4d1f102b1b1?q=80&w=800&auto=format&fit=crop",
    description: "Asesoramiento visagista según tu rostro y tipo de textura capilar (lacio, con ondas, rulos o fino). Incluye lavado relax y peinado.",
    includes: ["Lavado con masaje capilar", "Corte de diseño a tijera/navaja", "Brushing y secado con movimiento"]
  },
  {
    id: "corte-masculino-fade",
    name: "Corte Masculino & Fade Barber",
    category: "barberia",
    duration: "40 min",
    priceRange: "Desde $14.000",
    popular: true,
    featured: false,
    badge: "Top Barber",
    bannerTag: "BARBER STUDIO",
    image: "/banner-corte-hombre.jpg",
    description: "Degradé pulido (Skin fade, Taper o Clásico) con tijera en cúspide y acabado con navaja o shaver. Estilo impecable.",
    includes: ["Lavado refrescante", "Perfilado de contornos", "Styling con cera mate o pomada premium"]
  },
  {
    id: "alisado-espejo-organico",
    name: "Alisado Espejo Orgánico",
    category: "tratamientos",
    duration: "2h 30m",
    priceRange: "Desde $35.000",
    popular: true,
    featured: true,
    badge: "Brillo Espejo",
    bannerTag: "TRANSFORMACIÓN",
    image: "https://images.unsplash.com/photo-1527799820374-dcf8d9d4a388?q=80&w=800&auto=format&fit=crop",
    description: "Alisado progresivo sin formol que sella cutículas, elimina el volumen indeseado y aporta un reflejo espejo impecable por meses.",
    includes: ["Diagnóstico previo", "Aplicación de activos orgánicos", "Sellado térmico de precisión"]
  },
  {
    id: "nutricion-botox-capilar",
    name: "Botox Capilar & Anti-Frizz",
    category: "tratamientos",
    duration: "1h 30m",
    priceRange: "Desde $25.000",
    popular: false,
    featured: false,
    badge: "Efecto Seda",
    bannerTag: "SPA CAPILAR",
    image: "/balayage-after-916.jpg",
    description: "Rellena la fibra capilar, reduce el volumen no deseado, elimina el frizz y aporta una suavidad inigualable de larga duración.",
    includes: ["Diagnóstico de porosidad", "Aplicación de ácido hialurónico y colágeno", "Planchado sellador"]
  },
  {
    id: "ritual-barba-completa",
    name: "Perfilado & Ritual de Barba",
    category: "barberia",
    duration: "30 min",
    priceRange: "Desde $10.000",
    popular: false,
    featured: false,
    badge: "Relax",
    bannerTag: "BARBERÍA",
    image: "https://images.unsplash.com/photo-1621605815971-fbc98d665033?q=80&w=600&auto=format&fit=crop",
    description: "Diseño y recorte de barba con toalla caliente, aceites esenciales hidratantes y afeitado tradicional a navaja.",
    includes: ["Toalla caliente aromatizada", "Aceite nutritivo", "After shave calmante"]
  },
  {
    id: "manicura-semipermanente",
    name: "Manicura Rusa & Semipermanente",
    category: "unas",
    duration: "1h 15m",
    priceRange: "Desde $15.000",
    popular: false,
    featured: false,
    badge: "Nails Glow",
    bannerTag: "BEAUTY & NAILS",
    image: "https://images.unsplash.com/photo-1632345031435-8727f6897d53?q=80&w=600&auto=format&fit=crop",
    description: "Cuidado minucioso de cutículas con torno, nivelación con base rubber y esmaltado de alta duración con brillo cristal.",
    includes: ["Limpieza profunda de cutículas", "Esmaltado en gel color o vía láctea", "Hidratación de cutículas con sérum"]
  },
  {
    id: "color-total-gloss",
    name: "Color Total & Baño de Glossing",
    category: "color",
    duration: "1h 45m",
    priceRange: "Desde $32.000",
    popular: false,
    featured: false,
    badge: "Color Intenso",
    bannerTag: "COLORACIÓN",
    image: "/look-cobrizo.jpg",
    description: "Cobertura total o cambio de tono uniforme con fórmulas nutritivas de bajo amoníaco y sellado final con glossing de brillo.",
    includes: ["Aplicación de color de raíz a puntas", "Lavado con fijador de pigmento", "Peinado final"]
  },
  {
    id: "spa-capilar-detox",
    name: "Spa Capilar Detox & Peeling",
    category: "tratamientos",
    duration: "50 min",
    priceRange: "Desde $19.000",
    popular: false,
    featured: false,
    badge: "Salud del Cuero Cabelludo",
    bannerTag: "DETOX",
    image: "https://images.unsplash.com/photo-1560869713-7d0a29430803?q=80&w=600&auto=format&fit=crop",
    description: "Exfoliación suave del cuero cabelludo para oxigenar folículos, eliminar residuos de productos y estimular el crecimiento fuerte.",
    includes: ["Peeling exfoliante purificante", "Masaje estimulante de 15 min", "Mascarilla hidratante de medios a puntas"]
  }
];

export const BEFORE_AFTER_DATA = {
  beforeImg: "https://images.unsplash.com/photo-1522337360788-8b13dee7a37e?q=80&w=900&auto=format&fit=crop",
  afterImg: "https://images.unsplash.com/photo-1519699047748-de8e457a634e?q=80&w=900&auto=format&fit=crop",
  title: "Transformación Balayage Rubio Perla & Tratamiento Molecular",
  technique: "Balayage a mano alzada + Babylights de contorno + Glossing Perla",
  author: "Equipo Coloristas Glow Urquiza",
  description: "Pasamos de una base castaña apagada y con decoloración desgastada a un rubio limpio, sedoso y con máxima luminosidad sin dañar la fibra."
};

export const LOOKBOOK_ITEMS = [
  {
    id: 1,
    title: "Balayage Vainilla Glow",
    category: "Balayage",
    likes: "1.4k",
    img: "https://images.unsplash.com/photo-1560869713-7d0a29430803?q=80&w=800&auto=format&fit=crop",
    branch: "Urquiza"
  },
  {
    id: 2,
    title: "Morena Iluminada Caramelo",
    category: "Color",
    likes: "980",
    img: "https://images.unsplash.com/photo-1492106087820-71f1a00d2b11?q=80&w=800&auto=format&fit=crop",
    branch: "Cañitas"
  },
  {
    id: 3,
    title: "Platino Ice & Bob Cut",
    category: "Cortes",
    likes: "2.1k",
    img: "https://images.unsplash.com/photo-1519699047748-de8e457a634e?q=80&w=800&auto=format&fit=crop",
    branch: "Urquiza"
  },
  {
    id: 4,
    title: "Corte Fade & Perfilado Barber",
    category: "Barbería",
    likes: "850",
    img: "https://images.unsplash.com/photo-1503951914875-452162b0f3f1?q=80&w=800&auto=format&fit=crop",
    branch: "Urquiza"
  },
  {
    id: 5,
    title: "Brushing Glow con Ondas Descontracturadas",
    category: "Styling",
    likes: "1.2k",
    img: "https://images.unsplash.com/photo-1522337360788-8b13dee7a37e?q=80&w=800&auto=format&fit=crop",
    branch: "Cañitas"
  },
  {
    id: 6,
    title: "Rubio Manteca & Baby Highlights",
    category: "Balayage",
    likes: "1.8k",
    img: "https://images.unsplash.com/photo-1580618672591-eb180b1a973f?q=80&w=800&auto=format&fit=crop",
    branch: "Cañitas"
  }
];

export const TESTIMONIALS = [
  {
    id: 1,
    name: "Sofia Russo",
    badge: "6 opiniones · 2 fotos",
    branch: "Urquiza",
    service: "Balayage Signature & Decoloración",
    text: "me gusto mucho! me hice un balayage y entendieron perfectamente lo que queria, todos super buena onda y cris un genio de la decoloración. gracias 💘💘",
    rating: 5,
    date: "Hace 3 meses",
    likes: 2
  },
  {
    id: 2,
    name: "Joaquina Rossi",
    badge: "Local Guide · 32 opiniones",
    branch: "Cañitas",
    service: "Corte & Estilo",
    text: "Te cortan rapido y son muy buena onda. Quizas muy rapido para lo que estoy acostumbrada. Recomiendo para salir del paso",
    rating: 5,
    date: "Hace un mes",
    likes: 2
  },
  {
    id: 3,
    name: "Dalila",
    badge: "4 opiniones · 2 fotos",
    branch: "Urquiza",
    service: "Baño de Crema & Planchita",
    text: "Un lujo todo te atienden rápido y tienen mucho cuidado con tu pelo, me hice un baño de crema y planchita ME ENCANTA GRACIAS MILES",
    rating: 5,
    date: "Hace un mes",
    likes: 2
  },
  {
    id: 4,
    name: "Ofelia Gonzalez",
    badge: "Local Guide · 21 opiniones",
    branch: "Cañitas",
    service: "Baño de Crema & Asesoramiento",
    text: "Muy buena experiencia. Fui a hacerme un baño de crema, me atendió Sofi, súper atenta y predispuesta. Además de realizar el tratamiento, me dio varios tips para el cuidado de mi pelo y me asesoró según mis necesidades.",
    rating: 5,
    date: "Hace 3 meses",
    likes: 1
  },
  {
    id: 5,
    name: "Mariana Mariana",
    badge: "Local Guide · 20 opiniones",
    branch: "Urquiza",
    service: "Corte & Diagnóstico",
    text: "Llegue por la promo de pasitos y me trataron de 10. Respetaron el corte que pedí y me asesoraron. Me cortó Agus lo súper recomiendo. Es difícil encontrar una pelu de confianza y sin duda volveré. El espacio súper lindo, limpio, música copada, buena onda (:",
    rating: 5,
    date: "Hace un mes",
    likes: 1
  },
  {
    id: 6,
    name: "Azul Candela Martino",
    badge: "Clienta frecuente",
    branch: "Urquiza",
    service: "Color & Nutrición",
    text: "Los chicos son unos genios hace más de 6 años que solamente me hago el color de pelo acá, no confío en ningún otro lugar. Te dejan el pelo súper lindo y además te lo cuidan ! Los recomiendo siempre",
    rating: 5,
    date: "Hace 3 meses",
    likes: 1
  },
  {
    id: 7,
    name: "Adrielly Ribeiro",
    badge: "8 opiniones",
    branch: "Cañitas",
    service: "Baño de Crema Gloss",
    text: "Muy buena experiencia. Me hice un baño de crema y quedó excelente. La atención fue impecable, todos fueron muy atentos y amables.",
    rating: 5,
    date: "Hace 2 meses",
    likes: 0
  },
  {
    id: 8,
    name: "Marti Prena",
    badge: "5 opiniones",
    branch: "Urquiza",
    service: "Hidratación & Corte de Puntas",
    text: "Muy buena experiencia. Me hice hidratación y corte y quedó hermoso. El trato fue buenísimo, súper profesionales y se nota que usan buenos productos. Me fui re contenta con el resultado. Volvería sin dudas!",
    rating: 5,
    date: "Hace 6 meses",
    likes: 4
  },
  {
    id: 9,
    name: "Pilar Hernández",
    badge: "9 opiniones · 6 fotos",
    branch: "Cañitas",
    service: "Baño de Crema & Brillo",
    text: "Me hice un baño de crema y quedé muy contenta. La atención fue súper amable. El pelo quedó brilloso y suave.",
    rating: 5,
    date: "Hace 1 semana",
    likes: 0
  },
  {
    id: 10,
    name: "Milagros Noblia",
    badge: "Local Guide · 20 opiniones",
    branch: "Urquiza",
    service: "Hidratación Profunda",
    text: "Excelente atención y muy amorosos todos!! Me hice una hidratación y salí con el pelo hermoso. Claramente volveré. Super recomiendo ⭐️",
    rating: 5,
    date: "Hace 2 meses",
    likes: 1
  },
  {
    id: 11,
    name: "Diego Galeano",
    badge: "Local Guide · 23 opiniones",
    branch: "Cañitas",
    service: "Corte & Barber Studio",
    text: "Agus y equipo unos genios. Siempre te hacen un lugar en la agenda. Y gran atención. Me mudé del barrio y elijo volver x eso. Gracias Rider...",
    rating: 5,
    date: "Hace 2 meses",
    likes: 1
  }
];

export const FAQS = [
  {
    q: "¿Cómo reservo mi turno?",
    a: "Podés reservar directamente por WhatsApp haciendo clic en cualquiera de nuestros botones de turno. También trabajamos con agenda online vía Weex. Te recomendamos reservar con 48 a 72 hs de anticipación para fines de semana."
  },
  {
    q: "¿Hacen diagnóstico capilar previo?",
    a: "¡Sí! Para trabajos de colorimetría grande (Balayage, cambios radicales de color o correcciones), realizamos un diagnóstico capilar y prueba de mecha sin cargo para evaluar la salud de tu fibra."
  },
  {
    q: "¿Qué medios de pago aceptan?",
    a: "Aceptamos efectivo (con descuento especial), transferencia bancaria / Mercado Pago y todas las tarjetas de crédito y débito."
  },
  {
    q: "¿Cuál es la diferencia entre las dos sucursales?",
    a: "Ambas sucursales comparten el mismo estándar de calidad y productos de primera línea. Urquiza cuenta con un amplio sector de barbería masculina además de salón femenino, mientras que Cañitas es un espacio boutique enfocado en colorimetría de autor y spa capilar."
  }
];
