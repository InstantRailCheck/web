import Link from "next/link";
import { WebhooksManager } from "@/components/WebhooksManager";

export default function WebhooksPage() {
  return (
    <main className="min-h-screen bg-slate-950 text-white">
      <div className="mx-auto flex w-full max-w-3xl flex-col px-6 pt-10 pb-16">
        <Link href="/" className="text-sm text-slate-400 hover:text-white transition">
          ← Back to search
        </Link>

        <h1 className="mt-4 text-3xl font-bold">Webhooks</h1>
        <p className="mt-1 text-sm text-slate-400">
          Get notified in real time instead of polling the API.
        </p>

        <div className="mt-6">
          <WebhooksManager />
        </div>
      </div>
    </main>
  );
}
