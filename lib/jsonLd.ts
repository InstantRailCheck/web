import { SITE_URL } from "@/lib/siteConfig";

// JSON.stringify never escapes literal `<`, so a bank name/aka containing
// "</script>" could break out of the surrounding <script> tag when
// interpolated via dangerouslySetInnerHTML. < is indistinguishable to
// JSON parsers but can't terminate the enclosing script element.
export function safeJsonLdString(data: unknown): string {
  return JSON.stringify(data).replace(/</g, "\\u003c");
}

export function buildBankBreadcrumbJsonLd(bank: { name: string; slug: string }) {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "All banks", item: `${SITE_URL}/banks` },
      { "@type": "ListItem", position: 2, name: bank.name, item: `${SITE_URL}/banks/${bank.slug}` },
    ],
  };
}
