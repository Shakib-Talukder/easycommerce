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
  send(message: OutgoingMessage): Promise<void>;
}
