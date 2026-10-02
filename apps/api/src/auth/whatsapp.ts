import { Injectable, Logger } from '@nestjs/common';

/**
 * Sends WhatsApp messages through Meta's WhatsApp Cloud API, using one shared
 * business number for every school (decision F31). Used to check a parent's
 * mobile number with a code, at sign-up and when they change it.
 *
 * Needs WHATSAPP_TOKEN, WHATSAPP_PHONE_ID and an approved authentication
 * template (WHATSAPP_OTP_TEMPLATE, default "verify_code", language ar or en).
 * Without them, messages are only logged, which is enough for development.
 */
@Injectable()
export class WhatsAppService {
  private readonly logger = new Logger('WhatsApp');
  /** The last message per phone, for tests and local development only. */
  readonly outbox = new Map<string, string>();

  get configured() {
    return !!(process.env.WHATSAPP_TOKEN && process.env.WHATSAPP_PHONE_ID);
  }

  async sendCode(phone: string, code: string, language: 'ar' | 'en' = 'ar') {
    if (!this.configured) {
      this.outbox.set(phone, code);
      this.logger.log(`(WhatsApp not configured) code for ${phone}: ${code}`);
      return;
    }
    const res = await fetch(`https://graph.facebook.com/v21.0/${process.env.WHATSAPP_PHONE_ID}/messages`, {
      method: 'POST',
      headers: { authorization: `Bearer ${process.env.WHATSAPP_TOKEN}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        to: phone.replace(/^\+/, ''),
        type: 'template',
        template: {
          name: process.env.WHATSAPP_OTP_TEMPLATE ?? 'verify_code',
          language: { code: language },
          components: [
            { type: 'body', parameters: [{ type: 'text', text: code }] },
            { type: 'button', sub_type: 'url', index: '0', parameters: [{ type: 'text', text: code }] },
          ],
        },
      }),
    });
    if (!res.ok) {
      this.logger.error(`WhatsApp send failed (${res.status}): ${await res.text()}`);
      throw new Error('We couldn’t send the code by WhatsApp. Try again in a minute.');
    }
  }
}
