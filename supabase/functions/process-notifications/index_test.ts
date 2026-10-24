import { emailContent, handleRequest } from './index.ts';

const secret = 'test-only-worker-secret-not-a-real-credential';
const notification = {
  id: '60000000-0000-0000-0000-000000000001',
  event_type: 'booking_confirmed' as const,
  recipient_email: 'customer@example.test',
  payload: {
    booking_id: '70000000-0000-0000-0000-000000000001', customer_name: 'Μαρία <script>alert(1)</script>',
    salon_name: 'Example Salon', salon_address: 'Οδός 1', salon_city: 'Αθήνα',
    timezone: 'Europe/Athens', owner_email: 'owner@example.test', service_name: 'Κούρεμα',
    staff_name: 'Άννα', starts_at: '2026-12-01T10:00:00Z', ends_at: '2026-12-01T11:00:00Z',
    price_cents: 3500, cancellation_hours: 24,
  },
};
function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}
const envNames = ['NOTIFICATION_WORKER_SECRET','SUPABASE_URL','SUPABASE_SERVICE_ROLE_KEY','RESEND_API_KEY','NOTIFICATION_FROM'];
function setupEnv() {
  const previous = new Map(envNames.map(name => [name,Deno.env.get(name)]));
  Deno.env.set('NOTIFICATION_WORKER_SECRET',secret);
  Deno.env.set('SUPABASE_URL','https://database.example.test');
  Deno.env.set('SUPABASE_SERVICE_ROLE_KEY','test-only-service-key');
  Deno.env.set('RESEND_API_KEY','test-only-mail-key');
  Deno.env.set('NOTIFICATION_FROM','Example <appointments@example.test>');
  return () => { for (const [name,value] of previous) { if (value === undefined) Deno.env.delete(name); else Deno.env.set(name,value); } };
}
const request = () => new Request('https://worker.example.test', { method: 'POST', headers: { Authorization: `Bearer ${secret}` } });

Deno.test('worker rejects anonymous, wrong-secret and non-POST requests before touching queue',async () => {
  const restore = setupEnv(); const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = (() => { calls++; throw new Error('Must not call network'); }) as typeof fetch;
  try {
    assert((await handleRequest(new Request('https://worker.example.test'))).status === 405,'GET must fail');
    assert((await handleRequest(new Request('https://worker.example.test',{method:'POST'}))).status === 401,'Anonymous must fail');
    assert((await handleRequest(new Request('https://worker.example.test',{method:'POST',headers:{Authorization:'Bearer wrong'}}))).status === 401,'Wrong secret must fail');
    assert(calls === 0,'Unauthorized calls must not claim mail');
    Deno.env.delete('NOTIFICATION_WORKER_SECRET');
    assert((await handleRequest(request())).status === 503,'Missing worker secret must fail closed');
  } finally { globalThis.fetch=originalFetch; restore(); }
});

Deno.test('email rendering escapes user text and shows Greek pay-at-salon details', () => {
  const content=emailContent(notification,false);
  assert(!content.html.includes('<script>'),'HTML injection must be escaped');
  assert(content.html.includes('&lt;script&gt;'),'Escaped customer name must be preserved');
  assert(content.text.includes('35,00'),'Amount must use euro cents and Greek formatting');
  assert(content.text.includes('Δεν έχει γίνει ηλεκτρονική χρέωση'),'Must explain venue payment');
  assert(content.text.includes('12:00'),'Appointment must render in Athens timezone');
});

Deno.test('worker sends private customer/owner messages with distinct stable idempotency keys',async () => {
  const restore=setupEnv(); const originalFetch=globalThis.fetch;
  const sends: {body:Record<string,unknown>;key:string|null}[]=[]; const acknowledgments:Record<string,unknown>[]=[];
  globalThis.fetch=(async (input:RequestInfo|URL,init?:RequestInit) => {
    const url=String(input); const body=JSON.parse(String(init?.body));
    if(url.endsWith('/enqueue_due_reminders')) return Response.json(0);
    if(url.endsWith('/claim_notifications')) return Response.json([notification]);
    if(url==='https://api.resend.com/emails') {
      sends.push({body,key:new Headers(init?.headers).get('Idempotency-Key')});
      return Response.json({id:'provider-message-id'});
    }
    if(url.endsWith('/ack_notification')) { acknowledgments.push(body); return new Response(null,{status:204}); }
    throw new Error('Unexpected endpoint');
  }) as typeof fetch;
  try {
    const result=await handleRequest(request()); const body=await result.json();
    assert(result.status===200&&body.delivered===1&&body.failed===0,'Event should be delivered');
    assert(sends.length===2,'Must notify customer and business');
    assert(JSON.stringify(sends[0].body.to)===JSON.stringify(['customer@example.test']),'Customer message must have only customer recipient');
    assert(JSON.stringify(sends[1].body.to)===JSON.stringify(['owner@example.test']),'Owner message must have only owner recipient');
    assert(!('cc' in sends[0].body)&&!('bcc' in sends[0].body),'Must not share recipient lists');
    assert(sends[0].key===`booking-event-${notification.id}-customer`,'Customer idempotency key must be stable');
    assert(sends[1].key===`booking-event-${notification.id}-owner`,'Owner must use separate idempotency key');
    assert(acknowledgments.length===1&&acknowledgments[0].p_delivered===true,'Only fully delivered event is acknowledged');
    assert(!JSON.stringify(body).includes('@'),'Worker response must not disclose customer/owner emails');
  } finally { globalThis.fetch=originalFetch; restore(); }
});

