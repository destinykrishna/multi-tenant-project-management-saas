import nodemailer, { type Transporter, type SendMailOptions } from 'nodemailer';
import type SMTPTransport from 'nodemailer/lib/smtp-transport/index.js';
import { env } from './env.js';
import { logger } from './logger.js';
import { addEmailJob, type EmailJobData } from '../jobs/queues/email.queue.js';

export interface SendEmailResult {
  messageId: string;
  response?: string;
}

export class EmailService {
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

  async sendDirect(options: SendMailOptions): Promise<SendEmailResult> {
    const mailOptions: SendMailOptions = {
      from: options.from ?? env.EMAIL_FROM,
      ...options,
    };

    try {
      const info = (await this.transporter.sendMail(mailOptions)) as {
        messageId?: string;
        response?: string;
      };

      const messageId = typeof info.messageId === 'string' ? info.messageId : '';

      logger.info({ messageId, to: options.to }, 'Email sent successfully via transport');

      return {
        messageId,
        response: typeof info.response === 'string' ? info.response : undefined,
      };
    } catch (error) {
      logger.error(
        { error, to: options.to, subject: options.subject },
        'Failed to send email via transport',
      );
      throw error;
    }
  }

  async queueEmail(data: EmailJobData) {
    logger.debug({ to: data.to, subject: data.subject }, 'Queueing email job');
    return addEmailJob(data);
  }

  getTransporter(): Transporter {
    return this.transporter;
  }
}

export const emailService = new EmailService();
