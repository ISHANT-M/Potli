/** Small form helpers: reading values, inline field errors, busy buttons and the status line. */

export function readForm(form: HTMLFormElement): Record<string, string> {
  const values: Record<string, string> = {};
  new FormData(form).forEach((value, key) => {
    if (typeof value === 'string') values[key] = value;
  });
  return values;
}

export function clearFieldErrors(form: HTMLFormElement): void {
  form.querySelectorAll('.field-error').forEach((node) => node.remove());
  form.querySelectorAll('[aria-invalid]').forEach((node) => {
    node.removeAttribute('aria-invalid');
    node.removeAttribute('aria-describedby');
  });
}

/** Show an error beside each named field and focus the first one. */
export function showFieldErrors(form: HTMLFormElement, fields: Record<string, string>): void {
  clearFieldErrors(form);
  let first: HTMLElement | null = null;
  for (const [name, message] of Object.entries(fields)) {
    const input = form.elements.namedItem(name);
    if (!(input instanceof HTMLElement)) continue;
    const id = `${name}-error`;
    const error = document.createElement('small');
    error.className = 'field-error';
    error.id = id;
    error.textContent = message;
    const anchor = input.closest('.password-field') ?? input;
    anchor.insertAdjacentElement('afterend', error);
    input.setAttribute('aria-invalid', 'true');
    input.setAttribute('aria-describedby', id);
    first ??= input;
  }
  first?.focus();
}

export function setBusy(button: HTMLButtonElement | null, busy: boolean, busyText = 'Saving…'): void {
  if (!button) return;
  if (busy) {
    button.dataset.label = button.innerHTML;
    button.textContent = busyText;
    button.disabled = true;
    button.setAttribute('aria-busy', 'true');
  } else {
    if (button.dataset.label !== undefined) button.innerHTML = button.dataset.label;
    button.disabled = false;
    button.removeAttribute('aria-busy');
  }
}

/** Write to the form's polite live region (.form-message). */
export function setMessage(form: HTMLElement, text: string, tone: 'info' | 'error' | 'success' = 'info'): void {
  const node = form.querySelector<HTMLElement>('.form-message');
  if (!node) return;
  node.textContent = text;
  node.dataset.tone = tone;
  node.setAttribute('aria-live', 'polite');
}

export type PasswordStrength = { score: 0 | 1 | 2 | 3; label: string };

/** A simple hint, not a policy: length and character variety. */
export function passwordStrength(password: string): PasswordStrength {
  if (password.length < 8) return { score: 0, label: 'Use at least 8 characters' };
  const variety = [/[a-z]/, /[A-Z]/, /\d/, /[^A-Za-z0-9]/].filter((rule) => rule.test(password)).length;
  if (password.length >= 12 && variety >= 3) return { score: 3, label: 'Strong password' };
  if (variety >= 3) return { score: 2, label: 'Good password' };
  return { score: 1, label: 'Add numbers or symbols to make it stronger' };
}
