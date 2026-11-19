import { createListingSchema, type CategoryAttributeDto, type CreateListingInput } from '@lotok/shared';

/**
 * Сборка тела запроса создания объявления из полей мобильной формы.
 * Валидация — общей zod-схемой из @lotok/shared (те же правила, что на сервере и в вебе).
 */
export function buildListingPayload(input: {
  categoryId: number;
  title: string;
  description: string;
  price: string;
  cityId: number;
  attributes: Record<string, string>;
  attributeDefs: CategoryAttributeDto[];
  mediaIds: string[];
}): CreateListingInput {
  const attributes: Record<string, string | number | boolean> = {};
  for (const d of input.attributeDefs) {
    const raw = input.attributes[d.key];
    if (raw === undefined || raw === '') continue;
    if (d.type === 'integer' || d.type === 'year' || d.type === 'decimal') attributes[d.key] = Number(raw.replace(',', '.'));
    else if (d.type === 'boolean') attributes[d.key] = raw === 'true';
    else attributes[d.key] = raw;
  }
  const price = input.price.trim() ? Math.round(Number(input.price.replace(/\s/g, '').replace(',', '.')) * 100) : null;
  return createListingSchema.parse({
    categoryId: input.categoryId,
    title: input.title,
    description: input.description,
    price,
    priceType: 'fixed',
    cityId: input.cityId,
    attributes,
    mediaIds: input.mediaIds,
  });
}
