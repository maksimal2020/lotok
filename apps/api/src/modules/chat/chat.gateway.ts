import { Logger } from '@nestjs/common';
import { ConnectedSocket, MessageBody, OnGatewayConnection, OnGatewayDisconnect, SubscribeMessage, WebSocketGateway } from '@nestjs/websockets';
import type { Socket } from 'socket.io';
import { sendMessageSchema } from '@lotok/shared';
import { z } from 'zod';
import { AuthStateService } from '../auth/auth-state.service';
import { UsersService } from '../users/users.service';
import { wsConnections } from '../../infra/metrics';
import { ChatService } from './chat.service';

interface SocketData {
  userId: string;
}

type AckResult = { ok: true; data?: unknown } | { ok: false; code: string; message: string };

const convIdSchema = z.object({ conversationId: z.uuid() });

/**
 * WebSocket-шлюз чата (Socket.IO). Аутентификация — access-токен в handshake.auth.token.
 * Масштабирование — Redis adapter (см. main.ts), события из worker доставляются через Redis emitter.
 * Клиент при переподключении досинхронизирует историю через REST.
 */
@WebSocketGateway({ path: '/socket.io', cors: { origin: true, credentials: true }, pingInterval: 25_000, pingTimeout: 20_000 })
export class ChatGateway implements OnGatewayConnection, OnGatewayDisconnect {
  private readonly logger = new Logger('ChatGateway');

  constructor(
    private readonly authState: AuthStateService,
    private readonly chat: ChatService,
    private readonly users: UsersService,
  ) {}

  async handleConnection(client: Socket) {
    const token = (client.handshake.auth?.token as string | undefined) ?? String(client.handshake.headers.authorization ?? '').replace(/^Bearer /, '');
    const user = token ? await this.authState.verify(token) : null;
    if (!user) {
      client.emit('auth:error', { code: 'token_invalid' });
      client.disconnect(true);
      return;
    }
    (client.data as SocketData).userId = user.id;
    await client.join(`user:${user.id}`);
    wsConnections.inc();
    client.emit('ready', { userId: user.id });
    await this.users.touchLastSeen(user.id).catch(() => undefined);
  }

  async handleDisconnect(client: Socket) {
    const uid = (client.data as SocketData).userId;
    if (uid) {
      wsConnections.dec();
      await this.users.touchLastSeen(uid).catch(() => undefined);
    }
  }

  /** Результат обработчика уходит клиенту как ack Socket.IO. */
  private async run(client: Socket, fn: (userId: string) => Promise<unknown>): Promise<AckResult> {
    const userId = (client.data as SocketData).userId;
    try {
      const state = userId ? await this.authState.getState(userId) : null;
      if (!state || state.status !== 'active') {
        client.disconnect(true);
        return { ok: false, code: 'unauthorized', message: 'Сессия недействительна' };
      }
      return { ok: true, data: await fn(userId) };
    } catch (e) {
      const err = e as { code?: string; message?: string; issues?: unknown };
      if (!err.code && !err.issues) this.logger.warn({ err: e }, 'ws handler error');
      return { ok: false, code: err.code ?? (err.issues ? 'validation_error' : 'error'), message: err.issues ? 'Некорректные данные' : (err.message ?? 'Ошибка') };
    }
  }

  @SubscribeMessage('message:send')
  send(@ConnectedSocket() client: Socket, @MessageBody() body: unknown) {
    return this.run(client, (userId) => this.chat.send(userId, convIdSchema.parse(body).conversationId, sendMessageSchema.parse(body)));
  }

  @SubscribeMessage('conversation:read')
  read(@ConnectedSocket() client: Socket, @MessageBody() body: unknown) {
    return this.run(client, (userId) => this.chat.markRead(userId, convIdSchema.parse(body).conversationId));
  }

  @SubscribeMessage('message:delivered')
  delivered(@ConnectedSocket() client: Socket, @MessageBody() body: unknown) {
    return this.run(client, (userId) => this.chat.markDelivered(userId, convIdSchema.parse(body).conversationId));
  }

  @SubscribeMessage('typing')
  typing(@ConnectedSocket() client: Socket, @MessageBody() body: unknown) {
    return this.run(client, (userId) => this.chat.typing(userId, convIdSchema.parse(body).conversationId));
  }
}
