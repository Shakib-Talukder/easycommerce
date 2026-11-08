export type OutgoingMessage = {
  /** Email address or E.164 phone, depending on the provider. */
  to: string;
  /** Email only. */
  subject?: string;
  text: string;
};

export interface NotificationProvider {
  readonly name: string;
  readonly channel: "email" | "sms";
  /** Providers that get a gateway message id return it. */
  send(message: OutgoingMessage): Promise<void | { messageId: string | null }>;
}
