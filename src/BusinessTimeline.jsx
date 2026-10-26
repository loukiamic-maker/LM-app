import { CalendarDays, Clock3, Plus } from 'lucide-react';
import './business-timeline.css';

const minuteOfDay = (value, timezone) => {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: timezone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(value));
  return Number(parts.find(part => part.type === 'hour').value) * 60 + Number(parts.find(part => part.type === 'minute').value);
};
const dayOf = (value, timezone) => new Intl.DateTimeFormat('en-CA', { timeZone: timezone }).format(new Date(value));
const clock = minute => `${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`;
const minutes = value => Number(String(value).slice(0, 2)) * 60 + Number(String(value).slice(3, 5));
const changeDay = (date, amount) => { const day = new Date(`${date}T12:00:00Z`); day.setUTCDate(day.getUTCDate() + amount); return day.toISOString().slice(0, 10); };
const bounds = (starts, ends, date, timezone) => ({
  start: dayOf(starts, timezone) < date ? 0 : minuteOfDay(starts, timezone),
  end: dayOf(ends, timezone) > date ? 1440 : minuteOfDay(ends, timezone),
});
const labels = { confirmed: 'Επιβεβαιωμένο', completed: 'Ολοκληρωμένο', no_show: 'Δεν προσήλθε' };

// Short appointments still need a usable button. Place visually overlapping
// buttons beside one another while keeping their actual start times unchanged.
function positionBookings(events) {
  const positioned = [];
  let group = [], groupEnd = -1;
  const finish = () => {
    const tracks = [];
    const entries = group.map(event => {
      const visibleHeight = Math.max(22, event.end - event.start - 3);
      let track = tracks.findIndex(end => end <= event.start);
      if (track < 0) track = tracks.length;
      tracks[track] = event.start + visibleHeight;
      return { ...event, visibleHeight, track };
    });
    entries.forEach(event => positioned.push({ ...event, trackCount: tracks.length }));
    group = [];
  };
  [...events].sort((a, b) => a.start - b.start || a.end - b.end).forEach(event => {
    if (group.length && event.start >= groupEnd) finish();
    if (!group.length) groupEnd = event.start;
    group.push(event);
    groupEnd = Math.max(groupEnd, event.start + Math.max(22, event.end - event.start - 3));
  });
  finish();
  return positioned;
}

