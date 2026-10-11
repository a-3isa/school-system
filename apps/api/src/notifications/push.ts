import { Injectable, Logger } from '@nestjs/common';
import { App, cert, initializeApp } from 'firebase-admin/app';
import { getMessaging } from 'firebase-admin/messaging';
import { readFileSync } from 'fs';

export interface PushMessage {
  token: string;
  title: string;
  body: string;
  /** What the app needs to open the right screen. FCM only takes strings. */
  data: Record<string, string>;
}

export interface PushOutcome {
  token: string;
  ok: boolean;
  /** The phone no longer has the app, or the token was never good: forget it. */
  invalid: boolean;
}

/** Sends push notifications to phones. The real one talks to Firebase; tests swap in a fake. */
export abstract class PushSender {
  abstract readonly enabled: boolean;
  abstract send(messages: PushMessage[]): Promise<PushOutcome[]>;
}

const GONE = new Set(['messaging/registration-token-not-registered', 'messaging/invalid-registration-token']);
/** FCM says a token is malformed with a general code; only that wording means "forget this phone". */
const gone = (code: string, message = '') => GONE.has(code) || (code === 'messaging/invalid-argument' && /registration token/i.test(message));
const BATCH = 500;

/**
 * Firebase Cloud Messaging through the Admin SDK. It is switched on by
 * FIREBASE_SERVICE_ACCOUNT: the path of the service account's JSON file, or
 * the JSON itself. Without it nothing is sent (the notifications are still
 * saved and show in the app's list).
 */
@Injectable()
export class FcmSender extends PushSender {
  private readonly logger = new Logger('Push');
  private app: App | null = null;

  constructor() {
    super();
    const source = process.env.FIREBASE_SERVICE_ACCOUNT?.trim();
    if (!source) return;
    try {
      const json = source.startsWith('{') ? source : readFileSync(source, 'utf8');
      this.app = initializeApp({ credential: cert(JSON.parse(json)) }, 'school-platform-push');
      this.logger.log('Push notifications are on (Firebase).');
    } catch (e) {
      // A wrong path or a broken file must not stop the server; push just stays off.
      this.logger.error(`FIREBASE_SERVICE_ACCOUNT can't be used, so push is off: ${(e as Error).message}`);
    }
  }

  get enabled() {
    return !!this.app;
  }

  async send(messages: PushMessage[]): Promise<PushOutcome[]> {
    if (!this.app) return [];
    const out: PushOutcome[] = [];
    for (let i = 0; i < messages.length; i += BATCH) {
      const batch = messages.slice(i, i + BATCH);
      const res = await getMessaging(this.app).sendEach(
        batch.map((m) => ({
          token: m.token,
          notification: { title: m.title, body: m.body },
          data: m.data,
          android: { priority: 'high' as const },
          apns: { payload: { aps: { sound: 'default' } } },
        })),
      );
      res.responses.forEach((r, j) => {
        const code = r.error?.code ?? '';
        const invalid = !r.success && gone(code, r.error?.message);
        out.push({ token: batch[j].token, ok: r.success, invalid });
        if (!r.success && !invalid) this.logger.warn(`push to a phone failed: ${code} ${r.error?.message ?? ''}`);
      });
    }
    return out;
  }
}
