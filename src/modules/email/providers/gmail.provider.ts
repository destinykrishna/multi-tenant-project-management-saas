import { BadRequestError } from '../../../utils/errors.js';
import { gmailService, type GmailService } from '../../integrations/google/gmail.service.js';
import type { IEmailProvider, EmailMessage, EmailSendResult } from '../email.types.js';

export class GmailEmailProvider implements IEmailProvider {
  readonly name = 'gmail' as const;

  constructor(private readonly gMailService: GmailService = gmailService) {}

  async send(message: EmailMessage): Promise<EmailSendResult> {
    if (!message.userId) {
      throw new BadRequestError(
        'User ID is required to send email via user connected Gmail account',
        'GMAIL_USER_ID_REQUIRED',
      );
    }

    return this.gMailService.sendEmail(message.userId, message);
  }
}

export const gmailEmailProvider = new GmailEmailProvider();
