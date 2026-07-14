"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

// The second way (besides clicking through from a submission row) to
// reach a user's admin profile. Deliberately just a UUID field — no
// directory/listing of users is offered anywhere in this app.
export function UserLookupForm() {
  const router = useRouter();
  const [id, setId] = useState("");

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = id.trim();
    if (!trimmed) return;
    router.push(`/admin/moderation/users/${encodeURIComponent(trimmed)}`);
  }

  return (
    <form onSubmit={handleSubmit} className="mt-4 flex justify-center gap-2">
      <input
        type="text"
        value={id}
        onChange={(e) => setId(e.target.value)}
        placeholder="Look up user by UUID"
        className="w-64 rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white"
      />
      <button
        type="submit"
        className="rounded-lg border border-slate-700 px-4 py-2 text-sm font-medium text-slate-300 transition hover:bg-slate-800"
      >
        View profile
      </button>
    </form>
  );
}
