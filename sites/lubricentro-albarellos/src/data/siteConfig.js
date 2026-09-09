export const siteConfig = {
  name: "Lubricentro Albarellos",
  tagline: "Más que un cambio",
  subTagline: "Tu auto en buenas manos",
  slogan: "Pasión por tu motor",
  phone: "11 2805-2233",
  phoneRaw: "1528052233",
  whatsapp: "5491128052233",
  email: "contacto@lubricentroalbarellos.com",
  address: "Av. Albarellos 2840",
  locationName: "Villa Urquiza, CABA",
  fullAddress: "Av. Albarellos 2840, Villa Urquiza, CABA",
  hours: {
    weekdays: "Lunes a Viernes: 8:00 a 18:00 hs",
    saturdays: "Sábados: 8:00 a 14:00 hs",
    sundays: "Domingos: Cerrado",
    summary: "Lun a Vie: 08:00 a 18:00 | Sáb: 08:00 a 14:00"
  },
  googleMapsUrl: "https://maps.google.com/?q=Av.+Albarellos+2840+Villa+Urquiza+CABA",
  socials: {
    instagram: "https://www.instagram.com/lubricentroalbarellos/",
    facebook: "https://www.facebook.com/lubricantesalbarellos/?ref=NONE_xav_ig_profile_page_web#"
  },
  getWhatsAppLink: (message) => {
    const text = encodeURIComponent(message || "¡Hola! Quiero hacer una consulta a Lubricentro Albarellos.");
    return `https://wa.me/5491128052233?text=${text}`;
  }
};
