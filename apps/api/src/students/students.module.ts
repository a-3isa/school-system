import { Module } from '@nestjs/common';
import { ParentController, StudentsController, StudentsService } from './students';
import { StudentImportController, StudentImportService } from './import';

@Module({
  controllers: [StudentImportController, StudentsController, ParentController],
  providers: [StudentsService, StudentImportService],
  exports: [StudentsService],
})
export class StudentsModule {}
