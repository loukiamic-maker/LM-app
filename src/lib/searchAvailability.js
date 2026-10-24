import { getSlots, platformError } from './platform';

// A worker checks one salon at a time, trying its services serially. Four workers
// therefore cap the total number of simultaneous availability RPCs at four.
// Cancelled results must be ignored by the caller; outstanding RPCs may still
// settle, but cancellation prevents any subsequent requests from being started.
export async function findAvailableSalonIds(salons, date, shouldContinue = () => true) {
  const candidates = salons.filter(salon => salon?.id && !salon.isDemo);
  const availableIds = new Set();
  let nextIndex = 0;
  let stopped = false;
  let failure = null;

  const canContinue = () => {
    if (stopped) return false;
    if (!shouldContinue()) {
      stopped = true;
      return false;
    }
    return true;
  };

  async function worker() {
    while (canContinue()) {
      const salon = candidates[nextIndex++];
      if (!salon) return;

      for (const service of salon.services || []) {
        if (!service?.id || service.active === false) continue;
        if (!canContinue()) return;

        let slots;
        try {
          slots = await getSlots(service.id, date);
        } catch (error) {
          failure ||= error?.userMessage ? error : platformError(error);
          stopped = true;
          return;
        }

        if (!canContinue()) return;
        if (slots.length > 0) {
          availableIds.add(salon.id);
          break;
        }
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(4, candidates.length) }, worker));
  if (failure) throw failure;
  return availableIds;
}
