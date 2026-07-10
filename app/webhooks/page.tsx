import { WebhooksManager } from "@/components/WebhooksManager";
import { LegalFooterLinks } from "@/components/LegalFooterLinks";

export const dynamic = "force-dynamic";

export default function WebhooksPage() {
  return (
    <main className="min-h-screen bg-slate-950 text-white">
      <div className="mx-auto flex w-full max-w-3xl flex-col px-6 pt-10 pb-16">
        <h1 className="text-center text-3xl font-bold">Webhooks</h1>
        <p className="mt-1 text-center text-sm text-slate-400">
          Get notified in real time instead of polling the API.
        </p>

        <div className="mt-6">
          <WebhooksManager />
        </div>

        <LegalFooterLinks />
      </div>
    </main>
  );
}
