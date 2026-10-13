/** Escaping html`` tagged template. Every ${} value is escaped unless it is a SafeHtml. */

export class SafeHtml {
  readonly value: string;

  constructor(value: string) {
    this.value = value;
  }

  toString(): string {
    return this.value;
  }
}

const ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
  '`': '&#96;',
};

export function escapeHtml(value: unknown): string {
  return String(value ?? '').replace(/[&<>"'`]/g, (char) => ESCAPES[char] ?? char);
}

/** Mark a trusted string (icons, constants) as already safe. Never pass user data. */
export const raw = (value: string): SafeHtml => new SafeHtml(value);

function render(value: unknown): string {
  if (value instanceof SafeHtml) return value.value;
  if (Array.isArray(value)) return value.map(render).join('');
  if (value === null || value === undefined || value === false || value === true) return '';
  return escapeHtml(value);
}

export function html(strings: TemplateStringsArray, ...values: unknown[]): SafeHtml {
  let out = strings[0] ?? '';
  values.forEach((value, index) => {
    out += render(value) + (strings[index + 1] ?? '');
  });
  return new SafeHtml(out);
}

/** Space-joined class names, skipping falsy entries: class="${classes('a', cond && 'b')}". */
export function classes(...names: (string | false | null | undefined)[]): string {
  return names.filter(Boolean).join(' ');
}

/** Replace an element's content with rendered markup (the one sanctioned innerHTML write). */
export function mount(element: Element, content: SafeHtml): void {
  element.innerHTML = content.value;
}

/** A `tel:` href for a phone number, or '#' when it holds anything but digits, spaces, + - ( ). */
export function telHref(phone: unknown): string {
  const value = String(phone ?? '').trim();
  return /^\+?[\d\s().-]{3,20}$/.test(value) ? `tel:${value.replace(/[^\d+]/g, '')}` : '#';
}
