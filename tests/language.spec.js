import { test, expect } from '@playwright/test';
import { mockLanguagePlatform, salon, ids, today } from './fixtures/language-platform';

// Local HTTP fixtures only. No hosted accounts, bookings, messages or charges.
const futureDate = () => { const date = new Date(); date.setUTCDate(date.getUTCDate()+7); return date.toISOString().slice(0,10); };
const languagePicker = scope => scope.locator('.language-selector select').first();
async function noOverflow(page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `No horizontal overflow at ${page.url()} (${page.viewportSize().width}px)`).toBe(true);
}
async function signIn(page) {
  await page.goto('/');
  await page.getByRole('button', { name: 'My profile', exact: true }).click();
  const panel = page.locator('.account-panel');
  await panel.getByLabel('Email', { exact: true }).fill('owner@example.test');
  await panel.getByLabel('Password', { exact: true }).fill('isolated-password-123');
  await panel.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(panel.getByRole('heading', { name: 'Your profile', exact: true })).toBeVisible();
  await panel.getByRole('button', { name: /^Close account/ }).click();
}
async function publicDemo(page) {
  await page.route('**/platform-config*.js', route => route.fulfill({ contentType:'application/javascript',body:'window.MERAKI_CONFIG={supabaseUrl:"",supabasePublishableKey:""};' }));
  await page.goto('/');
}

test('English is the default, city groups are translated and Greek stays selected after reload and navigation', async ({ page }) => {
  await publicDemo(page);
  await expect(page.locator('html')).toHaveAttribute('lang','en');
  await expect(languagePicker(page)).toHaveValue('en');
  await expect(page.getByRole('heading', { name:'Which service do you need today?',exact:true })).toBeVisible();
  await page.getByRole('button', { name:'Hair',exact:true }).click();
  await expect(page.getByRole('button', { name:'Hair',exact:true })).toHaveAttribute('aria-pressed','true');
  await page.getByRole('combobox', { name:'City or area',exact:true }).click();
  await expect(page.getByRole('group', { name:'Cyprus',exact:true })).toBeVisible();
  await expect(page.getByRole('group', { name:'Greece',exact:true })).toBeVisible();
  await page.getByRole('option', { name:'Athens',exact:true }).click();
  await expect(page.getByRole('combobox', { name:'City or area',exact:true })).toContainText('Athens');
  await languagePicker(page).selectOption('el');
  await expect(page.locator('html')).toHaveAttribute('lang','el');
  await expect(page.getByRole('heading', { name:'Τι υπηρεσία χρειάζεστε σήμερα;',exact:true })).toBeVisible();
  await expect(page.getByRole('button', { name:'Μαλλιά',exact:true })).toHaveAttribute('aria-pressed','true');
  await expect(page.getByRole('combobox', { name:'Πόλη ή περιοχή',exact:true })).toContainText('Αθήνα');
  await page.reload();
  await expect(languagePicker(page)).toHaveValue('el');
  expect(await page.evaluate(() => localStorage.getItem('eneres-language'))).toBe('el');
  await page.goto('/#favorites');
  await expect(page.getByRole('heading', { name:'Τα αγαπημένα σας',exact:true })).toBeVisible();
  await expect(languagePicker(page)).toHaveValue('el');
});

test('customer and business videos, captions and posters follow the selected language', async ({ page }) => {
  await publicDemo(page);
  for (const audience of ['client','business']) {
    await page.goto(`/#guide-${audience}`);
    for (const language of ['en','el']) {
      await languagePicker(page).selectOption(language);
      const video = page.locator('.evg-video');
      await expect(video.locator('source')).toHaveAttribute('src',new RegExp(`eneres-${audience}-guide-${language}\\.mp4$`));
      await expect(video).toHaveAttribute('poster',new RegExp(`eneres-${audience}-guide-${language}\\.jpg$`));
      await expect(video.locator('track')).toHaveAttribute('srclang',language);
      for (const attribute of [await video.locator('source').getAttribute('src'),await video.getAttribute('poster'),await video.locator('track').getAttribute('src')]) {
        const response=await page.request.get(attribute);
        expect(response.status()).toBe(200);
        expect(Number(response.headers()['content-length'])).toBeGreaterThan(0);
      }
      await video.evaluate(element=>element.load());
      await expect.poll(()=>video.evaluate(element=>({ready:element.readyState>0,error:element.error?.code||null}))).toEqual({ready:true,error:null});
    }
  }
});

