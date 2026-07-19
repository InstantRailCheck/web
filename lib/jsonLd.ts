import { SITE_URL } from "@/lib/siteConfig";
import type { BreadcrumbItems } from "@/lib/breadcrumbs";

// JSON.stringify never escapes literal `<`, so a bank name/aka containing
// "</script>" could break out of the surrounding <script> tag when
// interpolated via dangerouslySetInnerHTML. < is indistinguishable to
// JSON parsers but can't terminate the enclosing script element.
export function safeJsonLdString(data: unknown): string {
  return JSON.stringify(data).replace(/</g, "\\u003c");
}

export function buildBreadcrumbJsonLd(items: BreadcrumbItems) {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: items.map((item, index) => ({
      "@type": "ListItem",
      position: index + 1,
      name: item.name,
      item: new URL(item.href, SITE_URL).toString(),
    })),
  };
}

export function buildBankBreadcrumbJsonLd(bank: { name: string; slug: string }) {
  return buildBreadcrumbJsonLd([
    { name: "All banks", href: "/banks" },
    { name: bank.name, href: `/banks/${bank.slug}` },
  ]);
}
