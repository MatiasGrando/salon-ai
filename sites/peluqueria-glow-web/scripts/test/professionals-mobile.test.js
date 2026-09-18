import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const section = readFileSync(new URL('../../src/components/ProfessionalsSection.jsx', import.meta.url), 'utf8');

test('professional cards are compact rows on phones and retain portrait layout on desktop', () => {
  assert.match(section, /glow-professionals__card/);
  assert.match(section, /glow-professionals__portrait/);
  assert.match(section, /glow-professionals__summary/);
  assert.match(section, /sm:flex-col/);
  assert.match(section, /w-\[clamp\(112px,36vw,140px\)\]/);
  assert.match(section, /sm:aspect-\[4\/5\]/);
});

test('profile dialog escapes the section and keeps actions visible on mobile', () => {
  assert.match(section, /createPortal\(/);
  assert.match(section, /role="dialog" aria-modal="true"/);
  assert.match(section, /h-\[100dvh\]/);
  assert.match(section, /h-auto max-h-\[calc\(100dvh-32px\)\]/);
  assert.match(section, /z-\[100\]/);
  assert.match(section, /selectedPro\?\.image && !modalImageFailed/);
  assert.match(section, /mt-auto/);
});

test('professional cards keep image, name, role, description, and full-profile access', () => {
  assert.match(section, /src=\{pro\.image\}/);
  assert.match(section, /\{pro\.name\}/);
  assert.match(section, /\{pro\.taglineRole\}/);
  assert.match(section, /\{pro\.shortDescription/);
  assert.match(section, /Ver perfil completo/);
});
