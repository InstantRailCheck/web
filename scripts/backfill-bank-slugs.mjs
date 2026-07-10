import { createClient } from "@supabase/supabase-js";
import { slugify, uniqueSlug } from "../lib/slugify.ts";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function main() {
  const { data: banks, error } = await supabase
    .from("banks")
    .select("id, name, slug")
    .order("created_at", { ascending: true });
  if (error) throw error;

  const usedSlugs = new Set(banks.filter((b) => b.slug).map((b) => b.slug));

  for (const bank of banks) {
    if (bank.slug) {
      console.log(`- ${bank.name}: already has slug "${bank.slug}", skipped`);
      continue;
    }

    const base = slugify(bank.name);
    const slug = uniqueSlug(base, usedSlugs);
    usedSlugs.add(slug);

    const { error: updateError } = await supabase.from("banks").update({ slug }).eq("id", bank.id);
    if (updateError) {
      console.log(`- ${bank.name}: update failed — ${updateError.message}`);
    } else {
      console.log(`- ${bank.name}: assigned slug "${slug}"`);
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
