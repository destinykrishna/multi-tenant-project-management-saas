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

    const isGmailUser = env.SMTP_USER.trim().endsWith('@gmail.com');
    const host =
      isGmailUser &&
      (env.SMTP_HOST === 'smtp.ethereal.email' || env.SMTP_HOST === 'localhost' || !env.SMTP_HOST)
        ? 'smtp.gmail.com'
        : env.SMTP_HOST;
    const cleanPass = env.SMTP_PASS ? env.SMTP_PASS.replace(/\s+/g, '') : '';

    const smtpOptions: SMTPTransport.Options = {
      host,
      port: env.SMTP_PORT,
      secure: env.SMTP_SECURE,
      auth:
        env.SMTP_USER && cleanPass
          ? {
              user: env.SMTP_USER.trim(),
              pass: cleanPass,
            }
          : undefined,
    };

    return nodemailer.createTransport(smtpOptions);
  }

  async send(message: EmailMessage): Promise<EmailSendResult> {
    const isGmailUser = env.SMTP_USER.trim().endsWith('@gmail.com');
    let fromAddress = message.from ?? env.EMAIL_FROM;
    if (
      !message.from &&
      isGmailUser &&
      env.SMTP_USER &&
      fromAddress.includes('@multitenantbackend.com')
    ) {
      fromAddress = `"Multi-Tenant Workspace" <${env.SMTP_USER.trim()}>`;
    }

    const mailOptions: SendMailOptions = {
      from: fromAddress,
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
      if (
        error &&
        typeof error === 'object' &&
        'code' in error &&
        (error as { code: string }).code === 'EAUTH'
      ) {
        logger.error(
          {
            to: message.to,
            host: env.SMTP_HOST,
            user: env.SMTP_USER,
            tip: 'If using Gmail (smtp.gmail.com), you MUST use a 16-character Google App Password from https://myaccount.google.com/apppasswords, not your standard Google login password.',
          },
          'SMTP Authentication Failed (535 EAUTH)',
        );
      } else {
        logger.error(
          { error, to: message.to, subject: message.subject },
          'Failed to send email via SMTP provider',
        );
      }
      throw error;
    }
  }

  getTransporter(): Transporter {
    return this.transporter;
  }
}

export const smtpEmailProvider = new SmtpEmailProvider();