export default function BusinessTimeline({ salon, date, timezone, bookings, onDateChange, onSelectBooking, onCreate, disabled = false }) {
  const events = bookings.filter(booking => booking.status !== 'cancelled').map(booking => ({ ...booking, ...bounds(booking.startsAt, booking.endsAt, date, timezone) }));
  const bookedStaff = new Set(events.map(booking => booking.staffId));
  const columns = salon.staff.filter(member => member.active || bookedStaff.has(member.id));
  const members = columns.length ? columns : [{ id: '', name: 'Η ομάδα σας' }];
  const weekday = new Date(`${date}T12:00:00Z`).getUTCDay();
  const hours = salon.hours.filter(entry => Number(entry.weekday) === weekday);
  const start = Math.max(0, Math.floor(Math.min(540, ...hours.map(entry => minutes(entry.opens_at)), ...events.map(entry => entry.start)) / 60) * 60);
  const end = Math.min(1440, Math.ceil(Math.max(1080, ...hours.map(entry => minutes(entry.closes_at)), ...events.map(entry => entry.end)) / 60) * 60);
  const height = end - start;
  const gridStyle = { gridTemplateColumns: `44px repeat(${members.length}, minmax(170px, 1fr))`, minWidth: members.length > 1 ? `${44 + members.length * 170}px` : undefined };
  const hourMarks = Array.from({ length: (end - start) / 60 + 1 }, (_, index) => start + index * 60);
  const slots = Array.from({ length: (end - start) / 30 }, (_, index) => start + index * 30);
  const canCreate = salon.services.some(service => service.active) && columns.some(member => member.active);
  return <div className="lb-day-calendar">
    <div className="lb-calendar-days" aria-label="Ημέρες ημερολογίου">{[-2, -1, 0, 1, 2].map(offset => {
      const day = changeDay(date, offset);
      return <button type="button" key={day} className={offset === 0 ? 'lb-calendar-day-selected' : ''} aria-pressed={offset === 0} aria-label={new Intl.DateTimeFormat('el-GR', { timeZone: timezone, weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).format(new Date(`${day}T12:00:00Z`))} onClick={() => onDateChange(day)}><span>{new Intl.DateTimeFormat('el-GR', { timeZone: timezone, weekday: 'short' }).format(new Date(`${day}T12:00:00Z`))}</span><strong>{Number(day.slice(-2))}</strong></button>;
    })}</div>
    <div className="lb-timeline-legend" aria-label="Προέλευση ραντεβού"><span><i className="lb-legend-online" aria-hidden="true" />Από Eneres</span><span><i className="lb-legend-offline" aria-hidden="true" />Χειροκίνητο</span></div>
    <div className="lb-timeline" role="region" aria-label="Ημερήσιο ημερολόγιο">
      <div className="lb-timeline-scroll" tabIndex={members.length > 1 ? 0 : undefined} aria-label={members.length > 1 ? 'Σύρετε για να δείτε όλους τους επαγγελματίες' : undefined}>
        <div className="lb-timeline-head" style={gridStyle}><span><Clock3 size={13} /></span>{members.map(member => <strong key={member.id}>{member.name}</strong>)}</div>
        <div className="lb-timeline-grid" style={{ ...gridStyle, height }}>
          <div className="lb-timeline-axis">{hourMarks.map(minute => <span key={minute} className="lb-timeline-hour" style={{ top: minute - start }}>{clock(minute)}</span>)}</div>
          {members.map((member) => {
            const ownEvents = events.filter(event => event.staffId === member.id);
            const positioned = positionBookings(ownEvents);
            const absences = (salon.timeOff || []).filter(entry => entry.staff_id === member.id && dayOf(entry.starts_at, timezone) <= date && dayOf(entry.ends_at, timezone) >= date).map(entry => ({ ...entry, ...bounds(entry.starts_at, entry.ends_at, date, timezone) }));
            return <div className="lb-timeline-lane" key={member.id}>
              {hours.filter(entry => entry.staff_id === member.id).map(entry => <div key={entry.id || entry.opens_at} className="lb-timeline-opening" aria-hidden="true" style={{ top: Math.max(0, minutes(entry.opens_at) - start), height: Math.min(end, minutes(entry.closes_at)) - Math.max(start, minutes(entry.opens_at)) }} />)}
              {hourMarks.map(minute => <i key={minute} className="lb-timeline-line" style={{ top: minute - start }} aria-hidden="true" />)}
              {slots.map(minute => {
                const occupied = ownEvents.some(event => event.start < minute + 30 && event.end > minute) || absences.some(event => event.start < minute + 30 && event.end > minute);
                return <button type="button" key={minute} className="lb-timeline-slot" style={{ top: minute - start, height: 30 }} disabled={disabled || !canCreate || !member.active || occupied} aria-label={`Νέο ραντεβού στις ${clock(minute)} με ${member.name}`} onClick={() => onCreate({ time: clock(minute), staffId: member.id })}><Plus size={13} aria-hidden="true" /></button>;
              })}
              {absences.map(entry => <div key={entry.id} className="lb-timeline-absence" style={{ top: Math.max(start, entry.start) - start, height: Math.max(0, Math.min(end, entry.end) - Math.max(start, entry.start)) }}><span>{entry.reason || 'Απουσία'}</span></div>)}
              {positioned.map(booking => <button type="button" key={booking.id} className={`lb-booking-row lb-timeline-booking lb-timeline-booking-${booking.source === 'offline' ? 'offline' : 'online'} lb-booking-${booking.status}${booking.visibleHeight < 80 ? ' lb-timeline-booking-compact' : ''}${booking.visibleHeight < 50 ? ' lb-timeline-booking-medium' : ''}${booking.visibleHeight < 35 ? ' lb-timeline-booking-short' : ''}`} style={{ top: booking.start - start, height: booking.visibleHeight, left: `calc(${booking.track / booking.trackCount * 100}% + 5px)`, width: `calc(${100 / booking.trackCount}% - 10px)`, right: 'auto' }} aria-label={`${booking.time} ${booking.name} ${booking.service.name}${booking.phone ? ` ${booking.phone}` : ''}`} title={`${booking.time} · ${booking.name} · ${booking.service.name}${booking.phone ? ` · ${booking.phone}` : ''}`}  onClick={() => onSelectBooking(booking)}><span className="lb-timeline-booking-title"><time>{booking.start === 0 && dayOf(booking.startsAt, timezone) < date ? '00:00' : booking.time}</time><strong>{booking.name}</strong>{booking.paymentStatus === 'paid' && booking.trackCount === 1 && <CheckPaid />}</span>{booking.phone && <span className="lb-timeline-booking-phone">{booking.phone}</span>}<span className="lb-timeline-booking-service">{booking.service.name}</span><small>{booking.source === 'offline' ? 'Χειροκίνητο' : 'Eneres'} · {labels[booking.status] || booking.status}</small></button>)}
            </div>;
          })}
        </div>
      </div>
    </div>
    {!events.length && <p className="lb-timeline-empty"><CalendarDays size={15} />Δεν υπάρχουν ραντεβού για αυτή την ημέρα</p>}
    <p className="lb-note lb-timeline-tip">Επιλέξτε μια κενή ώρα για να προσθέσετε χειροκίνητο ραντεβού</p>
  </div>;
}

function CheckPaid() { return <em className="lb-timeline-paid">πληρωμένο</em>; }
