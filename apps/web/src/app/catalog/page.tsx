import type { Metadata } from 'next';
import Link from 'next/link';
import type { CategoryDto } from '@lotok/shared';
import { CategoryIcon, VERTICAL_COLORS } from '@/components/category-icon';
import { serverGet } from '@/lib/api';

export const metadata: Metadata = { title: 'Все категории' };
export const revalidate = 300;

export default async function CatalogPage() {
  const tree = (await serverGet<CategoryDto[]>('/categories', 300).catch(() => null)) ?? [];
  return (
    <div className="container-page py-8">
      <h1 className="mb-6 text-3xl font-extrabold tracking-tight">Все категории</h1>
      <div className="space-y-6">
        {tree.map((root) => (
          <section key={root.id} className="rounded-2xl bg-white p-5 md:p-6">
            <Link href={`/c/${root.slug}`} className="mb-4 flex items-center gap-3 hover:text-brand-600">
              <span className={`flex size-11 items-center justify-center rounded-xl ${VERTICAL_COLORS[root.vertical]}`}>
                <CategoryIcon name={root.icon} />
              </span>
              <h2 className="text-xl font-extrabold">{root.name}</h2>
            </Link>
            <div className="grid gap-x-6 gap-y-5 sm:grid-cols-2 lg:grid-cols-4">
              {(root.children ?? []).map((c) => (
                <div key={c.id}>
                  <Link href={`/c/${c.slug}`} className="font-bold hover:text-brand-600">
                    {c.name}
                  </Link>
                  {!!c.children?.length && (
                    <ul className="mt-1.5 space-y-1">
                      {c.children.map((s) => (
                        <li key={s.id}>
                          <Link href={`/c/${s.slug}`} className="text-sm text-ink-500 hover:text-brand-600">
                            {s.name}
                          </Link>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              ))}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}
