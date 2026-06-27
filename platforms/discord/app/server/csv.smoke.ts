(() => {
  const assert = require('node:assert/strict');
  const { buildCsv, escapeCsvCell } = require('./csv.ts');

  // escapeCsvCell
  assert.equal(escapeCsvCell(null), '');
  assert.equal(escapeCsvCell(undefined), '');
  assert.equal(escapeCsvCell(''), '');
  assert.equal(escapeCsvCell('hello'), 'hello');
  assert.equal(escapeCsvCell(123), '123');
  assert.equal(escapeCsvCell(true), 'true');
  assert.equal(escapeCsvCell('with, comma'), '"with, comma"');
  assert.equal(escapeCsvCell('with "quote"'), '"with ""quote"""');
  assert.equal(escapeCsvCell('line1\nline2'), '"line1\nline2"');
  assert.equal(escapeCsvCell('line1\r\nline2'), '"line1\r\nline2"');
  assert.equal(escapeCsvCell('embedded "quoted, value"\nnext'), '"embedded ""quoted, value""\nnext"');

  // buildCsv basics
  assert.equal(buildCsv(['a', 'b'], []), 'a,b\r\n');
  assert.equal(buildCsv(['a', 'b'], [[1, 2], [3, 4]]), 'a,b\r\n1,2\r\n3,4\r\n');

  // null / undefined → empty cell
  assert.equal(buildCsv(['x', 'y', 'z'], [[null, undefined, 'v']]), 'x,y,z\r\n,,v\r\n');

  // header escaping
  assert.equal(buildCsv(['has,comma', 'plain'], [[1, 2]]), '"has,comma",plain\r\n1,2\r\n');

  // cells with embedded comma + quote + newline all together
  const tricky = buildCsv(['t'], [['a, "b"\nc']]);
  assert.equal(tricky, 't\r\n"a, ""b""\nc"\r\n');

  // numeric-shaped strings stay as strings
  assert.equal(buildCsv(['n'], [['007']]), 'n\r\n007\r\n');

  // mixed types
  assert.equal(buildCsv(['s', 'n', 'b', 'nil'], [['x', 42, false, null]]), 's,n,b,nil\r\nx,42,false,\r\n');

  console.log('csv smoke check passed');
})();
