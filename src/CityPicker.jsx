import { t, getLocale } from './i18n';
import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Check, ChevronDown, MapPin } from 'lucide-react';
import './city-picker.css';

const normalize = text => text.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase(getLocale());

export default function CityPicker({ value, onChange, groups }) {
  const id = useId().replace(/:/g, '');
  const listId = `city-list-${id}`;
  const wrapper = useRef(null);
  const trigger = useRef(null);
  const list = useRef(null);
  const typed = useRef({ text: '', time: 0 });
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const [placement, setPlacement] = useState({ above: false, maxHeight: 320 });
  const options = useMemo(() => [
    { value: 'all', label: 'Όλες οι πόλεις' },
    ...groups.flatMap(group => group.cities.map(city => ({ value: city, label: city }))),
  ], [groups]);

  const optionId = index => `${listId}-option-${index}`;
  const close = () => { setOpen(false); typed.current = { text: '', time: 0 }; };
  const openPicker = index => {
    typed.current = { text: '', time: 0 };
    setActiveIndex(index ?? Math.max(0, options.findIndex(option => option.value === value)));
    setOpen(true);
  };
  const choose = index => {
    if (!options[index]) return;
    onChange(options[index].value);
    close();
    trigger.current?.focus({ preventScroll: true });
  };

  useEffect(() => {
    if (!open) return undefined;
    const outside = event => {
      if (!wrapper.current?.contains(event.target)) close();
    };
    document.addEventListener('pointerdown', outside);
    document.addEventListener('focusin', outside);
    return () => {
      document.removeEventListener('pointerdown', outside);
      document.removeEventListener('focusin', outside);
    };
  }, [open]);

  useLayoutEffect(() => {
    if (!open) return undefined;
    const position = event => {
      if (event && list.current?.contains(event.target)) return;
      const rect = wrapper.current?.getBoundingClientRect();
      if (!rect) return;
      const viewport = window.visualViewport;
      const viewportTop = viewport?.offsetTop || 0;
      const viewportBottom = viewportTop + (viewport?.height || window.innerHeight);
      const below = viewportBottom - rect.bottom - 100;
      const above = rect.top - viewportTop - 12;
      const useAbove = below < 240 && above > below;
      setPlacement({ above: useAbove, maxHeight: Math.max(120, Math.min(350, useAbove ? above : below)) });
    };
    position();
    window.addEventListener('resize', position);
    window.addEventListener('scroll', position, true);
    window.visualViewport?.addEventListener('resize', position);
    return () => {
      window.removeEventListener('resize', position);
      window.removeEventListener('scroll', position, true);
      window.visualViewport?.removeEventListener('resize', position);
    };
  }, [open]);

  useLayoutEffect(() => {
    if (!open || !list.current) return;
    const option = document.getElementById(optionId(activeIndex));
    if (!option) return;
    const itemRect = option.getBoundingClientRect();
    const listRect = list.current.getBoundingClientRect();
    if (itemRect.top < listRect.top) list.current.scrollTop -= listRect.top - itemRect.top;
    else if (itemRect.bottom > listRect.bottom) list.current.scrollTop += itemRect.bottom - listRect.bottom;
  }, [open, activeIndex, placement.maxHeight]);

  const keyDown = event => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      if (!open) openPicker();
      else setActiveIndex(index => (index + (event.key === 'ArrowDown' ? 1 : -1) + options.length) % options.length);
    } else if (event.key === 'Home' || event.key === 'End') {
      event.preventDefault();
      const index = event.key === 'Home' ? 0 : options.length - 1;
      if (open) setActiveIndex(index);
      else openPicker(index);
    } else if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      if (open) choose(activeIndex);
      else openPicker();
    } else if (event.key === 'Escape') {
      if (open) { event.preventDefault(); event.stopPropagation(); close(); }
    } else if (event.key === 'Tab') {
      close();
    } else if (event.key.length === 1 && !event.altKey && !event.ctrlKey && !event.metaKey) {
      event.preventDefault();
      const now = Date.now();
      const text = (now - typed.current.time < 650 ? typed.current.text : '') + normalize(event.key);
      typed.current = { text, time: now };
      const search = [...options.keys()].map(index => (activeIndex + index + 1) % options.length);
      const index = search.find(index => normalize(t(options[index].label)).startsWith(text));
      if (index !== undefined) {
        setActiveIndex(index);
        setOpen(true);
      }
    }
  };

  const renderOption = (option, index) => <div
    id={optionId(index)} key={option.value} role="option" aria-selected={value === option.value}
    className={`city-picker-option${activeIndex === index ? ' city-picker-highlighted' : ''}${value === option.value ? ' city-picker-selected' : ''}`}
    onPointerMove={() => setActiveIndex(index)}
    onPointerDown={event => { if (event.pointerType === 'mouse') event.preventDefault(); }}
    onClick={() => choose(index)}
  ><span>{t(option.label)}</span>{value === option.value && <Check size={14} aria-hidden="true" />}</div>;

  let index = 1;
  return <div ref={wrapper} className={`search-field city-field city-picker${open ? ' city-picker-open' : ''}`}>
    <button ref={trigger} type="button" className="city-picker-trigger" role="combobox"
      aria-label={t("Πόλη ή περιοχή")} aria-haspopup="listbox" aria-expanded={open} aria-controls={listId}
      aria-activedescendant={open ? optionId(activeIndex) : undefined}
      onClick={() => open ? close() : openPicker()} onKeyDown={keyDown}>
      <MapPin size={17} strokeWidth={1.6} aria-hidden="true" />
      <span>{value === 'all' ? t("Πόλη") : t(value)}</span>
      <ChevronDown size={12} aria-hidden="true" />
    </button>
    {open && <div id={listId} ref={list} role="listbox" aria-label={t("Πόλεις")}
      className={`city-picker-list${placement.above ? ' city-picker-list-above' : ''}`}
      style={{ maxHeight: placement.maxHeight }}>
      {renderOption(options[0], 0)}
      {groups.map((group, groupIndex) => {
        const labelId = `${listId}-country-${groupIndex}`;
        const start = index;
        index += group.cities.length;
        return <div key={group.country} role="group" aria-labelledby={labelId} className="city-picker-group">
          <div id={labelId} className="city-picker-country">{t(group.country)}</div>
          {group.cities.map((city, cityIndex) => renderOption(options[start + cityIndex], start + cityIndex))}
        </div>;
      })}
    </div>}
  </div>;
}
