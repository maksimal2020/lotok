import { Controller, Get, Param, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Public } from '../../common/auth.decorators';
import { intParam } from '../../common/zod';
import { CategoriesService } from './categories.service';
import { RegionsService } from './regions.service';

@ApiTags('catalog')
@Public()
@Controller({ version: '1' })
export class CatalogController {
  constructor(
    private readonly categories: CategoriesService,
    private readonly regions: RegionsService,
  ) {}

  @Get('categories')
  tree() {
    return this.categories.tree();
  }

  @Get('categories/slug/:slug')
  bySlug(@Param('slug') slug: string) {
    return this.categories.getBySlug(slug.slice(0, 80));
  }

  @Get('categories/:id/attributes')
  attributes(@Param('id') id: string) {
    return this.categories.attributesFor(intParam.parse(id));
  }

  @Get('regions')
  async regionsList(@Query('parentId') parentId?: string, @Query('q') q?: string) {
    if (q) return this.regions.search(q.slice(0, 60));
    return this.regions.children(parentId ? intParam.parse(parentId) : null);
  }

  @Get('regions/cities')
  cities(@Query('popular') popular?: string) {
    return this.regions.cities(popular === '1' || popular === 'true');
  }

  @Get('regions/:id')
  region(@Param('id') id: string) {
    return this.regions.getDto(intParam.parse(id));
  }
}
