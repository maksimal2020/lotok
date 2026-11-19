'use client';

import { useQuery } from '@tanstack/react-query';
import type { CategoryAttributeDto, CategoryDto, RegionDto } from '@lotok/shared';
import { api } from './api';

export function useCategories() {
  return useQuery({ queryKey: ['categories'], queryFn: () => api.get<CategoryDto[]>('/categories'), staleTime: 300_000 });
}

export function useCities() {
  return useQuery({ queryKey: ['cities'], queryFn: () => api.get<RegionDto[]>('/regions/cities'), staleTime: 600_000 });
}

export function useAttributes(categoryId: number | null | undefined) {
  return useQuery({
    queryKey: ['attributes', categoryId],
    queryFn: () => api.get<CategoryAttributeDto[]>(`/categories/${categoryId}/attributes`),
    enabled: !!categoryId,
    staleTime: 300_000,
  });
}

export function flattenCategories(tree: CategoryDto[] | undefined, depth = 0, out: (CategoryDto & { depth: number; isLeaf: boolean })[] = []) {
  for (const c of tree ?? []) {
    out.push({ ...c, depth, isLeaf: !c.children?.length });
    flattenCategories(c.children, depth + 1, out);
  }
  return out;
}

export function findPath(tree: CategoryDto[] | undefined, id: number): CategoryDto[] {
  for (const c of tree ?? []) {
    if (c.id === id) return [c];
    const sub = findPath(c.children, id);
    if (sub.length) return [c, ...sub];
  }
  return [];
}