test('the top-right language choice is available on customer, business, administrator and guide pages at narrow widths', async ({ page }) => {
  test.setTimeout(60000);
  const state = await mockLanguagePlatform(page);
  const routes = ['', '#favorites', '#bookings', '#business', '#admin', '#guide-client', '#guide-business'];
  for (const width of [320,390,1440]) {
    await page.setViewportSize({ width,height:1000 });
    for (const hash of routes) {
      await page.goto(`/${hash}`);
      await expect(languagePicker(page)).toBeVisible();
      await expect(languagePicker(page)).toHaveValue('en');
      await noOverflow(page);
    }
  }
  expect(state.unexpected).toEqual([]);
});

test('profile fields and country codes switch language while retaining the saved account number', async ({ page }) => {
  const state = await mockLanguagePlatform(page);
  await signIn(page);
  await page.getByRole('button',{name:'My profile',exact:true}).click();
  const panel = page.locator('.account-panel');
  await expect(panel.getByLabel('Name',{exact:true})).toHaveValue('Λουκία Δοκιμή');
  await expect(panel.getByRole('combobox',{name:'Country code',exact:true})).toHaveValue('CY');
  await expect(panel.getByRole('option',{name:'Cyprus +357',exact:true})).toHaveCount(1);
  await expect(panel.getByLabel('Mobile number',{exact:true})).toHaveValue('99123456');
  await languagePicker(panel).selectOption('el');
  await expect(panel.getByLabel('Όνομα',{exact:true})).toHaveValue('Λουκία Δοκιμή');
  await expect(panel.getByRole('combobox',{name:'Κωδικός χώρας',exact:true})).toHaveValue('CY');
  await expect(panel.getByRole('option',{name:'Κύπρος +357',exact:true})).toHaveCount(1);
  await expect(panel.getByLabel('Αριθμός κινητού',{exact:true})).toHaveValue('99123456');
  for(const width of [320,390,1440]) { await page.setViewportSize({width,height:1000}); await noOverflow(page); }
  expect(state.calls.some(call => call.path==='/rest/v1/profiles'&&call.method!=='GET')).toBe(false);
  expect(state.unexpected).toEqual([]);
});

test('checkout language changes preserve selected appointment, notes and the automatically retrieved phone', async ({ page }) => {
  const state = await mockLanguagePlatform(page);
  await signIn(page);
  await page.getByRole('button',{name:`View services at ${salon.name}`,exact:true}).click();
  const dialog = page.locator('.booking-live');
  await expect(dialog.locator('.booking-salon-line')).toHaveText('Σόλωνος 15, Athens, Greece');
  await dialog.getByRole('button',{name:new RegExp(salon.services[0].name)}).click();
  await dialog.getByRole('button',{name:'Continue',exact:true}).click();
  await dialog.getByRole('button',{name:new RegExp(salon.staff[0].name)}).click();
  await dialog.getByLabel('Appointment date',{exact:true}).fill(futureDate());
  await dialog.getByRole('button',{name:`10:00 · ${salon.staff[0].name}`,exact:true}).click();
  await dialog.getByRole('button',{name:/Continue to confirmation/}).click();
  await expect(dialog.getByRole('heading',{name:'Booking details',exact:true})).toBeVisible();
  await expect(dialog.locator('input[type=tel]')).toHaveCount(0);
  await expect(dialog.locator('.booking-live-account-phone')).toContainText('+35799123456');
  const notes='Σημείωση πελάτη — keep exactly as entered';
  await dialog.getByRole('textbox',{name:'Notes for the business (optional)',exact:true}).fill(notes);
  await dialog.getByRole('checkbox').check();
  await languagePicker(dialog).selectOption('el');
  await expect(dialog.getByRole('heading',{name:'Τα στοιχεία της κράτησης',exact:true})).toBeVisible();
  await expect(dialog.getByRole('textbox',{name:'Σημειώσεις για την επιχείρηση (προαιρετικό)',exact:true})).toHaveValue(notes);
  await expect(dialog.getByRole('checkbox')).toBeChecked();
  await languagePicker(dialog).selectOption('en');
  await dialog.getByRole('button',{name:'Change in profile',exact:true}).click();
  await expect(page.locator('.account-panel').getByRole('combobox',{name:'Country code',exact:true})).toHaveValue('CY');
  await page.locator('.account-panel').getByRole('button',{name:/^Close account/}).click();
  await expect(dialog.getByRole('textbox',{name:'Notes for the business (optional)',exact:true})).toHaveValue(notes);
  for(const width of [320,390,1440]) { await page.setViewportSize({width,height:1000}); await noOverflow(page); }
  await dialog.getByRole('button',{name:/Confirm appointment/}).click();
  await expect(dialog.getByRole('heading',{name:/Your appointment.*is confirmed/})).toBeVisible();
  const sent=state.calls.find(call=>call.path.endsWith('/create_booking_with_contact')).body;
  expect(sent).toMatchObject({p_customer_phone:'+35799123456',p_notes:notes,p_service_id:ids.service,p_staff_id:ids.staff});
  expect(state.unexpected).toEqual([]);
});

