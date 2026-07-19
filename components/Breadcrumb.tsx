import Link from "next/link";
import { Fragment } from "react";
import type { BreadcrumbItems } from "@/lib/breadcrumbs";

export function Breadcrumb({ items }: { items: BreadcrumbItems }) {
  return (
    <nav aria-label="Breadcrumb" className="mb-4 text-center text-sm text-slate-500">
      <ol className="inline-flex items-center gap-2">
        {items.map((item, index) => {
          const isCurrent = index === items.length - 1;

          return (
            <Fragment key={`${item.href}-${item.name}`}>
              {index > 0 && <li aria-hidden="true">/</li>}
              {isCurrent ? (
                <li aria-current="page" className="text-slate-300">
                  {item.name}
                </li>
              ) : (
                <li>
                  <Link href={item.href} className="hover:text-slate-300 transition">
                    {item.name}
                  </Link>
                </li>
              )}
            </Fragment>
          );
        })}
      </ol>
    </nav>
  );
}
