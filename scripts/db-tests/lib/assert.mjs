// Minimal assert-and-report harness, matching the pattern the v7.1 scratch
// verification scripts used against production — each db-test file calls
// assert() for every check and exits non-zero if anything failed, so the
// db-test CI job fails loudly on any regression.
export function createAssert() {
  let failures = 0;
  function assert(condition, message) {
    if (condition) {
      console.log(`  PASS: ${message}`);
    } else {
      failures++;
      console.error(`  FAIL: ${message}`);
    }
  }
  function report() {
    console.log(`\n${failures === 0 ? "ALL CHECKS PASSED" : `${failures} CHECK(S) FAILED`}`);
    process.exitCode = failures === 0 ? 0 : 1;
  }
  return { assert, report };
}
