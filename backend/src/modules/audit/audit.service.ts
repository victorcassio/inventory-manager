import { Injectable } from '@nestjs/common';
import { Prisma, PrismaClient } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

export type Tx = Omit<PrismaClient, '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'>;

export interface AuditLogData {
  userId: string;
  action: string;
  entity: string;
  entityId?: string;
  payload?: Prisma.InputJsonValue;
  ipAddress?: string;
}

@Injectable()
export class AuditService {
  constructor(private readonly prisma: PrismaService) {}

  async log(data: AuditLogData, tx?: Tx): Promise<void> {
    const client = tx ?? this.prisma;
    await client.auditLog.create({
      data: {
        userId: data.userId,
        action: data.action,
        entity: data.entity,
        entityId: data.entityId,
        payload: data.payload,
        ipAddress: data.ipAddress,
      },
    });
  }
}
