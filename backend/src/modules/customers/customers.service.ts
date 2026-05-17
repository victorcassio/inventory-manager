import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Customer } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService, Tx } from '../audit/audit.service';
import { normalizeDocument } from '../../common/validators/document.validator';
import { PaginatedResult } from '../../common/types/paginated-result.interface';
import { CreateCustomerDto } from './dto/create-customer.dto';
import { UpdateCustomerDto } from './dto/update-customer.dto';

interface ListQuery {
  page?: number;
  limit?: number;
  name?: string;
  document?: string;
  isActive?: boolean;
}

@Injectable()
export class CustomersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async create(dto: CreateCustomerDto, userId: string): Promise<Customer> {
    const document = normalizeDocument(dto.document);

    const existing = await this.prisma.customer.findUnique({ where: { document } });
    if (existing) {
      throw new ConflictException('A customer with this document already exists');
    }

    return this.prisma.$transaction(async (tx: Tx) => {
      const customer = await tx.customer.create({
        data: {
          name: dto.name,
          document,
          documentType: dto.documentType,
          phone: dto.phone,
          email: dto.email,
          address: dto.address as any,
          notes: dto.notes,
        },
      });

      await this.audit.log(
        { userId, action: 'create_customer', entity: 'Customer', entityId: customer.id },
        tx,
      );

      return customer;
    });
  }

  async findAll(query: ListQuery): Promise<PaginatedResult<Customer>> {
    const page = Number(query.page) || 1;
    const limit = Number(query.limit) || 20;
    const skip = (page - 1) * limit;

    const where: any = {
      isActive: query.isActive ?? true,
    };

    if (query.name) {
      where.name = { contains: query.name, mode: 'insensitive' };
    }

    if (query.document) {
      where.document = { contains: normalizeDocument(query.document) };
    }

    const [data, total] = await Promise.all([
      this.prisma.customer.findMany({ where, skip, take: limit, orderBy: { name: 'asc' } }),
      this.prisma.customer.count({ where }),
    ]);

    return { data, total, page, limit };
  }

  async findById(id: string): Promise<Customer> {
    const customer = await this.prisma.customer.findUnique({
      where: { id },
      include: { rentals: { where: { status: 'active' }, select: { id: true, contractNumber: true, startedAt: true, expectedReturn: true } } },
    });

    if (!customer) throw new NotFoundException('Customer not found');
    return customer as unknown as Customer;
  }

  async update(id: string, dto: UpdateCustomerDto, userId: string): Promise<Customer> {
    const existing = await this.prisma.customer.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Customer not found');

    return this.prisma.$transaction(async (tx: Tx) => {
      const customer = await tx.customer.update({
        where: { id },
        data: {
          name: dto.name,
          phone: dto.phone,
          email: dto.email,
          address: dto.address as any,
          notes: dto.notes,
          isActive: dto.isActive,
        },
      });

      await this.audit.log(
        { userId, action: 'update_customer', entity: 'Customer', entityId: id },
        tx,
      );

      return customer;
    });
  }

  async deactivate(id: string, userId: string): Promise<void> {
    const existing = await this.prisma.customer.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Customer not found');

    await this.prisma.$transaction(async (tx: Tx) => {
      await tx.customer.update({ where: { id }, data: { isActive: false } });
      await this.audit.log(
        { userId, action: 'deactivate_customer', entity: 'Customer', entityId: id },
        tx,
      );
    });
  }
}
