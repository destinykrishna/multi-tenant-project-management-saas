import nodemailer, { type Transporter, type SendMailOptions } from 'nodemailer';
import type SMTPTransport from 'nodemailer/lib/smtp-transport/index.js';
import { env } from '../../../config/env.js';
import { logger } from '../../../config/logger.js';
import type { IEmailProvider, EmailMessage, EmailSendResult } from '../email.types.js';

export class SmtpEmailProvider implements IEmailProvider {
  readonly name = 'smtp' as const;
  private transporter: Transporter;

  constructor() {
    this.transporter = this.createTransporter();
  }

  private createTransporter(): Transporter {
    if (env.NODE_ENV === 'test') {
      return nodemailer.createTransport({
        jsonTransport: true,
      });
    }

    const smtpOptions: SMTPTransport.Options = {
      host: env.SMTP_HOST,
      port: env.SMTP_PORT,
      secure: env.SMTP_SECURE,
      auth:
        env.SMTP_USER && env.SMTP_PASS
          ? {
              user: env.SMTP_USER,
              pass: env.SMTP_PASS,
            }
          : undefined,
    };

    return nodemailer.createTransport(smtpOptions);
  }

  async send(message: EmailMessage): Promise<EmailSendResult> {
    const mailOptions: SendMailOptions = {
      from: message.from ?? env.EMAIL_FROM,
      to: message.to,
      subject: message.subject,
      text: message.text,
      html: message.html,
    };

    try {
      const info = (await this.transporter.sendMail(mailOptions)) as {
        messageId?: string;
        response?: string;
      };

      const messageId = typeof info.messageId === 'string' ? info.messageId : '';

      logger.info({ messageId, to: message.to }, 'Email sent successfully via SMTP provider');

      return {
        messageId,
        provider: 'smtp',
        response: typeof info.response === 'string' ? info.response : undefined,
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      logger.error(
        { error, to: message.to, subject: message.subject },
        'Failed to send email via SMTP provider',
      );
      throw error;
    }
  }

  getTransporter(): Transporter {
    return this.transporter;
  }
}

export const smtpEmailProvider = new SmtpEmailProvider();
