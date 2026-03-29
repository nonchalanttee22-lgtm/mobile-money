import twilio from "twilio";
import { SmsService, TransactionSmsContext, formatPhoneE164 } from "./sms";

export interface WhatsappSendResult {
  sent: boolean;
  provider: "whatsapp" | "sms";
  messageSid?: string;
  error?: string;
  skippedReason?: string;
}

export class WhatsappService {
  private client: ReturnType<typeof twilio> | null = null;
  private smsService: SmsService;

  constructor(smsService?: SmsService) {
    this.smsService = smsService || new SmsService();
    const sid = process.env.TWILIO_ACCOUNT_SID;
    const token = process.env.TWILIO_AUTH_TOKEN;
    if (sid && token) {
      this.client = twilio(sid, token);
    }
  }

  private shouldSendWhatsApp(): boolean {
    const enabled = process.env.WHATSAPP_ENABLED === "true";
    return enabled && this.client !== null;
  }

  /**
   * Sends a message via WhatsApp with fallback to SMS.
   * WhatsApp requires pre-approved templates for business-initiated messages.
   */
  async sendWithFallback(
    toRaw: string,
    body: string,
    templateSid?: string,
    templateVariables?: Record<string, string>,
  ): Promise<WhatsappSendResult> {
    let to: string;
    try {
      to = formatPhoneE164(toRaw);
    } catch (e) {
      return {
        sent: false,
        provider: "whatsapp",
        skippedReason: "invalid_phone",
        error: e instanceof Error ? e.message : String(e),
      };
    }

    const whatsappFrom = process.env.TWILIO_WHATSAPP_NUMBER; // Format: whatsapp:+1234567890

    if (this.shouldSendWhatsApp() && whatsappFrom) {
      try {
        const messageParams: any = {
          from: whatsappFrom,
          to: `whatsapp:${to}`,
        };

        if (templateSid) {
          // Use Twilio Content SID / Template
          messageParams.contentSid = templateSid;
          if (templateVariables) {
            messageParams.contentVariables = JSON.stringify(templateVariables);
          }
        } else {
          // Regular text message (only works if a session is already open)
          messageParams.body = body;
        }

        const message = await this.client!.messages.create(messageParams);

        console.log("[whatsapp] delivered", {
          to,
          sid: message.sid,
          status: message.status,
        });

        return {
          sent: true,
          provider: "whatsapp",
          messageSid: message.sid,
        };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.warn("[whatsapp] failed, falling back to SMS", { to, error: msg })

        // Fallback to SMS
        const smsResult = await this.smsService.sendToPhone(to, body);
        return {
          sent: smsResult.sent,
          provider: "sms",
          messageSid: smsResult.messageSid,
          error: smsResult.error,
          skippedReason: smsResult.skippedReason,
        };
      }
    }

    // WhatsApp disabled or missing config, go straight to SMS
    console.log("[whatsapp] skipped or not configured, using SMS instead");
    const smsResult = await this.smsService.sendToPhone(to, body);
    return {
      sent: smsResult.sent,
      provider: "sms",
      messageSid: smsResult.messageSid,
      error: smsResult.error,
      skippedReason: smsResult.skippedReason,
    };
  }

  /**
   * Notify transaction event via WhatsApp (with SMS fallback)
   */
  async notifyTransactionEvent(
    phoneNumber: string,
    ctx: TransactionSmsContext,
  ): Promise<WhatsappSendResult> {
    const body = this.buildTransactionMessage(ctx);

    // In a real production environment, you would use a Twilio Content SID (template)
    // for WhatsApp business-initiated messages.
    const templateSid = process.env.TWILIO_WHATSAPP_TRANSACTION_TEMPLATE_SID;
    const templateVariables = {
      "1": ctx.type === "deposit" ? "deposit" : "withdrawal",
      "2": ctx.amount,
      "3": ctx.provider.toUpperCase(),
      "4": ctx.referenceNumber,
    };

    return this.sendWithFallback(phoneNumber, body, templateSid, templateVariables);
  }

  /**
   * Send OTP via WhatsApp (with SMS fallback)
   */
  async sendOTP(phoneNumber: string, otp: string): Promise<WhatsappSendResult> {
    const body = `Your Mobile Money verification code is: ${otp}. Do not share this code with anyone.`;

    const templateSid = process.env.TWILIO_WHATSAPP_OTP_TEMPLATE_SID;
    const templateVariables = { "1": otp };

    return this.sendWithFallback(phoneNumber, body, templateSid, templateVariables);
  }

  private buildTransactionMessage(ctx: TransactionSmsContext): string {
    const action = ctx.type === "deposit" ? "deposit" : "withdrawal";
    if (ctx.kind === "transaction_completed") {
      return `Mobile Money: Your ${action} of ${ctx.amount} (${ctx.provider.toUpperCase()}) completed. Ref: ${ctx.referenceNumber}.`;
    } else {
      const detail = ctx.errorMessage ? ` Reason: ${ctx.errorMessage.slice(0, 120)}` : "";
      return `Mobile Money: Your ${action} could not be completed. Ref: ${ctx.referenceNumber}.${detail}`;
    }
  }
}
