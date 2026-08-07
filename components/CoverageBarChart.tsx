import { pct, type RailBuckets } from "@/lib/coverageReport";

// CSP here (proxy.ts) is `style-src 'self' 'nonce-<x>'` with no
// 'unsafe-inline'/'unsafe-hashes' — a nonce on style-src only covers
// <style>/<link> elements, not an arbitrary element's inline style=""
// attribute, so a dynamic `style={{ width: pct + '%' }}` would be silently
// dropped by the browser (confirmed against this app's own CSP: a
// third-party component elsewhere on the site already trips this exact
// "Applying inline style violates ... style-src" console error). Every
// whole-percent width class is listed literally below so Tailwind's
// build-time scanner picks all 101 of them up as real compiled CSS classes
// (governed by 'self', not style-src's runtime restriction) — percentages
// are rounded to the nearest whole number for the bar's width, and the
// exact figure is always shown as text alongside it, so this quantization
// never misrepresents the underlying count.
const WIDTH_CLASSES = [
  "w-[0%]", "w-[1%]", "w-[2%]", "w-[3%]", "w-[4%]", "w-[5%]", "w-[6%]", "w-[7%]", "w-[8%]", "w-[9%]",
  "w-[10%]", "w-[11%]", "w-[12%]", "w-[13%]", "w-[14%]", "w-[15%]", "w-[16%]", "w-[17%]", "w-[18%]", "w-[19%]",
  "w-[20%]", "w-[21%]", "w-[22%]", "w-[23%]", "w-[24%]", "w-[25%]", "w-[26%]", "w-[27%]", "w-[28%]", "w-[29%]",
  "w-[30%]", "w-[31%]", "w-[32%]", "w-[33%]", "w-[34%]", "w-[35%]", "w-[36%]", "w-[37%]", "w-[38%]", "w-[39%]",
  "w-[40%]", "w-[41%]", "w-[42%]", "w-[43%]", "w-[44%]", "w-[45%]", "w-[46%]", "w-[47%]", "w-[48%]", "w-[49%]",
  "w-[50%]", "w-[51%]", "w-[52%]", "w-[53%]", "w-[54%]", "w-[55%]", "w-[56%]", "w-[57%]", "w-[58%]", "w-[59%]",
  "w-[60%]", "w-[61%]", "w-[62%]", "w-[63%]", "w-[64%]", "w-[65%]", "w-[66%]", "w-[67%]", "w-[68%]", "w-[69%]",
  "w-[70%]", "w-[71%]", "w-[72%]", "w-[73%]", "w-[74%]", "w-[75%]", "w-[76%]", "w-[77%]", "w-[78%]", "w-[79%]",
  "w-[80%]", "w-[81%]", "w-[82%]", "w-[83%]", "w-[84%]", "w-[85%]", "w-[86%]", "w-[87%]", "w-[88%]", "w-[89%]",
  "w-[90%]", "w-[91%]", "w-[92%]", "w-[93%]", "w-[94%]", "w-[95%]", "w-[96%]", "w-[97%]", "w-[98%]", "w-[99%]",
  "w-[100%]",
];

function widthClass(percent: number): string {
  return WIDTH_CLASSES[Math.max(0, Math.min(100, Math.round(percent)))];
}

// Segment colors are a secondary cue, not the only one — every count is
// also rendered as text below the bar, so the chart stays legible without
// relying on color alone.
export function CoverageBarChart({ label, buckets }: { label: string; buckets: RailBuckets }) {
  const total = buckets.confirmed + buckets.notConfirmed + buckets.unknown;
  const confirmedPct = pct(buckets.confirmed, total);
  const notConfirmedPct = pct(buckets.notConfirmed, total);
  const unknownPct = pct(buckets.unknown, total);

  return (
    <div>
      <div className="flex items-baseline justify-between text-sm">
        <span className="font-semibold text-white">{label}</span>
        <span className="text-slate-400">{confirmedPct}% confirmed</span>
      </div>
      <div
        className="mt-2 flex h-3 w-full overflow-hidden rounded-full bg-slate-800"
        role="img"
        aria-label={`${label}: ${buckets.confirmed} confirmed, ${buckets.notConfirmed} not confirmed, ${buckets.unknown} unknown, out of ${total} active institutions`}
      >
        {confirmedPct > 0 && <div className={`h-full bg-green-500 ${widthClass(confirmedPct)}`} />}
        {notConfirmedPct > 0 && <div className={`h-full bg-slate-600 ${widthClass(notConfirmedPct)}`} />}
        {unknownPct > 0 && <div className={`h-full bg-amber-500 ${widthClass(unknownPct)}`} />}
      </div>
      <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-400">
        <span className="flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-full bg-green-500" />
          {buckets.confirmed.toLocaleString()} confirmed
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-full bg-slate-600" />
          {buckets.notConfirmed.toLocaleString()} not confirmed
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-full bg-amber-500" />
          {buckets.unknown.toLocaleString()} unknown
        </span>
      </div>
    </div>
  );
}
