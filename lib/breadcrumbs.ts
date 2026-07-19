export type BreadcrumbItem = {
  name: string;
  href: string;
};

// Google only recognizes a BreadcrumbList with at least two ListItems.
// Keeping that invariant in the type prevents a future one-item trail from
// silently emitting structured data that cannot qualify for the enhancement.
export type BreadcrumbItems = readonly [BreadcrumbItem, BreadcrumbItem, ...BreadcrumbItem[]];
