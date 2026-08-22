import type { Transporter, SendMailOptions } from 'nodemailer';
import { logger } from './logger.js';
import { addEmailJob, type EmailJobData } from '../jobs/queues/email.queue.js';
import type {
  IEmailProvider,
  EmailMessage,
  EmailSendResult,
} from '../modules/email/email.types.js';
import { smtpEmailProvider, SmtpEmailProvider } from '../modules/email/providers/smtp.provider.js';
import { gmailEmailProvider } from '../modules/email/providers/gmail.provider.js';

export type SendEmailResult = EmailSendResult;

export class EmailService {
  private providers: Map<'smtp' | 'gmail', IEmailProvider>;

  constructor(
    smtpProvider: IEmailProvider = smtpEmailProvider,
    gmailProvider: IEmailProvider = gmailEmailProvider,
  ) {
    this.providers = new Map();
    this.providers.set('smtp', smtpProvider);
    this.providers.set('gmail', gmailProvider);
  }

  getProvider(name: 'smtp' | 'gmail'): IEmailProvider {
    const provider = this.providers.get(name);
    if (!provider) {
      throw new Error(`Email provider '${name}' not registered`);
    }
    return provider;
  }

  async sendDirect(
    options: SendMailOptions & { provider?: 'smtp' | 'gmail'; userId?: string },
  ): Promise<SendEmailResult> {
    const providerName: 'smtp' | 'gmail' =
      options.provider === 'gmail' || (options.userId && options.provider !== 'smtp')
        ? 'gmail'
        : 'smtp';

    const provider = this.getProvider(providerName);

    const message: EmailMessage = {
      to: options.to as string | string[],
      from: typeof options.from === 'string' ? options.from : undefined,
      subject: options.subject || '',
      text: typeof options.text === 'string' ? options.text : undefined,
      html: typeof options.html === 'string' ? options.html : undefined,
      userId: options.userId,
    };

    try {
      const result = await provider.send(message);
      return result;
    } catch (error) {
      logger.error(
        { error, to: options.to, subject: options.subject, provider: providerName },
        'Failed to send email via provider',
      );
      throw error;
    }
  }

  async queueEmail(data: EmailJobData) {
    logger.debug(
      { to: data.to, subject: data.subject, provider: data.provider },
      'Queueing email job',
    );
    return addEmailJob(data);
  }

  getTransporter(): Transporter {
    const smtp = this.providers.get('smtp');
    if (smtp instanceof SmtpEmailProvider) {
      return smtp.getTransporter();
    }
    return smtpEmailProvider.getTransporter();
  }
}

export const emailService = new EmailService();
