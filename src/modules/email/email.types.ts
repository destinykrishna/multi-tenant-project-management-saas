export interface EmailMessage {
  to: string | string[];
  from?: string;
  subject: string;
  text?: string;
  html?: string;
  userId?: string; // Application user ID if sending via user's connected account (e.g. Gmail)
}

export interface EmailSendResult {
  messageId: string;
  provider: 'smtp' | 'gmail';
  response?: string;
  timestamp?: string;
}

export interface IEmailProvider {
  readonly name: 'smtp' | 'gmail';
  send(message: EmailMessage): Promise<EmailSendResult>;
}
