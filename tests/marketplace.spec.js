import { test, expect } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  // Demo regression checks must never contact the deployed production project.
  await page.route('**/platform-config.js', route => route.fulfill({
    contentType: 'application/javascript',
    body: 'window.MERAKI_CONFIG={supabaseUrl:"",supabasePublishableKey:""};',
  }));
  await page.goto('/');
});

async function chooseHairService(page) {
  await page.getByRole('button', { name: 'Δείτε υπηρεσίες στο Atelier Hair Studio' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('button', { name: 'Συνέχεια', exact: true })).toBeDisabled();
  await dialog.getByRole('button', { name: /Κούρεμα & χτένισμα/ }).click();
  await dialog.getByRole('button', { name: 'Συνέχεια', exact: true }).click();
  return dialog;
}

async function chooseTime(page) {
  const dialog = await chooseHairService(page);
  await expect(dialog.getByRole('button', { name: 'Συνέχεια στην επιβεβαίωση' })).toBeDisabled();
  await dialog.getByRole('button', { name: /Ελένη Senior specialist/ }).click();
  await dialog.getByRole('button', { name: '09:00', exact: true }).click();
  await dialog.getByRole('button', { name: 'Συνέχεια στην επιβεβαίωση' }).click();
  return dialog;
}

async function expectSearchAboveResults(page) {
  await expect.poll(() => page.evaluate(() => {
    const bar = document.querySelector('.search-bar').getBoundingClientRect();
    const heading = document.querySelector('.recommendations-title').getBoundingClientRect();
    return bar.top >= 0 && bar.top <= 10 && bar.bottom <= innerHeight && heading.top >= bar.bottom;
  })).toBe(true);
}

test('service icon selection is preserved by city and date search', async ({ page }) => {
  const citySelect = page.getByLabel('Πόλη ή περιοχή');
  await expect(page.getByLabel('Επιλογή χώρας')).toHaveCount(0);
  expect(await citySelect.locator('optgroup').evaluateAll(groups => groups.map(group => ({
    country: group.label,
    cities: [...group.querySelectorAll('option')].map(option => option.textContent),
  })))).toEqual([
    { country: 'Κύπρος', cities: ['Λάρνακα', 'Λευκωσία', 'Λεμεσός', 'Πάφος', 'Παραλίμνι'] },
    { country: 'Ελλάδα', cities: ['Αθήνα', 'Θεσσαλονίκη'] },
  ]);
  const nailsCategory = page.getByRole('button', { name: 'Νύχια', exact: true });
  await nailsCategory.click();
  await expect(nailsCategory).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByLabel('Υπηρεσία', { exact: true })).toHaveCount(0);
  await citySelect.selectOption('Λευκωσία');
  const dateInput = page.getByLabel('Ημερομηνία ραντεβού');
  const selectedDate = await dateInput.getAttribute('min');
  await dateInput.fill(selectedDate);
  await page.getByRole('button', { name: 'Αναζήτηση', exact: true }).click();
  await expect(nailsCategory).toHaveAttribute('aria-pressed', 'true');
  await expect(dateInput).toHaveValue(selectedDate);
  await expect(page.locator('.salon-card')).toHaveCount(1);
  await expect(page.locator('.salon-card')).toContainText('Bare Nail Atelier');
  await expect(page.locator('.salon-card')).toContainText('Λευκωσία');
  await expectSearchAboveResults(page);
  await page.getByRole('button', { name: 'Καθαρισμός φίλτρων' }).click();
  await expect(page.locator('.salon-card')).toHaveCount(3);
  await citySelect.selectOption('Λάρνακα');
  await page.getByRole('button', { name: 'Αναζήτηση', exact: true }).click();
  await expect(page.locator('.salon-card')).toHaveCount(1);
  await expect(page.locator('.salon-card')).toContainText('Still Wellness House');
  await expect(page.locator('.salon-grid')).not.toContainText('Αθήνα');
  await citySelect.selectOption('Αθήνα');
  await page.getByRole('button', { name: 'Αναζήτηση', exact: true }).click();
  await expect(page.locator('.salon-card')).toHaveCount(2);
  await expect(page.locator('.salon-grid')).toContainText('Atelier Hair Studio');
  await expect(page.locator('.salon-grid')).toContainText('The Gentlemen’s Club');
  await expect(page.locator('.salon-grid')).not.toContainText('Still Wellness House');
  await expectSearchAboveResults(page);
  await citySelect.selectOption('Πάφος');
  await page.getByRole('button', { name: 'Αναζήτηση', exact: true }).click();
  await expect(page.locator('.salon-card')).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Δεν βρέθηκε ο ιδανικός συνδυασμός… ακόμα.' })).toBeVisible();
});

