import { Injectable, Logger } from '@nestjs/common';
import { createTransport, Transporter } from 'nodemailer';

export interface Email {
  to: string;
  subject: string;
  text: string;
}

/**
 * Sends email (account codes now; school messages later). Set SMTP_URL, e.g.
 * smtps://user:password@smtp.example.com:465, and EMAIL_FROM. Without
 * SMTP_URL, emails are only written to the log, which is enough for
 * development and tests.
 */
@Injectable()
export class EmailService {
  private readonly logger = new Logger('Email');
  private transport: Transporter | null = null;
  /** Every email not really sent, for tests and local development only. */
  readonly outbox: Email[] = [];

  async send(email: Email) {
    const url = process.env.SMTP_URL;
    if (!url) {
      this.outbox.push(email);
      this.logger.log(`(SMTP_URL not set) to ${email.to}: ${email.subject}\n${email.text}`);
      return;
    }
    this.transport ??= createTransport(url);
    await this.transport.sendMail({ from: process.env.EMAIL_FROM ?? 'School Platform <no-reply@localhost>', ...email });
  }

  /** The latest email to an address (tests). */
  last(to: string) {
    return [...this.outbox].reverse().find((e) => e.to === to);
  }
}
