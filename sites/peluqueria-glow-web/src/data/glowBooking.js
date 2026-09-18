const destinations = Object.freeze({
  urquiza:'https://weex.com.ar/glowurquiza/reservar?template=salon-white',
  canitas:'https://weex.com.ar/glowcanitas/reservar?template=salon-white',
});
const allowed = branch => Object.hasOwn(destinations,branch);
export const bookingEntry = branch => allowed(branch) ? `/reservar?sede=${branch}` : '/reservar';
export const branchFromSearch = search => {
  const branch = new URLSearchParams(search).get('sede');
  return allowed(branch) ? branch : null;
};
export const openBooking = branch => window.location.assign(bookingEntry(branch));
export const safeBookingDestination = (catalog, branch) => allowed(branch) && catalog?.branchId === branch && catalog.status === 'ready' && catalog.address && catalog.bookingUrl === destinations[branch] ? destinations[branch] : null;
