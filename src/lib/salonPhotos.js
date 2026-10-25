import { platformError, supabase, updateSalon } from './platform';

export const SALON_PHOTO_BUCKET = 'salon-photos';
export const SALON_PHOTO_LIMIT = 5 * 1024 * 1024;
const extensions = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };

function photoError(message) {
  return Object.assign(new Error(message), { userMessage: message });
}

function signatureMatches(type, bytes) {
  if (type === 'image/jpeg') return bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  if (type === 'image/png') return [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((value, index) => bytes[index] === value);
  if (type === 'image/webp') return String.fromCharCode(...bytes.slice(0, 4)) === 'RIFF' && String.fromCharCode(...bytes.slice(8, 12)) === 'WEBP';
  return false;
}

export async function validateSalonPhoto(file) {
  if (!(file instanceof File) || !extensions[file.type]) throw photoError('Επιλέξτε φωτογραφία JPG, PNG ή WebP');
  if (!file.size || file.size > SALON_PHOTO_LIMIT) throw photoError('Η φωτογραφία πρέπει να είναι έως 5 MB');
  const header = new Uint8Array(await file.slice(0, 12).arrayBuffer());
  if (!signatureMatches(file.type, header)) throw photoError('Το αρχείο δεν είναι έγκυρη φωτογραφία JPG, PNG ή WebP');
  const url = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    if (!image.naturalWidth || !image.naturalHeight) throw new Error('Empty image');
  } catch {
    throw photoError('Η φωτογραφία δεν μπορεί να ανοίξει. Επιλέξτε άλλο αρχείο');
  } finally {
    URL.revokeObjectURL(url);
  }
  return file;
}

function storageError(error) {
  const message = String(error?.message || '');
  if (/bucket.*not found|bucket.*does not exist|not found.*bucket/i.test(message)) {
    return photoError('Η μεταφόρτωση φωτογραφιών χρειάζεται την ενημέρωση αποθήκευσης από τον διαχειριστή');
  }
  if (/payload|size|too large|exceeded/i.test(message)) return photoError('Η φωτογραφία πρέπει να είναι έως 5 MB');
  if (/mime|content.type|unsupported/i.test(message)) return photoError('Επιλέξτε φωτογραφία JPG, PNG ή WebP');
  const normalized = platformError(error);
  if (!normalized.userMessage || /^Η ενέργεια δεν ολοκληρώθηκε\.? Προσπαθήστε ξανά$/.test(normalized.userMessage)) {
    normalized.userMessage = 'Η φωτογραφία δεν μεταφορτώθηκε. Δοκιμάστε ξανά';
  }
  return normalized;
}

// Upload a new object first. A failed request must never overwrite the currently
// published photo or delete an object after an uncertain database response.
export async function saveSalonWithPhoto(salon, patch, file) {
  if (!file) return updateSalon(salon.id, patch);
  if (!supabase) throw photoError('Η υπηρεσία φωτογραφιών δεν έχει συνδεθεί');
  await validateSalonPhoto(file);
  const { data: { user }, error: accountError } = await supabase.auth.getUser();
  if (accountError) throw platformError(accountError);
  if (!user?.id || !user.email_confirmed_at || salon.ownerId !== user.id) {
    throw photoError('Συνδεθείτε με τον επιβεβαιωμένο λογαριασμό της επιχείρησης');
  }
  const path = `${salon.id}/${crypto.randomUUID()}.${extensions[file.type]}`;
  const storage = supabase.storage.from(SALON_PHOTO_BUCKET);
  const { error: uploadError } = await storage.upload(path, file, {
    contentType: file.type, cacheControl: '3600', upsert: false,
  });
  if (uploadError) throw storageError(uploadError);
  const { data } = storage.getPublicUrl(path);
  const imageUrl = data?.publicUrl;
  if (!imageUrl?.startsWith('https://')) throw photoError('Δεν λάβαμε σύνδεσμο για τη φωτογραφία. Δοκιμάστε ξανά');
  // Retain the new object on every database failure. A timed-out PATCH can
  // still commit later, even after a follow-up read shows the old image.
  // An administrator can review unreferenced objects separately, without
  // risking a currently published photo during an uncertain browser request.
  return updateSalon(salon.id, { ...patch, imageUrl });
}
