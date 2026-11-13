import { formatParam, positionToValue, SLIDER_RESOLUTION, snapValue, valueToPosition, type Scale } from '../engine/brush-params';

export interface ValueFieldOptions {
  scale: Scale;
  unit: string;
  /** Accessible name of the field (the visible label belongs to whoever places the field). */
  label: string;
  /** Values worth one tap: offered in a single ▾ menu instead of a row of buttons. */
  choices?: readonly number[];
  /** The person changed the value (always already snapped to the scale). */
  onChange: (value: number) => void;
}

export interface ValueField {
  el: HTMLElement;
  /** Show a value without announcing it; the control being used right now is left alone. */
  setValue(value: number): void;
  /** Controls to disable together while the setting has no effect. */
  readonly inputs: readonly HTMLInputElement[];
  setDisabled(disabled: boolean): void;
}

/**
 * One way to edit a number everywhere in the interface: a slider, a box for the exact value with its unit, and — when
 * there are values worth jumping to — one ▾ menu. No −/+ buttons and no rows of chips: the slider and the box already
 * reach every value, and the keyboard arrows step the box.
 */
export function valueField(o: ValueFieldOptions): ValueField {
  const el = document.createElement('span');
  el.className = 'vf';

  const slider = document.createElement('input');
  slider.type = 'range';
  slider.min = '0';
  slider.max = String(SLIDER_RESOLUTION);
  slider.step = '1';
  slider.className = 'vf-slider';
  slider.setAttribute('aria-label', o.label);

  const num = document.createElement('input');
  num.type = 'number';
  num.className = 'vf-num';
  num.min = String(o.scale.min);
  num.max = String(o.scale.max);
  num.step = String(o.scale.step);
  num.inputMode = 'decimal';
  num.setAttribute('aria-label', `${o.label} (valor exacto)`);

  const unit = document.createElement('span');
  unit.className = 'vf-unit';
  unit.textContent = o.unit;

  el.append(slider, num, unit);

  let value = o.scale.min;
  let menu: HTMLSelectElement | undefined;
  const show = (v: number): void => {
    value = v;
    if (document.activeElement !== slider) slider.value = String(valueToPosition(o.scale, v));
    if (document.activeElement !== num) num.value = formatParam(o.scale, v);
    if (menu) menu.value = '';
  };
  const change = (next: number): void => {
    const v = snapValue(o.scale, next);
    show(v);
    o.onChange(v);
  };

  slider.addEventListener('input', () => change(positionToValue(o.scale, Number(slider.value))));
  // An unfinished entry (empty, a lone minus) changes nothing until it is finished.
  num.addEventListener('change', () => {
    if (num.value.trim() === '' || !Number.isFinite(num.valueAsNumber)) num.value = formatParam(o.scale, value);
    else change(num.valueAsNumber);
    num.value = formatParam(o.scale, value);
  });

  const inputs: HTMLInputElement[] = [slider, num];
  if (o.choices?.length) {
    // A transparent native <select> over a ▾ button: the platform's own picker opens (a wheel on a tablet), no custom popup.
    const wrap = document.createElement('span');
    wrap.className = 'vf-menu';
    const arrow = document.createElement('span');
    arrow.className = 'vf-arrow';
    arrow.setAttribute('aria-hidden', 'true');
    arrow.textContent = '▾';
    menu = document.createElement('select');
    menu.setAttribute('aria-label', `${o.label}: valores habituales`);
    menu.title = 'Valores habituales';
    const hint = document.createElement('option');
    hint.value = '';
    hint.textContent = 'Valores…';
    hint.disabled = true;
    menu.append(hint);
    for (const c of o.choices) {
      const opt = document.createElement('option');
      opt.value = String(c);
      opt.textContent = `${c} ${o.unit}`.trim();
      menu.append(opt);
    }
    menu.value = '';
    const select = menu;
    select.addEventListener('change', () => {
      const raw = select.value;
      select.value = ''; // back to the hint, so choosing the same value twice still registers
      if (raw !== '') change(Number(raw));
    });
    wrap.append(arrow, select);
    el.append(wrap);
  }

  return {
    el,
    setValue: show,
    inputs,
    setDisabled(disabled) {
      for (const i of inputs) i.disabled = disabled;
      if (menu) menu.disabled = disabled;
    },
  };
}
