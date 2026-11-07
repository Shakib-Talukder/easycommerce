import nodemailer, { type Transporter } from "nodemailer";
import { isProduction, warnOnce } from "../env";
import type { NotificationProvider, OutgoingMessage } from "./types";

export class ConsoleEmailProvider implements NotificationProvider {
  readonly name = "console-email";
  readonly channel = "email";

  async send({ to, subject, text }: OutgoingMessage) {
    console.info(`[email:console] to=${to} subject=${JSON.stringify(subject ?? "")}\n${text}`);
  }
}

/** SMTP via nodemailer (Mailpit on localhost:1025 in development). */
export class SmtpEmailProvider implements NotificationProvider {
  readonly name = "smtp";
  readonly channel = "email";

  constructor(
    private readonly transporter: Transporter,
    private readonly from: string,
  ) {}

  async send({ to, subject, text }: OutgoingMessage) {
    await this.transporter.sendMail({ from: this.from, to, subject, text });
  }
}

const globalForEmail = globalThis as unknown as { __ecEmail?: Promise<NotificationProvider> };

/**
 * SMTP when SMTP_HOST answers. In development an unreachable SMTP server falls
 * back to logging the email (warning once). In production it is an error.
 */
export function getEmailProvider(): Promise<NotificationProvider> {
  globalForEmail.__ecEmail ??= createEmailProvider().catch((error: unknown) => {
    globalForEmail.__ecEmail = undefined;
    throw error;
  });
  return globalForEmail.__ecEmail;
}

async function createEmailProvider(): Promise<NotificationProvider> {
  const host = process.env.SMTP_HOST;
  const port = Number(process.env.SMTP_PORT ?? 1025);
  const from = process.env.SMTP_FROM ?? "EasyCommerce <no-reply@easycommerce.local>";
  if (host) {
    const transporter = nodemailer.createTransport({
      host,
      port,
      secure: port === 465,
      connectionTimeout: 2000,
      greetingTimeout: 2000,
      ...(process.env.SMTP_USER
        ? { auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASSWORD ?? "" } }
        : {}),
    });
    try {
      await transporter.verify();
      return new SmtpEmailProvider(transporter, from);
    } catch (error) {
      if (isProduction()) throw new Error(`SMTP at ${host}:${port} is unreachable (${String(error)}).`);
    }
  } else if (isProduction()) {
    throw new Error("SMTP_HOST is required in production.");
  }
  warnOnce(
    "email-console",
    `[email] SMTP ${host ?? "(unset)"}:${port} unreachable; logging emails to the console.`,
  );
  return new ConsoleEmailProvider();
}
