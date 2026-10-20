const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const source = fs.readFileSync('app/stock-purchases/page.js', 'utf8');
const context = {};
vm.runInNewContext(source.slice(source.indexOf('function supplierDiscount'), source.indexOf('export default')), context);
const discount = context.supplierDiscount;
assert.equal(discount([60, 40], 'percent', '10').amount, 10);
assert.equal(discount([60, 40], 'amount', '10').lines.join(','), '54,36');
assert.equal(discount([65.68], 'amount', '5').lines[0], 60.68);
assert.equal(discount([0.01, 0.01, 0.01], 'amount', '0.01').lines.join(','), '0,0.01,0.01');
assert.equal(discount([10, 20], 'percent', '100').lines.join(','), '0,0');
assert.equal(discount([0, 10], 'amount', '1').lines.join(','), '0,9');
assert.equal(discount([10, 20], 'amount', '').amount, 0);
for (const [type, value] of [['amount', -1], ['amount', 31], ['percent', 101], ['amount', 'bad']]) assert.ok(discount([10, 20], type, value).error);
for (let i = 0; i <= 100; i++) {
  const result = discount([65.68, 23, 0.01, 12.32], 'percent', i);
  assert.equal(Math.round(result.lines.reduce((s, n) => s + n, 0) * 100), 10101 - Math.round(result.amount * 100));
  assert.ok(result.lines.every(n => n >= 0));
}
console.log('Supplier discount: fixed amounts, percentages, rounding, zero/full discount and invalid values passed.');
