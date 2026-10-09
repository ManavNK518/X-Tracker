import type { FetchLike } from "@/server/providers/source/x/client";
import { formatAlertText, type AlertPayload, type Notifier } from "./types";

/**
 * Notification channel adapters. Credentials come from server-side
 * environment variables only. A channel is reported as "verified" in the UI
 * only after a test delivery succeeds (recorded in provider_health).
 */

export class TelegramNotifier implements Notifier {
  readonly channel = "telegram" as const;
  constructor(
    private readonly botToken: string | undefined,
    private readonly chatId: string | undefined,
    private readonly fetchImpl: FetchLike = fetch,
  ) {}
  configured() {
    return Boolean(this.botToken && this.chatId);
  }
  async send(payload: AlertPayload): Promise<void> {
    if (!this.configured()) throw new Error("Telegram is not configured");
    const { text } = formatAlertText(payload);
    const res = await this.fetchImpl(`https://api.telegram.org/bot${this.botToken}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: this.chatId, text: text.slice(0, 4000), disable_web_page_preview: true }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) {
      const body = (await res.json().catch(() => null)) as { description?: string } | null;
      throw new Error(`Telegram API ${res.status}${body?.description ? `: ${body.description.slice(0, 120)}` : ""}`);
    }
  }
}

export class DiscordNotifier implements Notifier {
  readonly channel = "discord" as const;
  constructor(
    private readonly webhookUrl: string | undefined,
    private readonly fetchImpl: FetchLike = fetch,
  ) {}
  configured() {
    return Boolean(this.webhookUrl && /^https:\/\/(discord|discordapp)\.com\/api\/webhooks\//.test(this.webhookUrl));
  }
  async send(payload: AlertPayload): Promise<void> {
    if (!this.configured()) throw new Error("Discord webhook is not configured");
    const { text } = formatAlertText(payload);
    const res = await this.fetchImpl(this.webhookUrl!, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: text.slice(0, 1900), allowed_mentions: { parse: [] } }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) throw new Error(`Discord webhook ${res.status}`);
  }
}

export interface SmtpOptions {
  host?: string;
  port: number;
  secure: boolean;
  user?: string;
  password?: string;
  from?: string;
  to?: string;
}

export class EmailNotifier implements Notifier {
  readonly channel = "email" as const;
  constructor(private readonly options: SmtpOptions) {}
  configured() {
    return Boolean(this.options.host && this.options.from && this.options.to);
  }
  async send(payload: AlertPayload): Promise<void> {
    if (!this.configured()) throw new Error("SMTP email is not configured");
    const nodemailer = await import("nodemailer");
    const transport = nodemailer.createTransport({
      host: this.options.host,
      port: this.options.port,
      secure: this.options.secure,
      auth: this.options.user ? { user: this.options.user, pass: this.options.password } : undefined,
      connectionTimeout: 15_000,
      greetingTimeout: 15_000,
      socketTimeout: 20_000,
    });
    const { subject, text } = formatAlertText(payload);
    await transport.sendMail({ from: this.options.from, to: this.options.to, subject, text });
  }
}
