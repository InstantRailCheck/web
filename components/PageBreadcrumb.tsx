import { headers } from "next/headers";
import { Breadcrumb } from "@/components/Breadcrumb";
import type { BreadcrumbItems } from "@/lib/breadcrumbs";
import { buildBreadcrumbJsonLd, safeJsonLdString } from "@/lib/jsonLd";

export async function PageBreadcrumb({ items }: { items: BreadcrumbItems }) {
  const nonce = (await headers()).get("x-nonce") ?? undefined;

  return (
    <>
      <script
        type="application/ld+json"
        nonce={nonce}
        dangerouslySetInnerHTML={{ __html: safeJsonLdString(buildBreadcrumbJsonLd(items)) }}
      />
      <Breadcrumb items={items} />
    </>
  );
}
