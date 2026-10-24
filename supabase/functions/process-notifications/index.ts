/** Server-only transactional outbox worker. Never import this module into the SPA. */
type Notification = {
  id: string;
  event_type: 'booking_confirmed' | 'booking_cancelled' | 'booking_rescheduled' | 'booking_reminder';
  recipient_email: string;
  payload: {
    booking_id: string; customer_name: string; salon_name: string; salon_address: string;
    salon_city: string; timezone: string; owner_email?: string; service_name: string;
    staff_name: string; starts_at: string; ends_at: string; price_cents: number;
    cancellation_hours: number;
  };
};

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
});
const escapeHtml = (text: unknown) => String(text ?? '').replace(/[&<>"']/g,
  char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]!));

export function emailContent(notification: Notification, forOwner: boolean) {
  const p = notification.payload;
  const subject = {
    booking_confirmed: 'Επιβεβαίωση ραντεβού',
    booking_cancelled: 'Ακύρωση ραντεβού',
    booking_rescheduled: 'Αλλαγή ραντεβού',
    booking_reminder: 'Υπενθύμιση ραντεβού για αύριο',
  }[notification.event_type];
  const when = new Intl.DateTimeFormat('el-GR', {
    dateStyle: 'full', timeStyle: 'short', timeZone: p.timezone,
  }).format(new Date(p.starts_at));
  const price = new Intl.NumberFormat('el-GR', { style: 'currency', currency: 'EUR' }).format(p.price_cents / 100);
  const lines = [
    forOwner ? `Πελάτης: ${p.customer_name}` : `Γεια σας, ${p.customer_name}!`,
    notification.event_type === 'booking_cancelled' ? 'Το παρακάτω ραντεβού ακυρώθηκε.' :
      notification.event_type === 'booking_rescheduled' ? 'Το ραντεβού μεταφέρθηκε στη νέα ώρα:' :
      notification.event_type === 'booking_reminder' ? 'Μια μικρή υπενθύμιση: σας περιμένουμε αύριο στο ραντεβού σας!' : 'Το ραντεβού σας επιβεβαιώθηκε:',
    `Κατάστημα: ${p.salon_name}`, `Υπηρεσία: ${p.service_name}`, `Επαγγελματίας: ${p.staff_name}`,
    `Πότε: ${when}`, `Διεύθυνση: ${p.salon_address}, ${p.salon_city}`, `Τιμή: ${price}`,
    'Πληρωμή στο κατάστημα. Δεν έχει γίνει ηλεκτρονική χρέωση.',
    `Ακύρωση ή αλλαγή από τον λογαριασμό σας έως ${p.cancellation_hours} ώρες πριν από το ραντεβού.`,
    `Κωδικός ραντεβού: ${p.booking_id}`,
  ];
  return {
    subject: `${subject} · ${p.salon_name}`.replace(/[\r\n]/g, ' '),
    text: lines.join('\n\n'),
    html: `<div lang="el" style="font-family:Arial,sans-serif;max-width:600px;margin:auto;color:#25282b"><h1 style="font-size:24px">${escapeHtml(subject)}</h1>${lines.map(line => `<p>${escapeHtml(line)}</p>`).join('')}</div>`,
  };
}

export async function handleRequest(request: Request): Promise<Response> {
  if (request.method !== 'POST') return json({ error: 'METHOD_NOT_ALLOWED' }, 405);
  const workerSecret = Deno.env.get('NOTIFICATION_WORKER_SECRET');
  if (!workerSecret || workerSecret.length < 32) return json({ error: 'WORKER_NOT_CONFIGURED' }, 503);
  if (request.headers.get('Authorization') !== `Bearer ${workerSecret}`) return json({ error: 'UNAUTHORIZED' }, 401);
  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const resendKey = Deno.env.get('RESEND_API_KEY');
  const from = Deno.env.get('NOTIFICATION_FROM');
  if (!supabaseUrl || !serviceKey || !resendKey || !from) return json({ error: 'EMAIL_NOT_CONFIGURED' }, 503);

  const rpc = async (name: string, args: Record<string, unknown>) => {
    const response = await fetch(`${supabaseUrl.replace(/\/$/, '')}/rest/v1/rpc/${name}`, {
      method: 'POST', headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(args), signal: AbortSignal.timeout(12_000),
    });
    if (!response.ok) throw new Error(`DATABASE_RPC_${response.status}`);
    const body = await response.text();
    return body ? JSON.parse(body) : null;
  };
  let notifications: Notification[];
  try {
    await rpc('enqueue_due_reminders', {});
    notifications = await rpc('claim_notifications', { p_limit: 3 });
  }
  catch { return json({ error: 'QUEUE_UNAVAILABLE' }, 502); }
  let delivered = 0; let failed = 0; let skipped = 0; let acknowledgmentFailures = 0;
  // Separate messages protect customer/owner email privacy. Per-event/recipient keys
  // let retries safely skip the already accepted message when the second send failed.
  for (const notification of notifications) {
    try {
      if (notification.event_type === 'booking_reminder' && !await rpc('notification_is_current', { p_notification_id: notification.id })) {
        skipped++;
        continue;
      }
      const recipients = [{ email: notification.recipient_email, role: 'customer' }];
      const ownerEmail = notification.payload.owner_email;
      if (notification.event_type !== 'booking_reminder' && ownerEmail && ownerEmail.toLowerCase() !== notification.recipient_email.toLowerCase()) {
        recipients.push({ email: ownerEmail, role: 'owner' });
      }
      for (const recipient of recipients) {
        const content = emailContent(notification, recipient.role === 'owner');
        // Resend's default quota is two requests per second. Small sequential
        // batches also leave time for acknowledgments within the edge runtime.
        await new Promise(resolve => setTimeout(resolve, 550));
        const response = await fetch('https://api.resend.com/emails', {
          method: 'POST', headers: {
            Authorization: `Bearer ${resendKey}`, 'Content-Type': 'application/json',
            'Idempotency-Key': `booking-event-${notification.id}-${recipient.role}`,
          },
          body: JSON.stringify({ from, to: [recipient.email], ...content }),
          signal: AbortSignal.timeout(12_000),
        });
        const accepted = response.ok; const status = response.status;
        await response.body?.cancel();
        if (!accepted) throw new Error(`EMAIL_PROVIDER_${status}`);
      }
      await rpc('ack_notification', { p_notification_id: notification.id, p_delivered: true, p_error: null });
      delivered++;
    } catch (error) {
      failed++;
      // Only safe status codes are recorded: no provider response bodies, email addresses,
      // API keys, or customer messages get copied into logs or public responses.
      const message = error instanceof Error && /^(EMAIL_PROVIDER|DATABASE_RPC)_\d{3}$/.test(error.message)
        ? error.message : 'DELIVERY_FAILED';
      try { await rpc('ack_notification', { p_notification_id: notification.id, p_delivered: false, p_error: message }); }
      catch { acknowledgmentFailures++; }
    }
  }
  return json({ claimed: notifications.length, delivered, failed, skipped, acknowledgmentFailures });
}

if (import.meta.main) Deno.serve(handleRequest);
