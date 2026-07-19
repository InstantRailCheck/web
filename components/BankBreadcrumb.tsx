import { Breadcrumb } from "@/components/Breadcrumb";

export function BankBreadcrumb({ bankName, bankSlug }: { bankName: string; bankSlug: string }) {
  return (
    <Breadcrumb
      items={[
        { name: "All banks", href: "/banks" },
        { name: bankName, href: `/banks/${bankSlug}` },
      ]}
    />
  );
}
