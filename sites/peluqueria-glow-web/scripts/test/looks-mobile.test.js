import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, statSync } from 'node:fs';

const source = file => readFileSync(new URL(`../../src/${file}`, import.meta.url), 'utf8');

test('mobile looks groups a viewport-sized portrait and CTA without changing desktop geometry', () => {
  const component = source('components/BeforeAfterSlider.jsx');
  const css = source('index.css');
  for (const name of ['glow-looks', 'glow-looks__stage', 'glow-looks__frame', 'glow-looks__caption', 'glow-looks__filters', 'glow-looks__thumbnails']) {
    assert.ok(component.includes(name), `missing scoped hook ${name}`);
  }
  assert.match(component, /sm:h-\[800px\] md:h-\[890px\] lg:h-\[950px\]/);
  assert.match(css, /@media \(max-width: 639px\)\s*\{\s*\.glow-looks\s*\{/);
  assert.match(css, /--look-media-height:\s*clamp\([^;]*100svh[^;]*\)/);
  assert.match(css, /\.glow-looks__stage\s*\{[^}]*height:\s*calc\(var\(--look-media-height\) \+ 88px\)/s);
  assert.match(css, /\.glow-looks__card\[data-active="false"\]\s*\{[^}]*display:\s*none/s);
  assert.match(css, /\.glow-looks__filters\s*\{[^}]*flex-wrap:\s*nowrap;[^}]*overflow-x:\s*auto/s);
  assert.match(css, /\.glow-looks__thumbnails\s*\{[^}]*justify-content:\s*flex-start/s);
  assert.match(css, /\.glow-looks__comparison\s*\{[^}]*touch-action:\s*pan-y/s);
  assert.match(component, /openBooking\(selectedBranch\)/);
});

test('comparison and carousel distinguish horizontal intent from page scrolling', async () => {
  const { lookSwipeDirection } = await import('../../src/data/glowLooks.js');
  assert.equal(lookSwipeDirection({ x: 100, y: 100 }, { x: 180, y: 115 }), -1);
  assert.equal(lookSwipeDirection({ x: 100, y: 100 }, { x: 20, y: 115 }), 1);
  assert.equal(lookSwipeDirection({ x: 100, y: 100 }, { x: 155, y: 220 }), 0);
  assert.equal(lookSwipeDirection({ x: 100, y: 100 }, { x: 120, y: 100 }), 0);
  assert.equal(lookSwipeDirection(null, { x: 120, y: 100 }), 0);
  const component = source('components/BeforeAfterSlider.jsx');
  assert.match(component, /closest\('\.glow-looks__comparison'\)/);
  assert.match(component, /onTouchCancel=\{\(\) => \{ touchStart\.current = null; \}\}/);
});

test('the initial comparison uses compressed webp assets', () => {
  const component = source('components/BeforeAfterSlider.jsx');
  assert.match(component, /beforeImg: '\/alisado-before-v2\.webp'/);
  assert.match(component, /afterImg: '\/alisado-after-v2\.webp'/);
  for (const file of ['alisado-before-v2.webp', 'alisado-after-v2.webp']) {
    assert.ok(statSync(new URL(`../../public/${file}`, import.meta.url)).size < 80 * 1024);
  }
});
