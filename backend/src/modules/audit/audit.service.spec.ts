import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from './audit.service';

const mockPrisma = {
  auditLog: {
    create: jest.fn(),
  },
};

describe('AuditService', () => {
  let service: AuditService;

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuditService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();
    service = module.get<AuditService>(AuditService);
  });

  it('creates an audit log entry using PrismaService', async () => {
    mockPrisma.auditLog.create.mockResolvedValue({});

    await service.log({
      userId: 'user-1',
      action: 'create_customer',
      entity: 'Customer',
      entityId: 'cust-1',
      payload: { name: 'Acme' },
    });

    expect(mockPrisma.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        userId: 'user-1',
        action: 'create_customer',
        entity: 'Customer',
        entityId: 'cust-1',
        payload: { name: 'Acme' },
      }),
    });
  });

  it('uses the provided tx client instead of PrismaService', async () => {
    const mockTx = { auditLog: { create: jest.fn().mockResolvedValue({}) } } as any;

    await service.log(
      { userId: 'user-1', action: 'update_customer', entity: 'Customer' },
      mockTx,
    );

    expect(mockTx.auditLog.create).toHaveBeenCalled();
    expect(mockPrisma.auditLog.create).not.toHaveBeenCalled();
  });

  it('works without entityId, payload or ipAddress', async () => {
    mockPrisma.auditLog.create.mockResolvedValue({});

    await expect(
      service.log({ userId: 'user-1', action: 'create_item', entity: 'Item' }),
    ).resolves.not.toThrow();
  });
});
