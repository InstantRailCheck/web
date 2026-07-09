import { PasskeyManager } from "@/components/PasskeyManager";
import { SiteFooterLinks } from "@/components/SiteFooterLinks";

export const dynamic = "force-dynamic";

export default function AccountPage() {
  return (
    <main className="min-h-screen bg-slate-950 text-white">
      <div className="mx-auto flex w-full max-w-3xl flex-col px-6 pt-10 pb-16">
        <h1 className="text-center text-3xl font-bold">Account</h1>
        <p className="mt-1 text-center text-sm text-slate-400">
          Manage how you sign in.
        </p>

        <div className="mt-6">
          <PasskeyManager />
        </div>

        <SiteFooterLinks />
      </div>
    </main>
  );
}
