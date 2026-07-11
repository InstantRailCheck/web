// Shared by every "replace this whole participant table with a freshly
// scraped/downloaded dataset" sync script. Previously each script
// duplicated a delete-then-insert with no sanity check and no rollback —
// centralized here after that exact duplication became a real risk (a fix
// applied to one copy but not the other).
//
// Never leaves the table in a state worse than where it started:
//   1. New rows are inserted first, stamped with this run's timestamp.
//   2. If insertion fails partway through, this run's partial rows are
//      deleted immediately (not left to linger as duplicates alongside the
//      previous good generation — which would otherwise inflate the next
//      run's sanity-check baseline and could wrongly reject a valid parse).
//   3. Only once every new row is in does it remove the previous
//      generation's rows (identified by predating this run's stamp).
//
// The pre-run sanity check compares against the size of the table's
// largest single generation (rows sharing one `updated_at` stamp) rather
// than a raw table-wide count — robust even if some previous run's cleanup
// itself ever failed and left orphaned rows behind, since those would form
// their own (smaller) generation rather than inflating the real baseline.
export async function replaceTableSafely(supabase, table, records, { minRetentionFraction = 0.8, chunkSize = 500 } = {}) {
  const currentCount = await largestGenerationCount(supabase, table);

  if (currentCount > 0 && records.length < currentCount * minRetentionFraction) {
    throw new Error(
      `${table}: parsed ${records.length} records, but the current largest generation has ${currentCount} — ` +
        `a drop below ${minRetentionFraction * 100}% looks like a parsing failure, not a real change. Aborting without touching the table.`
    );
  }

  const syncStartedAt = new Date().toISOString();
  const stamped = records.map((r) => ({ ...r, updated_at: syncStartedAt }));

  console.log(`${table}: inserting ${stamped.length} new records...`);
  try {
    for (let i = 0; i < stamped.length; i += chunkSize) {
      const chunk = stamped.slice(i, i + chunkSize);
      const { error } = await supabase.from(table).insert(chunk);
      if (error) throw error;
      console.log(`  ${Math.min(i + chunkSize, stamped.length)}/${stamped.length}`);
    }
  } catch (err) {
    console.error(`${table}: insert failed — removing this run's partial rows before re-throwing...`);
    const { error: cleanupError } = await supabase.from(table).delete().eq("updated_at", syncStartedAt);
    if (cleanupError) {
      console.error(
        `${table}: cleanup of the failed run's rows ALSO failed (${cleanupError.message}) — ` +
          `the table may now hold a partial/duplicate generation stamped ${syncStartedAt}. Investigate before the next run.`
      );
    }
    throw err;
  }

  console.log(`${table}: removing rows from before this sync...`);
  const { error: deleteError } = await supabase.from(table).delete().lt("updated_at", syncStartedAt);
  if (deleteError) throw deleteError;
}

async function largestGenerationCount(supabase, table) {
  const { data, error } = await supabase.from(table).select("updated_at");
  if (error) throw error;

  const counts = new Map();
  for (const row of data) {
    counts.set(row.updated_at, (counts.get(row.updated_at) ?? 0) + 1);
  }
  return counts.size === 0 ? 0 : Math.max(...counts.values());
}
