// A vertical page scroll must never select a different look.
export function lookSwipeDirection(start, end, threshold = 45) {
  if (!start || !end) return 0;
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  if (Math.abs(dx) <= threshold || Math.abs(dx) <= Math.abs(dy)) return 0;
  return dx > 0 ? -1 : 1;
}
