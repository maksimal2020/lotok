import { Global, Module } from '@nestjs/common';
import { AntivirusService } from './file-security';
import { JobsService } from './jobs.service';
import { MailService, PushService, SmsService } from './messaging.providers';
import { AuditService, RealtimeService, SecurityEventsService, SettingsService } from './platform.services';
import { StorageService } from './storage.service';

@Global()
@Module({
  providers: [
    JobsService,
    MailService,
    SmsService,
    PushService,
    StorageService,
    AntivirusService,
    RealtimeService,
    AuditService,
    SecurityEventsService,
    SettingsService,
  ],
  exports: [
    JobsService,
    MailService,
    SmsService,
    PushService,
    StorageService,
    AntivirusService,
    RealtimeService,
    AuditService,
    SecurityEventsService,
    SettingsService,
  ],
})
export class InfraModule {}
