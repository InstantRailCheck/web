import Link from "next/link";
import { PasskeyManager } from "@/components/PasskeyManager";

export const dynamic = "force-dynamic";

export default function AccountPage() {
  return (
    <main className="min-h-screen bg-slate-950 text-white">
      <div className="mx-auto flex w-full max-w-3xl flex-col px-6 pt-10 pb-16">
        <Link href="/" className="text-sm text-slate-400 hover:text-white transition">
          ← Back to search
        </Link>

        <h1 className="mt-4 text-3xl font-bold">Account</h1>
        <p className="mt-1 text-sm text-slate-400">
          Manage how you sign in.
        </p>

        <div className="mt-6">
          <PasskeyManager />
        </div>
      </div>
    </main>
  );
}
