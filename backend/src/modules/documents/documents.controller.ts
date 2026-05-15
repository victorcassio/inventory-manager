import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Res,
  Request,
  UseGuards,
} from '@nestjs/common';
import { Response } from 'express';
import { UserRole } from '@prisma/client';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { DocumentsService } from './documents.service';
import * as fs from 'fs';

@UseGuards(JwtAuthGuard, RolesGuard)
@Controller()
export class DocumentsController {
  constructor(private readonly documentsService: DocumentsService) {}

  @Post('rentals/:id/documents/contract')
  @Roles(UserRole.admin, UserRole.attendant)
  @HttpCode(HttpStatus.CREATED)
  generateContract(@Param('id', ParseUUIDPipe) id: string, @Request() req: any) {
    return this.documentsService.generateContract(id, req.user.id);
  }

  @Post('payments/:id/documents/receipt')
  @Roles(UserRole.admin, UserRole.financial)
  @HttpCode(HttpStatus.CREATED)
  generateReceipt(@Param('id', ParseUUIDPipe) id: string, @Request() req: any) {
    return this.documentsService.generateReceipt(id, req.user.id);
  }

  @Post('returns/:id/documents/proof')
  @Roles(UserRole.admin, UserRole.attendant)
  @HttpCode(HttpStatus.CREATED)
  generateReturnProof(@Param('id', ParseUUIDPipe) id: string, @Request() req: any) {
    return this.documentsService.generateReturnProof(id, req.user.id);
  }

  @Get('rentals/:id/documents')
  @Roles(UserRole.admin, UserRole.attendant, UserRole.financial)
  listDocumentsByRental(@Param('id', ParseUUIDPipe) id: string) {
    return this.documentsService.listDocumentsByRental(id);
  }

  @Get('documents/:id/download')
  @Roles(UserRole.admin, UserRole.attendant, UserRole.financial)
  async downloadDocument(
    @Param('id', ParseUUIDPipe) id: string,
    @Res() res: Response,
  ) {
    const { path, filename, mimeType } = await this.documentsService.downloadDocument(id);
    res.set({
      'Content-Type': mimeType,
      'Content-Disposition': `attachment; filename="${filename}"`,
    });
    fs.createReadStream(path).pipe(res);
  }
}
