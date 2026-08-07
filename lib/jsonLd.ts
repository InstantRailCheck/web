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

// No `distribution` (would cite a CSV download URL that doesn't exist yet)
// and no `license` (undecided — fabricating one would violate the same
// "don't claim what isn't true" standard applied everywhere else in this
// codebase). `dateModified` is omitted entirely rather than fabricated when
// the underlying freshness data isn't available yet.
export function buildDatasetJsonLd(input: { name: string; description: string; url: string; dateModified: string | null }) {
  return {
    "@context": "https://schema.org",
    "@type": "Dataset",
    name: input.name,
    description: input.description,
    url: input.url,
    ...(input.dateModified ? { dateModified: input.dateModified } : {}),
    creator: { "@type": "Organization", name: "InstantRailCheck", url: SITE_URL },
  };
}

export function buildFaqJsonLd(items: { question: string; answer: string }[]) {
  return {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: items.map((item) => ({
      "@type": "Question",
      name: item.question,
      acceptedAnswer: { "@type": "Answer", text: item.answer },
    })),
  };
}
