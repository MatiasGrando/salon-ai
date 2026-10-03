import assert from 'node:assert/strict'
import { parseIncidentalArithmetic } from '../src/conversational-bot/incidental-arithmetic.js'
const pass = (input: string, expected: number) => {
  const fact = parseIncidentalArithmetic(input)
  assert.ok(fact, input)
  assert.equal(fact.result, expected, input)
  assert.equal(fact.text, `${fact.left} ${fact.operator} ${fact.right} es ${expected}.`, input)
}
pass('cuanto es 2+2?', 4)
pass('¿Cuánto es 2 + 2?', 4)
pass('y 7x8?', 56)
pass('Y 7 X 8?', 56)
pass('7×8', 56)
pass('12 ÷ 3', 4)
pass('calcula 8*3', 24)
pass('decime cuanto da 3 mas 4', 7)
pass('10 menos 3', 7)
pass('2 por 3', 6)
pass('-2 + 3', 1)
pass('2--3', 5)
pass('100000 / 2', 50000)
pass('999999*999999', 999998000001)
pass('-999999 * 999999', -999998000001)
for (const unsafe of [
  'quiero un turno y 7x8?', 'hola y 7x8?', 'mañana a las 7x8', 'cuanto cuesta 2+2',
  '2+2 y una reserva', '2+2 por favor quiero precio', '7x8 con Rama', '7 x8 para un turno',
  '2+2+2', '1/0', '5/2', '1000000+1', '1e3+1',
  '2+2 pesos', '$ 2+2', '2+2€', '2+2%', '2+2 min', '2 + 2 horario',
  '2x', '2xx3', '2*x3', '2×x3', '2//2', 'eval(2+2)', 'Math.pow(2,2)',
  '2 + 2; process.exit()', 'cuanto es 2+2? y 7x8?', 'no 2+2',
  '7 x Rama', '2 y 2', '3 ÷ 0'
]) assert.equal(parseIncidentalArithmetic(unsafe), null, unsafe)
assert.equal(parseIncidentalArithmetic('  '), null)
console.log('incidental arithmetic pure grammar: PASS')
