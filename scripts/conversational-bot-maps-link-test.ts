import assert from 'node:assert/strict'
import { publicMapsLink } from '../src/conversational-bot/maps-link.js'

const place = publicMapsLink({ businessName: 'Example', address: 'Monroe 2266', addressArea: 'Villa Urquiza', mapsUrl: 'https://www.google.com/maps/place/Example/?very=long' })
assert.equal(place?.label, 'Ver en Maps')
const url = new URL(place!.url)
assert.equal(url.origin + url.pathname, 'https://www.google.com/maps/search/')
assert.equal(url.searchParams.get('api'), '1')
assert.equal(url.searchParams.get('query'), 'Example, Monroe 2266, Villa Urquiza')
assert.equal(place?.address, 'Monroe 2266, Villa Urquiza')
assert.equal(place?.precision, 'address_search')
assert.equal(publicMapsLink({ address: null, addressArea: 'Only an area', mapsUrl: null }), null)
assert.equal(publicMapsLink({ mapsUrl: 'https://www.google.com/maps/place/Example' })?.precision, 'configured_link')
for (const mapsUrl of ['javascript:alert(1)', 'http://www.google.com/maps/a', 'https://www.google.com.evil.test/maps/a', 'https://evil.test', 'https://user:pass@www.google.com/maps/a', 'https://www.google.com/maps/a\u0000']) {
  assert.equal(publicMapsLink({ mapsUrl }), null)
}
assert.equal(publicMapsLink({ address: 'a'.repeat(2000) }), null, 'never exceed documented 2KB URL budget')
assert.equal(publicMapsLink({ address: '<unsafe> & "address"' })?.address, '<unsafe> & "address"', 'data stays data; CRM escapes before rendering')
console.log('conversational public Maps link: OK')
