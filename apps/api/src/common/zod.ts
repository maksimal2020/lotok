import { applyDecorators, ArgumentMetadata, createParamDecorator, ExecutionContext, PipeTransform } from '@nestjs/common';
import { ApiBody, ApiQuery } from '@nestjs/swagger';
import { z, ZodType } from 'zod';

/** Валидация тела/параметров через zod-схемы из @lotok/shared. */
export class ZodPipe<T extends ZodType> implements PipeTransform {
  constructor(private readonly schema: T) {}
  transform(value: unknown, _meta: ArgumentMetadata): z.infer<T> {
    return this.schema.parse(value ?? {});
  }
}

function jsonSchema(schema: ZodType): Record<string, unknown> {
  try {
    return z.toJSONSchema(schema, { io: 'input', unrepresentable: 'any' }) as Record<string, unknown>;
  } catch {
    return { type: 'object' };
  }
}

/** Тело запроса, провалидированное схемой. Документирует схему в OpenAPI. */
export const ZBody = <T extends ZodType>(schema: T) =>
  createParamDecorator((_data: unknown, ctx: ExecutionContext) => schema.parse(ctx.switchToHttp().getRequest().body ?? {}), [
    (target: object, key: string | symbol | undefined) => {
      if (key === undefined) return;
      const descriptor = Object.getOwnPropertyDescriptor(target, key);
      if (descriptor) ApiBody({ schema: jsonSchema(schema) as never })(target, key, descriptor);
    },
  ])();

/** Query-параметры, провалидированные схемой. */
export const ZQuery = <T extends ZodType>(schema: T) =>
  createParamDecorator((_data: unknown, ctx: ExecutionContext) => schema.parse(ctx.switchToHttp().getRequest().query ?? {}), [
    (target: object, key: string | symbol | undefined) => {
      if (key === undefined) return;
      const descriptor = Object.getOwnPropertyDescriptor(target, key);
      if (!descriptor) return;
      const js = jsonSchema(schema) as { properties?: Record<string, unknown>; required?: string[] };
      const decorators = Object.entries(js.properties ?? {}).map(([name, s]) =>
        ApiQuery({ name, required: js.required?.includes(name) ?? false, schema: s as never }),
      );
      applyDecorators(...decorators)(target, key, descriptor);
    },
  ])();

export const uuidParam = z.uuid('Некорректный идентификатор');
export const intParam = z.coerce.number().int().positive();
