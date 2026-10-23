
import assert from "node:assert/strict";

import {
  getSchauinslandPaginationOffsets,
} from "../src/lib/ota/live-schauinsland";

const cases = [
  { total: 0, expected: [] },
  { total: 18, expected: [0] },
  { total: 50, expected: [0] },
  { total: 85, expected: [0, 50] },
  { total: 120, expected: [0, 50, 100] },
];

for (const testCase of cases) {
  const result = getSchauinslandPaginationOffsets(
    testCase.total,
  );

  assert.deepEqual(
    result,
    testCase.expected,
    `Pagination hatası: ${testCase.total} teklif`,
  );

  console.log(`PASS Pagination / ${testCase.total}`);
}

assert.throws(
  () => getSchauinslandPaginationOffsets(-1),
  /Geçersiz Schauinsland pagination/,
);

assert.throws(
  () => getSchauinslandPaginationOffsets(100, 0),
  /Geçersiz Schauinsland pagination/,
);

console.log("PASS Invalid pagination values");

console.log(
  "Schauinsland pagination testleri başarılı: 7 kontrol.",
);
