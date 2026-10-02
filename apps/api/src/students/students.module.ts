import { Module } from '@nestjs/common';
import { ParentController, StudentsController, StudentsService } from './students';
import { StudentImportController, StudentImportService } from './import';
import { ParentsController, ParentsService } from './parents';

@Module({
  controllers: [StudentImportController, StudentsController, ParentController, ParentsController],
  providers: [StudentsService, StudentImportService, ParentsService],
  exports: [StudentsService],
})
export class StudentsModule {}
