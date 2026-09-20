export class SensitiveDataSanitizer {
  private static readonly JWT_REGEX = /Bearer\s+ey[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/gi;
  private static readonly RAW_JWT_REGEX = /\bey[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}\b/gi;
  private static readonly API_KEY_REGEX = /\b(gsk_|AIza|sk-|ghp_|gho_|xoxb-|xoxp-)[A-Za-z0-9_-]{16,}\b/gi;
  private static readonly BCRYPT_REGEX = /\$2[abxy]\$\d{2}\$[A-Za-z0-9./]{53}/gi;
  private static readonly ARGON2_REGEX = /\$argon2[id]?\$v=\d+\$m=\d+,t=\d+,p=\d+\$[A-Za-z0-9+/]+\$[A-Za-z0-9+/]+/gi;
  private static readonly DB_URI_REGEX = /(?:postgres|postgresql|mysql|mongodb|redis):\/\/[^:\s]+:[^@\s]+@[^\s]+/gi;
  private static readonly PRIVATE_KEY_REGEX = /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----[\s\S]*?-----END (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/gi;

  private static readonly PROMPT_INJECTION_PATTERNS = [
    /ignore\s+(all\s+)?(previous|prior|above)\s+(instructions|directions|prompts|rules)/i,
    /system\s+(override|prompt|bypass|reset)/i,
    /you\s+are\s+now\s+(in\s+dan\s+mode|unrestricted|jailbroken)/i,
    /disregard\s+(all\s+)?(safety|rules|guidelines)/i,
    /reveal\s+(your\s+)?(system\s+prompt|instructions|api\s*keys)/i,
    /bypass\s+all\s+(filters|policies)/i,
    /<\/?(system|instruction|prompt_override)>/i,
  ];

  /**
   * Evaluates whether an input text contains prompt injection or jailbreak patterns.
   */
  static detectPromptInjection(text: string): { isInjection: boolean; patternMatched?: string } {
    if (!text) return { isInjection: false };

    for (const pattern of this.PROMPT_INJECTION_PATTERNS) {
      if (pattern.test(text)) {
        return { isInjection: true, patternMatched: pattern.source };
      }
    }

    return { isInjection: false };
  }

  /**
   * Sanitizes text strings to remove potential credentials, secrets, and internal reasoning tags.
   */
  static sanitizeText(text: string): string {
    if (!text) return text;

    // Strip reasoning model internal scratchpad tags (<think>...</think>)
    let cleaned = text
      .replace(/<think>[\s\S]*?<\/think>/gi, '')
      .replace(/<think>[\s\S]*/gi, '') // in case tag was not closed due to token limit
      .trim();

    // If stripping resulted in empty string (e.g. model only output thinking), fallback to original without tags
    if (!cleaned && text.trim()) {
      cleaned = text.replace(/<\/?think>/gi, '').trim();
    }

    return cleaned
      .replace(this.PRIVATE_KEY_REGEX, '[REDACTED_PRIVATE_KEY]')
      .replace(this.DB_URI_REGEX, '[REDACTED_DB_URI]')
      .replace(this.JWT_REGEX, 'Bearer [REDACTED_JWT]')
      .replace(this.RAW_JWT_REGEX, '[REDACTED_JWT]')
      .replace(this.API_KEY_REGEX, '[REDACTED_API_KEY]')
      .replace(this.BCRYPT_REGEX, '[REDACTED_PASSWORD_HASH]')
      .replace(this.ARGON2_REGEX, '[REDACTED_PASSWORD_HASH]');
  }

  /**
   * Recursively sanitizes JSON objects, arrays, and primitive values.
   */
  static sanitizeValue<T>(val: T): T {
    if (val === null || val === undefined) {
      return val;
    }

    if (typeof val === 'string') {
      return this.sanitizeText(val) as unknown as T;
    }

    if (Array.isArray(val)) {
      return (val as unknown[]).map((item) => this.sanitizeValue(item)) as unknown as T;
    }

    if (typeof val === 'object') {
      const sanitizedObj: Record<string, unknown> = {};
      const SENSITIVE_KEY_NAMES = [
        'password',
        'passwordhash',
        'refreshtoken',
        'accesstoken',
        'clientsecret',
        'privatekey',
        'secretkey',
        'secret',
        'authorization',
      ];

      for (const [k, v] of Object.entries(val as Record<string, unknown>)) {
        const lowerKey = k.toLowerCase().replace(/[-_]/g, '');
        if (SENSITIVE_KEY_NAMES.includes(lowerKey)) {
          sanitizedObj[k] = '[REDACTED]';
        } else {
          sanitizedObj[k] = this.sanitizeValue(v);
        }
      }
      return sanitizedObj as unknown as T;
    }

    return val;
  }
}
