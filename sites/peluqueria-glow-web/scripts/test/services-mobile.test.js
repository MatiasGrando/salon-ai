import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const section = readFileSync(new URL('../../src/components/ServicesSection.jsx', import.meta.url), 'utf8');
const css = readFileSync(new URL('../../src/components/ServicesMobile.css', import.meta.url), 'utf8');

test('mobile services have scoped fluid composition and complete editorial copy', () => {
  assert.match(section, /import '\.\/ServicesMobile.css'/);
  assert.match(css, /@media \(max-width: 639px\)/);
  assert.match(css, /\.glow-services__featured-copy p[\s\S]*?-webkit-line-clamp: unset/);
  assert.match(css, /\.glow-services__featured \{[^}]*height: auto/);
  assert.match(css, /\.glow-services__card-image \{[^}]*width: clamp/);
  assert.match(section, /glow-services__mobile-selector/);
});

test('mobile service navigation and reservation targets are touch sized', () => {
  assert.match(css, /\.glow-services :is\(button\) \{ min-height: 44px/);
  assert.match(css, /\.glow-services__arrow \{[^}]*width: 44px;[^}]*height: 44px/);
  assert.match(css, /\.glow-services__arrow \{[^}]*top: 72px/);
  assert.match(section, /aria-pressed=\{activeTab === cat.id\}/);
  assert.match(section, /aria-expanded=\{isExpanded\}/);
  assert.match(section, /openBooking\(selectedBranch\)/);
  assert.match(section, /const SERVICES = catalog.services/);
});

test('featured editorial cards use portrait art on phones without replacing desktop art', () => {
  assert.match(section, /mobileImage: '\/featured-balayage-mobile-v1\.png'/);
  assert.match(section, /mobileImage: '\/featured-corte-mobile-v1\.png'/);
  assert.match(section, /<picture>[\s\S]*?<source media="\(max-width: 639px\)" srcSet=\{banner1\.mobileImage\}/);
  assert.match(section, /src=\{banner2\.image\}/);
  assert.match(css, /\.glow-services__featured \{[^}]*min-height: 440px/);
});

test('catalog previews four services on phones and retains six on desktop', () => {
  assert.match(section, /matchMedia\('\(max-width: 639px\)'\)/);
  assert.match(section, /addEventListener\('change', updateMobile\)/);
  assert.match(section, /const initialCardsCount = isMobile \? 4 : 6/);
  assert.match(section, /categoryServices\.slice\(0, initialCardsCount\)/);
  assert.match(section, /const hasMoreCards = categoryServices\.length > initialCardsCount/);
});
