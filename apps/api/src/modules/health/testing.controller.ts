import { Controller, Get, Inject, NotFoundException, Query } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { CONFIG, type AppConfig } from '../../config/config';
import { Public } from '../../common/auth.decorators';
import { MailService, SmsService } from '../../infra/messaging.providers';

/**
 * Служебные эндпоинты для E2E-тестов: чтение писем и SMS из драйвера memory.
 * Регистрируются только при ENABLE_TEST_ENDPOINTS=true и NODE_ENV !== production (см. app.module.ts).
 */
@ApiExcludeController()
@Public()
@Controller({ path: '_test', version: '1' })
export class TestingController {
  constructor(
    @Inject(CONFIG) private readonly config: AppConfig,
    private readonly mail: MailService,
    private readonly sms: SmsService,
  ) {}

  private guard() {
    if (this.config.isProd || !this.config.ENABLE_TEST_ENDPOINTS) throw new NotFoundException();
  }

  @Get('mail')
  lastMail(@Query('to') to: string) {
    this.guard();
    const m = [...this.mail.outbox].reverse().find((x) => x.to === to);
    if (!m) throw new NotFoundException();
    return m;
  }

  @Get('sms')
  lastSms(@Query('to') to: string) {
    this.guard();
    const m = [...this.sms.outbox].reverse().find((x) => x.to === to);
    if (!m) throw new NotFoundException();
    return m;
  }
}
