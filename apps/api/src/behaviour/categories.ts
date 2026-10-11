import { BehaviourKind } from '@prisma/client';

// The short tags a note can carry, by kind. Their words (English and Arabic) are
// in the dashboard's strings (apps/web/lib/strings.ts, `beh.cat`) and the app's.
export const CATEGORIES: Record<BehaviourKind, readonly string[]> = {
  PRAISE: ['KINDNESS', 'EFFORT', 'ACHIEVEMENT', 'PARTICIPATION', 'LEADERSHIP', 'HELPING'],
  CONCERN: ['HOMEWORK', 'PUNCTUALITY', 'DISRUPTION', 'UNIFORM', 'EQUIPMENT', 'RESPECT'],
  INCIDENT: ['FIGHT', 'BULLYING', 'DAMAGE', 'SAFETY', 'OTHER'],
};

/** Merit points a note of each kind may carry, from the least to the most. */
export const POINT_RANGE: Record<BehaviourKind, readonly [number, number]> = {
  PRAISE: [1, 5],
  CONCERN: [-5, -1],
  INCIDENT: [-10, 0],
};