Deno.test('provider failure is safely retried without logging private response bodies',async () => {
  const restore=setupEnv(); const originalFetch=globalThis.fetch;
  let ack:Record<string,unknown>|undefined;
  globalThis.fetch=(async (input:RequestInfo|URL,init?:RequestInit) => {
    const url=String(input);
    if(url.endsWith('/enqueue_due_reminders')) return Response.json(0);
    if(url.endsWith('/claim_notifications')) return Response.json([notification]);
    if(url==='https://api.resend.com/emails') return new Response('private provider diagnostics',{status:429});
    if(url.endsWith('/ack_notification')) { ack=JSON.parse(String(init?.body)); return new Response(null,{status:204}); }
    throw new Error('Unexpected endpoint');
  }) as typeof fetch;
  try {
    const response=await handleRequest(request()); const body=await response.json();
    assert(body.failed===1&&body.delivered===0,'Provider failure must not report delivery');
    assert(ack?.p_delivered===false&&ack?.p_error==='EMAIL_PROVIDER_429','Queue failure stores only safe status');
    assert(!JSON.stringify(body).includes('private provider'),'Public worker response must not expose provider diagnostics');
  } finally { globalThis.fetch=originalFetch; restore(); }
});

Deno.test('missing email configuration leaves queue untouched',async () => {
  const restore=setupEnv(); const originalFetch=globalThis.fetch; let calls=0;
  globalThis.fetch=(() => { calls++; throw new Error('Must not call network'); }) as typeof fetch;
  try {
    Deno.env.delete('RESEND_API_KEY');
    assert((await handleRequest(request())).status===503,'Unconfigured email must not look delivered');
    assert(calls===0,'Do not claim notifications without a usable provider configuration');
  } finally { globalThis.fetch=originalFetch; restore(); }
});


Deno.test('reminders are enqueued before claiming and sent only to the customer',async () => {
  const restore=setupEnv(); const originalFetch=globalThis.fetch;
  const calls:string[]=[]; const sends:Record<string,unknown>[]=[];
  const reminder={...notification,event_type:'booking_reminder'};
  globalThis.fetch=(async (input:RequestInfo|URL,init?:RequestInit) => {
    const url=String(input); calls.push(url);
    if(url.endsWith('/enqueue_due_reminders')) return Response.json(1);
    if(url.endsWith('/claim_notifications')) return Response.json([reminder]);
    if(url.endsWith('/notification_is_current')) return Response.json(true);
    if(url==='https://api.resend.com/emails') { sends.push(JSON.parse(String(init?.body))); return Response.json({id:'reminder-message'}); }
    if(url.endsWith('/ack_notification')) return new Response(null,{status:204});
    throw new Error('Unexpected endpoint');
  }) as typeof fetch;
  try {
    const response=await handleRequest(request()); const body=await response.json();
    assert(body.delivered===1,'Current reminder must be delivered');
    assert(calls[0].endsWith('/enqueue_due_reminders')&&calls[1].endsWith('/claim_notifications'),'Due reminders must be enqueued before claims');
    assert(sends.length===1&&JSON.stringify(sends[0].to)===JSON.stringify(['customer@example.test']),'Reminder goes only to customer');
    assert(String(sends[0].subject).includes('Υπενθύμιση'),'Reminder has Greek reminder subject');
  } finally { globalThis.fetch=originalFetch; restore(); }
});

Deno.test('cancelled or rescheduled reminder is skipped before any provider send',async () => {
  const restore=setupEnv(); const originalFetch=globalThis.fetch; let sends=0;
  globalThis.fetch=(async (input:RequestInfo|URL) => {
    const url=String(input);
    if(url.endsWith('/enqueue_due_reminders')) return Response.json(0);
    if(url.endsWith('/claim_notifications')) return Response.json([{...notification,event_type:'booking_reminder'}]);
    if(url.endsWith('/notification_is_current')) return Response.json(false);
    if(url==='https://api.resend.com/emails') { sends++; return Response.json({id:'must-not-send'}); }
    throw new Error('Unexpected endpoint');
  }) as typeof fetch;
  try {
    const body=await (await handleRequest(request())).json();
    assert(body.skipped===1&&body.delivered===0&&sends===0,'Stale reminder must not send or claim delivery');
  } finally { globalThis.fetch=originalFetch; restore(); }
});
