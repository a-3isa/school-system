import { Role } from '@prisma/client';

/** How many days a sign-in lasts: staff and the platform owner a week, parents a month. */
export const SESSION_DAYS = (role: string) => (role === Role.PARENT ? 30 : 7);
