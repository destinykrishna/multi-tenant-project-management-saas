import { logger } from '../../../config/logger.js';
import {
  BadRequestError,
  ForbiddenError,
  UnauthorizedError,
  AppError,
} from '../../../utils/errors.js';
import { googleService, GOOGLE_SCOPES, type GoogleService } from './google.service.js';
import type { EmailMessage, EmailSendResult } from '../../email/email.types.js';

const GMAIL_SEND_ENDPOINT = 'https://gmail.googleapis.com/gmail/v1/users/me/messages/send';

export class GmailService {
  constructor(private readonly gService: GoogleService = googleService) {}

  /**
   * Constructs an RFC 2822 compliant MIME email string and converts it to Base64URL format.
   */
  encodeRfc2822Message(message: EmailMessage, senderEmail?: string): string {
    const toRecipients = Array.isArray(message.to) ? message.to.join(', ') : message.to;
    const boundary = `====_NextPart_${Date.now().toString(16)}====`;

    const headers: string[] = [
      `To: ${toRecipients}`,
      `Subject: =?utf-8?B?${Buffer.from(message.subject, 'utf8').toString('base64')}?=`,
      'MIME-Version: 1.0',
    ];

    if (senderEmail || message.from) {
      headers.unshift(`From: ${message.from || senderEmail}`);
    }

    let mimeBody: string;

    if (message.text && message.html) {
      headers.push(`Content-Type: multipart/alternative; boundary="${boundary}"`);
      mimeBody = [
        `--${boundary}`,
        'Content-Type: text/plain; charset="UTF-8"',
        'Content-Transfer-Encoding: 8bit',
        '',
        message.text,
        `--${boundary}`,
        'Content-Type: text/html; charset="UTF-8"',
        'Content-Transfer-Encoding: 8bit',
        '',
        message.html,
        `--${boundary}--`,
      ].join('\r\n');
    } else if (message.html) {
      headers.push('Content-Type: text/html; charset="UTF-8"');
      headers.push('Content-Transfer-Encoding: 8bit');
      mimeBody = message.html;
    } else {
      headers.push('Content-Type: text/plain; charset="UTF-8"');
      headers.push('Content-Transfer-Encoding: 8bit');
      mimeBody = message.text || '';
    }

    const fullMessage = `${headers.join('\r\n')}\r\n\r\n${mimeBody}`;

    // Convert to Base64URL format required by Gmail API
    return Buffer.from(fullMessage, 'utf8')
      .toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');
  }

  /**
   * Sends an email via the user's connected Gmail account using the official Gmail REST API.
   */
  async sendEmail(userId: string, message: EmailMessage): Promise<EmailSendResult> {
    // 1. Obtain valid access token (automatically refreshed if expired)
    const accessToken = await this.gService.getValidAccessToken(userId, GOOGLE_SCOPES.GMAIL_SEND);

    // 2. Format RFC 2822 message in Base64URL encoding
    const rawMessage = this.encodeRfc2822Message(message);

    // 3. Post to Gmail API messages.send endpoint
    const response = await fetch(GMAIL_SEND_ENDPOINT, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ raw: rawMessage }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      logger.error(
        { status: response.status, errorText, userId, to: message.to, subject: message.subject },
        'Gmail API message send failed',
      );

      if (response.status === 401) {
        throw new UnauthorizedError(
          'Google authentication expired or invalid. Please reconnect.',
          'GOOGLE_AUTH_INVALID',
        );
      }

      if (response.status === 403) {
        throw new ForbiddenError(
          'Insufficient permissions for Gmail sending or quota exceeded.',
          'GMAIL_API_FORBIDDEN',
        );
      }

      if (response.status === 429) {
        throw new AppError('Gmail API rate limit exceeded', 429, 'GMAIL_RATE_LIMIT');
      }

      throw new BadRequestError(
        `Gmail API send failed with HTTP ${response.status}`,
        'GMAIL_SEND_FAILED',
      );
    }

    const data = (await response.json()) as { id: string; threadId?: string };

    logger.info(
      { messageId: data.id, userId, to: message.to },
      'Email sent successfully via Gmail API',
    );

    return {
      messageId: data.id,
      provider: 'gmail',
      response: `Gmail message ID: ${data.id}`,
      timestamp: new Date().toISOString(),
    };
  }
}

export const gmailService = new GmailService();
