import { Module } from '@nestjs/common';
import { ParentController, StudentsController, StudentsService } from './students';
import { StudentImportController, StudentImportService } from './import';
import { ParentsController, ParentsService } from './parents';
import { StudentFilesController, StudentFilesService } from './files';

@Module({
  controllers: [StudentImportController, StudentFilesController, StudentsController, ParentController, ParentsController],
  providers: [StudentsService, StudentImportService, ParentsService, StudentFilesService],
  exports: [StudentsService],
})
export class StudentsModule {}
