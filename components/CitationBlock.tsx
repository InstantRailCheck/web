"use client";

import { useState } from "react";
import { Check, Copy } from "lucide-react";

export function CitationBlock({ citationText }: { citationText: string }) {
  const [status, setStatus] = useState<"idle" | "copied" | "failed">("idle");

  async function handleCopy() {
    try {
      // clipboard.writeText is unavailable in some contexts (e.g. non-HTTPS,
      // certain in-app browsers) and can also reject on permission denial —
      // either way, fail visibly rather than leaving an unhandled rejection
      // and no feedback that nothing was actually copied.
      await navigator.clipboard.writeText(citationText);
      setStatus("copied");
    } catch {
      setStatus("failed");
    } finally {
      setTimeout(() => setStatus("idle"), 2000);
    }
  }

  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900/50 p-4">
      <p className="text-xs text-slate-400">Cite this data</p>
      <p className="mt-1 font-mono text-xs break-words text-slate-300">{citationText}</p>
      <button
        type="button"
        onClick={handleCopy}
        aria-live="polite"
        className="mt-3 inline-flex items-center gap-1.5 rounded-lg border border-slate-700 px-3 py-1.5 text-xs font-medium text-white transition hover:bg-slate-800"
      >
        {status === "copied" ? (
          <>
            <Check className="h-3.5 w-3.5" /> Copied
          </>
        ) : status === "failed" ? (
          "Couldn't copy"
        ) : (
          <>
            <Copy className="h-3.5 w-3.5" /> Copy citation
          </>
        )}
      </button>
    </div>
  );
}
