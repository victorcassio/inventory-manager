import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { GlobalExceptionFilter } from './common/filters/global-exception.filter';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, {
    logger: ['error', 'warn', 'log'],
  });

  const configService = app.get(ConfigService);
  const frontendUrl = configService.get<string>('app.frontendUrl');
  const port = configService.get<number>('app.port') ?? 3000;

  // Explicit even when false (Express's own default): req.ip and the
  // rate-limiter/audit-log IP it feeds only reflect the real client when
  // this matches the actual deploy topology. See app.config.ts.
  // INestApplication doesn't expose Express's `set()` — go through the
  // underlying HTTP adapter's instance instead of casting `app` itself,
  // which would silence unrelated type errors too.
  app.getHttpAdapter().getInstance().set('trust proxy', configService.get('app.trustProxy'));

  app.use(helmet());

  const allowedOrigins = [frontendUrl, 'http://localhost:5173', 'http://localhost:5174'];
  app.enableCors({
    origin: (origin, cb) => {
      if (!origin || allowedOrigins.includes(origin)) return cb(null, true);
      cb(new Error(`CORS: origin ${origin} not allowed`));
    },
    credentials: true,
    methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  });

  app.setGlobalPrefix('api/v1');

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: true },
      validationError: { value: false },
    }),
  );

  app.useGlobalFilters(new GlobalExceptionFilter());

  await app.listen(port);
}

bootstrap();
