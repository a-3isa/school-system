import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';

export const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

/** Minutes since midnight for an HH:mm string. */
export const toMinutes = (hhmm: string) => {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
};

/**
 * Turns Prisma's constraint errors into messages people can act on.
 * `conflict` explains which unique rule was broken.
 */
export function mapPrismaError(err: unknown, conflict = 'This already exists.'): never {
  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    if (err.code === 'P2002') throw new ConflictException(conflict);
    if (err.code === 'P2025') throw new NotFoundException('Not found.');
    if (err.code === 'P2003') throw new BadRequestException('It’s still in use, or it refers to something that doesn’t exist.');
  }
  throw err;
}
