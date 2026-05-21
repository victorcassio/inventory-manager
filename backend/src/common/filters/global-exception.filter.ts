import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Request, Response } from 'express';

// Paths that may carry credentials — never log their request body or detailed context
const SENSITIVE_PATHS = ['/auth/login', '/auth/refresh', '/auth/logout'];

@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(GlobalExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    const status =
      exception instanceof HttpException
        ? exception.getStatus()
        : HttpStatus.INTERNAL_SERVER_ERROR;

    const message =
      exception instanceof HttpException
        ? exception.getResponse()
        : 'Internal server error';

    const isSensitivePath = SENSITIVE_PATHS.some(p => request.url.includes(p));

    if (status >= 500) {
      // Never log body or Authorization header; for sensitive paths log only method+status
      const context = isSensitivePath
        ? `${request.method} [auth endpoint] — ${status}`
        : `${request.method} ${request.url} — ${status}`;

      this.logger.error(
        context,
        exception instanceof Error ? exception.stack : String(exception),
      );
    }

    // Deduplicate validation messages (e.g. generic auth errors appear per-field)
    const rawMessage =
      typeof message === 'string'
        ? message
        : (message as any).message ?? message;

    const finalMessage = Array.isArray(rawMessage)
      ? [...new Set(rawMessage)].length === 1
        ? [...new Set(rawMessage)][0]
        : rawMessage
      : rawMessage;

    response.status(status).json({
      statusCode: status,
      timestamp: new Date().toISOString(),
      path: request.url,
      message: finalMessage,
    });
  }
}
