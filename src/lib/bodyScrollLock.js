// Shared ownership prevents nested dialogs from restoring another dialog's lock.
const locks = new Set();
let previousOverflow = '';
export function lockBodyScroll() {
  const token = {};
  if (!locks.size) previousOverflow = document.body.style.overflow;
  locks.add(token);
  document.body.style.overflow = 'hidden';
  return () => {
    if (!locks.delete(token)) return;
    if (!locks.size) document.body.style.overflow = previousOverflow;
  };
}
