import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = file => readFileSync(new URL(`../../src/${file}`, import.meta.url), 'utf8');

test('mobile hero uses portrait art direction and clears fixed navigation', () => {
  const hero = source('components/Hero.jsx');
  const css = source('index.css');
  assert.match(hero, /className="glow-hero /);
  assert.match(hero, /className="glow-hero__visual /);
  assert.match(hero, /className="glow-hero__image /);
  assert.match(hero, /className="glow-hero__controls /);
  assert.match(css, /@media \(max-width: 639px\)/);
  assert.match(hero, /<picture className="glow-hero__picture[^>]*>[\s\S]*<source media="\(max-width: 639px\)" srcSet="\/hero-glow-mobile-v1\.png"/);
  assert.match(hero, /src="\/hero-glow\.jpg"/);
  assert.match(css, /\.glow-hero__visual\s*\{[^}]*top:\s*calc\(104px \+ env\(safe-area-inset-top, 0px\)\);[^}]*bottom:\s*0;[^}]*height:\s*auto/s);
  assert.match(css, /\.glow-hero__image\s*\{[^}]*object-fit:\s*cover;[^}]*object-position:\s*center top/s);
  assert.match(css, /\.glow-hero__controls\s*\{[^}]*padding-bottom:\s*calc\(88px \+ env\(safe-area-inset-bottom, 0px\)\)/s);
  assert.match(css, /\.glow-hero__selector button\s*\{[^}]*min-height:\s*44px/s);
  assert.match(css, /\.glow-hero__actions > \*\s*\{[^}]*min-height:\s*48px/s);
  assert.match(hero, /openBooking\(selectedBranch\)/);
  assert.match(hero, /scrollY \* 0\.2/);
});

test('reviewed portrait asset is served publicly only through the Glow media allowlist', () => {
  const route = readFileSync(new URL('../../../../src/routes/glow-site.ts', import.meta.url), 'utf8');
  assert.match(route, /const publicFiles = new Set\([\s\S]*'hero-glow-mobile-v1\.png'/);
});

test('mobile branch selection exposes its selected state without changing its flow', () => {
  const hero = source('components/Hero.jsx');
  for (const branch of ['urquiza', 'canitas']) {
    assert.match(hero, new RegExp(`aria-pressed=\\{selectedBranch === '${branch}'\\}`));
    assert.match(hero, new RegExp(`setSelectedBranch\\('${branch}'\\)`));
  }
});
