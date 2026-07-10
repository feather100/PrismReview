import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { Response } from 'express';

interface ErrorBody {
  code: string;
  message: string;
  statusCode: number;
}

@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(GlobalExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();

    const errorBody = this.toErrorBody(exception);

    if (errorBody.statusCode >= 500) {
      this.logger.error(
        `[${errorBody.code}] ${errorBody.message}`,
        exception instanceof Error ? exception.stack : undefined,
      );
    }

    response.status(errorBody.statusCode).json({
      code: errorBody.code,
      message: errorBody.message,
      statusCode: errorBody.statusCode,
    });
  }

  private toErrorBody(exception: unknown): ErrorBody {
    // NestJS built-in HttpException
    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const responseBody = exception.getResponse();
      const message =
        typeof responseBody === 'string'
          ? responseBody
          : (responseBody as any).message ?? exception.message;

      // Map common HTTP errors to business codes
      switch (status) {
        case 400:
          return { code: 'VALIDATION_ERROR', message, statusCode: 400 };
        case 401:
          return { code: 'AUTH_REQUIRED', message, statusCode: 401 };
        case 403:
          return { code: 'FORBIDDEN', message, statusCode: 403 };
        case 404:
          return { code: 'NOT_FOUND', message, statusCode: 404 };
        case 409:
          return { code: 'CONFLICT', message, statusCode: 409 };
        case 422:
          return { code: 'VALIDATION_ERROR', message, statusCode: 422 };
        case 429:
          return { code: 'RATE_LIMITED', message, statusCode: 429 };
        default:
          return { code: 'INTERNAL_ERROR', message, statusCode: status };
      }
    }

    // Prisma known-request error (e.g. not found)
    if (exception instanceof Prisma.PrismaClientKnownRequestError) {
      switch (exception.code) {
        case 'P2025':
          return { code: 'NOT_FOUND', message: 'Resource not found', statusCode: 404 };
        case 'P2002':
          return { code: 'CONFLICT', message: 'Unique constraint violation', statusCode: 409 };
        default:
          return { code: 'DATABASE_ERROR', message: 'Database error', statusCode: 500 };
      }
    }

    // Prisma not-found (findFirstOrThrow / findUniqueOrThrow)
    if (exception instanceof Prisma.PrismaClientValidationError) {
      return { code: 'VALIDATION_ERROR', message: 'Invalid query', statusCode: 400 };
    }

    // Unhandled
    return {
      code: 'INTERNAL_ERROR',
      message: 'An unexpected error occurred',
      statusCode: 500,
    };
  }
}
