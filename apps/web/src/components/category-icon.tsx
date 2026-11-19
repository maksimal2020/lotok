import { Baby, Bike, Box, Briefcase, Building2, Car, Dog, Guitar, Hammer, Home, type LucideIcon, Shirt, ShoppingBag, Smartphone, Sofa, Refrigerator, Wrench } from 'lucide-react';

const ICONS: Record<string, LucideIcon> = {
  bag: ShoppingBag,
  device: Smartphone,
  fridge: Refrigerator,
  shirt: Shirt,
  sofa: Sofa,
  home: Home,
  hammer: Hammer,
  guitar: Guitar,
  ball: Bike,
  kids: Baby,
  paw: Dog,
  box: Box,
  building: Building2,
  car: Car,
  briefcase: Briefcase,
  tools: Wrench,
};

export function CategoryIcon({ name, className }: { name: string | null; className?: string }) {
  const Icon = (name && ICONS[name]) || Box;
  return <Icon className={className ?? 'size-6'} aria-hidden />;
}

export const VERTICAL_COLORS: Record<string, string> = {
  goods: 'bg-brand-50 text-brand-600',
  realty: 'bg-[#EAF1FD] text-info',
  auto: 'bg-[#FDECEC] text-danger',
  jobs: 'bg-accent-50 text-accent-700',
  services: 'bg-[#F1ECFD] text-[#6D3FD6]',
};