test('business manual booking fields are translated and internal city and booking values remain unchanged', async ({ page }) => {
  const state = await mockLanguagePlatform(page);
  await signIn(page);
  await page.goto('/#business');
  await expect(page.getByRole('heading',{name:'Your calendar',exact:true})).toBeVisible();
  await page.getByRole('button',{name:'New appointment',exact:true}).click();
  const manual=page.getByRole('dialog',{name:'New manual appointment',exact:true});
  for(const name of ['Customer name','Customer phone','Date','Time','Price (€)']) await expect(manual.getByLabel(name,{exact:true})).toHaveAttribute('required','');
  await expect(manual.getByRole('combobox',{name:'Service',exact:true})).toHaveValue(ids.service);
  await expect(manual.getByRole('combobox',{name:'Professional',exact:true})).toHaveValue(ids.staff);
  await manual.getByLabel('Customer name',{exact:true}).fill('Πελάτης Μη Αλλαγής');
  await manual.getByLabel('Customer phone',{exact:true}).fill('99123456');
  await manual.getByLabel('Date',{exact:true}).fill(today());
  await manual.getByLabel('Time',{exact:true}).fill('14:00');
  await manual.getByLabel('Price (€)',{exact:true}).fill('35.50');
  for(const width of [320,390,1440]) { await page.setViewportSize({width,height:1000}); await noOverflow(page); }
  await manual.getByRole('button',{name:'Add appointment',exact:true}).click();
  await expect(manual).toHaveCount(0);
  expect(state.calls.find(call=>call.path.endsWith('/create_manual_booking')).body).toMatchObject({p_customer_name:'Πελάτης Μη Αλλαγής',p_customer_phone:'99123456',p_service_id:ids.service,p_staff_id:ids.staff,p_price_cents:3550});
  await page.locator('.lb-booking-row').filter({hasText:'Πελάτης Μη Αλλαγής'}).click();
  const detail=page.getByRole('dialog');
  await expect(detail).toContainText('€35.50');
  await detail.getByRole('button',{name:'Close',exact:true}).click();
  await page.getByRole('button',{name:'Add business',exact:true}).click();
  const business=page.getByRole('dialog',{name:'New business',exact:true});
  await business.getByRole('combobox',{name:'Country',exact:true}).selectOption('Κύπρος');
  await expect(business.getByRole('option',{name:'Larnaca',exact:true})).toHaveAttribute('value','Λάρνακα');
  await business.getByRole('combobox',{name:'City',exact:true}).selectOption('Λάρνακα');
  await expect(business.getByRole('combobox',{name:'City',exact:true})).toHaveValue('Λάρνακα');
  await business.getByLabel('Business name',{exact:true}).fill('User business name unchanged');
  await business.getByLabel('Address',{exact:true}).fill('User address 20');
  await business.getByRole('button',{name:'Create business draft',exact:true}).click();
  expect(state.calls.find(call=>call.path.endsWith('/create_salon')).body).toMatchObject({p_country:'Κύπρος',p_city:'Λάρνακα',p_name:'User business name unchanged'});
  expect(state.unexpected).toEqual([]);
});

test('administrator statistics, billing and review controls translate and retain the selected section', async ({ page }) => {
  const state=await mockLanguagePlatform(page,{admin:true});
  await signIn(page);
  await page.goto('/#admin');
  const tabs=page.getByRole('navigation',{name:'Administration sections',exact:true});
  await expect(tabs.getByRole('button',{name:'Overview',exact:true})).toBeVisible();
  await expect(page.getByRole('combobox',{name:'Statistics period',exact:true})).toBeVisible();
  await tabs.getByRole('button',{name:/Business requests/}).click();
  await expect(page.getByRole('heading',{name:'Businesses',exact:true})).toBeVisible();
  await expect(page.getByRole('combobox',{name:'Business status',exact:true})).toBeVisible();
  await tabs.getByRole('button',{name:'Monthly subscriptions',exact:true}).click();
  await expect(page.getByRole('heading',{name:'Platform subscription price',exact:true})).toBeVisible();
  await expect(page.getByLabel('Monthly subscription (€)',{exact:true})).toBeVisible();
  await languagePicker(page).selectOption('el');
  await expect(page.getByRole('heading',{name:'Τιμή χρήσης της πλατφόρμας',exact:true})).toBeVisible();
  await expect(page.getByLabel('Μηνιαία συνδρομή (€)',{exact:true})).toBeVisible();
  await languagePicker(page).selectOption('en');
  for(const width of [320,390,1440]) { await page.setViewportSize({width,height:1000}); await noOverflow(page); }
  expect(state.calls.some(call=>call.path.endsWith('/admin_set_platform_billing'))).toBe(false);
  expect(state.unexpected).toEqual([]);
});
