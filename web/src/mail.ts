import nodemailer, { type Transporter } from "nodemailer";

/**
 * Outbound email for magic-link sign-in. SMTP credentials are server-side only.
 * If SMTP is not configured, `createMailer` returns null and the caller falls
 * back to the dev behavior (log the link / return it only when DEV_LOG_EMAIL).
 */

export type MailMessage = {
  to: string;
  subject: string;
  text: string;
  html?: string;
};

export interface Mailer {
  send(message: MailMessage): Promise<void>;
}

export type SmtpConfig = {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  pass: string;
  from: string;
};

export class SmtpMailer implements Mailer {
  private readonly transporter: Transporter;

  constructor(private readonly config: SmtpConfig) {
    this.transporter = nodemailer.createTransport({
      host: config.host,
      port: config.port,
      secure: config.secure,
      auth: config.user ? { user: config.user, pass: config.pass } : undefined
    });
  }

  async send(message: MailMessage): Promise<void> {
    await this.transporter.sendMail({
      from: this.config.from || this.config.user,
      to: message.to,
      subject: message.subject,
      text: message.text,
      ...(message.html ? { html: message.html } : {})
    });
  }
}

export function createMailer(config: SmtpConfig | null): Mailer | null {
  if (!config || !config.host) return null;
  return new SmtpMailer(config);
}

/** Test double that records sent messages. */
export class MemoryMailer implements Mailer {
  sent: MailMessage[] = [];
  async send(message: MailMessage): Promise<void> {
    this.sent.push(message);
  }
  lastTo(email: string): MailMessage | undefined {
    return [...this.sent].reverse().find((m) => m.to === email);
  }
}

export function magicLinkMessage(opts: {
  to: string;
  link: string;
  productName?: string;
}): MailMessage {
  const name = opts.productName ?? "네이버 카페 엑셀 내보내기";
  const text = [
    `${name} 로그인 링크입니다.`,
    "",
    "아래 링크를 열면 로그인됩니다. 링크는 10분간 유효하며 한 번만 사용할 수 있습니다.",
    "",
    opts.link,
    "",
    "본인이 요청하지 않았다면 이 메일을 무시하세요."
  ].join("\n");
  const html = `<p>${name} 로그인 링크입니다.</p>
<p>아래 버튼을 누르면 로그인됩니다. 링크는 10분간 유효하며 한 번만 사용할 수 있습니다.</p>
<p><a href="${opts.link}">로그인하기</a></p>
<p style="color:#888;font-size:12px">본인이 요청하지 않았다면 이 메일을 무시하세요.</p>`;
  return { to: opts.to, subject: `[${name}] 로그인 링크`, text, html };
}