test('favorite survives reload and can be removed from favorites page', async ({ page }) => {
  await page.getByRole('button', { name: 'Προσθήκη στα αγαπημένα: Atelier Hair Studio' }).click();
  await page.reload();
  await expect(page.getByRole('button', { name: 'Αφαίρεση από αγαπημένα: Atelier Hair Studio' })).toHaveAttribute('aria-pressed', 'true');
  await page.locator('.desktop-nav').getByRole('button', { name: 'Αγαπημένα' }).click();
  await expect(page.locator('.salon-card')).toHaveCount(1);
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Τα αγαπημένα σας', exact: true })).toBeVisible();
  await expect(page.locator('.salon-card')).toHaveCount(1);
  await expect(page.locator('.salon-card')).toContainText('Atelier Hair Studio');
  await page.getByRole('button', { name: 'Αφαίρεση από αγαπημένα: Atelier Hair Studio' }).click();
  await expect(page.getByRole('heading', { name: 'Λίγη έμπνευση για τα αγαπημένα σας;' })).toBeVisible();
});

test('booking reserves selected service and time locally, prevents overlap, and supports cancellation', async ({ page }) => {
  const dialog = await chooseTime(page);
  await dialog.getByLabel('Όνομα', { exact: true }).fill('Δοκιμή Πελάτη');
  await dialog.getByLabel('Email', { exact: true }).fill('test@example.com');
  await dialog.getByRole('button', { name: /Επιβεβαίωση ραντεβού/ }).click();
  await expect(dialog.getByRole('heading', { name: /Η δοκιμαστική σας κράτηση.*αποθηκεύτηκε/ })).toBeVisible();
  await expect(dialog).toContainText('Δεν έχει ενημερωθεί πραγματικό κατάστημα');
  await dialog.getByRole('button', { name: 'Υπέροχα, ευχαριστώ' }).click();
  const secondDialog = await chooseHairService(page);
  await secondDialog.getByRole('button', { name: /Ελένη Senior specialist/ }).click();
  await expect(secondDialog.getByRole('button', { name: '09:00', exact: true })).toBeDisabled();
  await secondDialog.getByRole('button', { name: 'Κλείσιμο κράτησης' }).click();
  await page.locator('.desktop-nav').getByRole('button', { name: /Τα ραντεβού μου/ }).click();
  await expect(page.locator('.appointment-card')).toHaveCount(1);
  await expect(page.locator('.appointment-card')).toContainText('Κούρεμα & χτένισμα');
  await expect(page.locator('.appointment-card')).toContainText('09:00');
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Τα ραντεβού σας', exact: true })).toBeVisible();
  await expect(page.locator('.appointment-card')).toHaveCount(1);
  await page.getByRole('button', { name: 'Ακύρωση ραντεβού', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Ναι, ακύρωση' }).click();
  await expect(page.locator('.appointment-card')).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Το επόμενο ωραίο πράγμα στη μέρα σας.' })).toBeVisible();
});

test('checkout offers no real card or Apple Pay charge and keyboard can close modal', async ({ page }) => {
  const dialog = await chooseTime(page);
  await expect(dialog.getByRole('button', { name: /Πιστωτική ή χρεωστική κάρτα/ })).toBeDisabled();
  await expect(dialog.getByRole('button', { name: /Apple Pay/ })).toBeDisabled();
  await expect(dialog).toContainText('Πληρωμή στο κατάστημα');
  await expect(dialog.locator('input')).toHaveCount(2);
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
});

test('business calendar switches dates and creates and cancels demo appointments', async ({ page }) => {
  await page.locator('.header-actions').getByRole('button', { name: /Για επαγγελματίες/ }).click();
  await page.getByRole('button', { name: /Δείτε τη δοκιμαστική έκδοση/ }).click();
  await expect(page.getByRole('heading', { name: 'Ημερολόγιο', exact: true })).toBeVisible();
  await expect(page.locator('.biz-appointment')).toHaveCount(3);
  await page.getByRole('button', { name: 'Επόμενη εβδομάδα', exact: true }).click();
  await expect(page.locator('.biz-appointment')).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Μια ελεύθερη μέρα.' })).toBeVisible();
  await page.getByRole('button', { name: 'Σήμερα', exact: true }).click();
  await page.getByRole('button', { name: 'Νέο ραντεβού', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Ονοματεπώνυμο πελάτη').fill('Δοκιμαστικός Πελάτης');
  await dialog.getByLabel('Ώρα', { exact: true }).fill('16:00');
  await dialog.getByRole('button', { name: 'Προσθήκη ραντεβού', exact: true }).click();
  await expect(page.locator('.biz-appointment')).toHaveCount(4);
  await page.reload();
  await page.getByRole('button', { name: /Δείτε τη δοκιμαστική έκδοση/ }).click();
  await expect(page.locator('.biz-appointment')).toHaveCount(4);
  await page.locator('.biz-appointment').filter({ hasText: 'Δοκιμαστικός Πελάτης' }).click();
  await page.getByRole('button', { name: 'Ακύρωση δοκιμαστικού ραντεβού' }).click();
  await expect(page.locator('.biz-appointment')).toHaveCount(3);
  await page.reload();
  await page.getByRole('button', { name: /Δείτε τη δοκιμαστική έκδοση/ }).click();
  await expect(page.locator('.biz-appointment')).toHaveCount(3);
});

test('business calendar includes its own online bookings and excludes other salons', async ({ page }) => {
  await page.evaluate(() => {
    const date = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Athens' }).format(new Date());
    const common = { service: { name: 'Κούρεμα & χτένισμα', price: 35, duration: 60 }, staff: 'Αλέξανδρος', date, email: 'test@example.com', payment: 'venue', createdAt: new Date().toISOString() };
    localStorage.setItem('meraki-bookings', JSON.stringify([
      { ...common, id: 'scope-atelier', salonId: 'atelier-hair', salonName: 'Atelier Hair Studio', time: '16:00', name: 'Πελάτης Atelier' },
      { ...common, id: 'scope-other', salonId: 'bare-nail', salonName: 'Bare Nail Atelier', time: '17:00', name: 'Πελάτης Άλλου Χώρου' },
    ]));
  });
  await page.goto('/#business');
  await page.reload();
  await page.getByRole('button', { name: /Δείτε τη δοκιμαστική έκδοση/ }).click();
  await expect(page.locator('.biz-appointment')).toHaveCount(4);
  await expect(page.locator('.biz-timeline-events')).toContainText('Πελάτης Atelier');
  await expect(page.locator('.biz-timeline-events')).not.toContainText('Πελάτης Άλλου Χώρου');
});

test('business authentication does not imply a real login or retain credentials', async ({ page }) => {
  await page.goto('/#business');
  await page.getByLabel('Email', { exact: true }).fill('business@example.com');
  await page.getByLabel('Κωδικός πρόσβασης', { exact: true }).fill('notarealpassword');
  await page.getByRole('button', { name: 'Σύνδεση', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('δεν έχει ενεργοποιηθεί');
  await expect(page.getByLabel('Κωδικός πρόσβασης', { exact: true })).toHaveValue('');
  await expect(page.locator('.biz-dashboard')).toHaveCount(0);
});

test('mobile navigation and booking fit a narrow viewport', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator('.bottom-nav')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.locator('.bottom-nav').getByRole('button', { name: 'Αγαπημένα' }).click();
  await expect(page.getByRole('heading', { name: 'Τα αγαπημένα σας', exact: true })).toBeVisible();
  await page.locator('.bottom-nav').getByRole('button', { name: 'Εξερεύνηση' }).click();
  const dialog = await chooseTime(page);
  await expect(dialog.getByRole('heading', { name: 'Λίγο πριν την ομορφιά.' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await dialog.getByRole('button', { name: 'Κλείσιμο κράτησης' }).click();
  await page.getByRole('button', { name: 'Μενού', exact: true }).click();
  await page.locator('.mobile-menu-panel').getByRole('button', { name: /Για επαγγελματίες/ }).click();
  await page.getByRole('button', { name: /Δείτε τη δοκιμαστική έκδοση/ }).click();
  await expect(page.getByRole('heading', { name: 'Ημερολόγιο', exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test('mobile results show editable search controls after searching without floating while scrolling', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole('button', { name: 'Αναζήτηση', exact: true }).locator('span')).toBeVisible();
  await page.getByRole('button', { name: 'Νύχια', exact: true }).click();
  await page.getByLabel('Πόλη ή περιοχή').selectOption('Λευκωσία');
  const dateInput = page.getByLabel('Ημερομηνία ραντεβού');
  const firstDate = await dateInput.getAttribute('min');
  await dateInput.fill(firstDate);
  await page.getByRole('button', { name: 'Αναζήτηση', exact: true }).click();
  await expectSearchAboveResults(page);
  await expect(page.locator('.salon-card')).toHaveCount(1);

  const next = new Date(`${firstDate}T12:00:00Z`);
  next.setUTCDate(next.getUTCDate() + 2);
  const changedDate = next.toISOString().slice(0, 10);
  await dateInput.fill(changedDate);
  await page.getByRole('button', { name: 'Αναζήτηση', exact: true }).click();
  await expectSearchAboveResults(page);
  await expect(dateInput).toHaveValue(changedDate);
  await expect(page.getByRole('button', { name: 'Νύχια', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('.salon-card')).toContainText('Bare Nail Atelier');
  await expect(page.locator('.search-section')).toHaveCount(1);
  await expect(page.getByLabel('Πόλη ή περιοχή')).toHaveCount(1);
  await expect(dateInput).toHaveCount(1);

  await page.getByRole('button', { name: 'Δείτε υπηρεσίες στο Bare Nail Atelier' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('button', { name: /Ημιμόνιμο μανικιούρ/ }).click();
  await dialog.getByRole('button', { name: 'Συνέχεια', exact: true }).click();
  const expectedDay = new Date(`${changedDate}T12:00:00Z`).toLocaleDateString('el-GR', { timeZone: 'Europe/Nicosia', weekday: 'long', day: 'numeric', month: 'long' });
  await expect(dialog.locator('.booking-days .is-selected')).toHaveAttribute('aria-label', expectedDay);
  await dialog.getByRole('button', { name: 'Κλείσιμο κράτησης' }).click();

  const resultScrollY = await page.evaluate(() => scrollY);
  await expect(page.locator('.search-section')).toHaveCSS('position', 'static');
  await page.evaluate(() => scrollBy({ top: 350, behavior: 'instant' }));
  await expect.poll(() => page.evaluate(() => scrollY)).toBeGreaterThan(resultScrollY + 200);
  await expect.poll(() => page.locator('.search-bar').evaluate(element => element.getBoundingClientRect().bottom)).toBeLessThan(0);
});
