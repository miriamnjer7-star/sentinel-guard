// Captures keydown/keyup timing on a password field and stores it as JSON
// in a hidden input before the form submits. Fails silently if the
// expected elements aren't on the page, so it never blocks a normal submit.
(function () {
  const passwordField = document.querySelector('input[type="password"]');
  const hiddenField = document.getElementById('keystroke_events');
  const form = passwordField ? passwordField.closest('form') : null;

  if (!passwordField || !hiddenField || !form) return;

  const events = [];
  const start = performance.now();

  passwordField.addEventListener('keydown', (e) => {
    events.push({ key: e.key, type: 'down', t: performance.now() - start });
  });
  passwordField.addEventListener('keyup', (e) => {
    events.push({ key: e.key, type: 'up', t: performance.now() - start });
  });

  form.addEventListener('submit', () => {
    hiddenField.value = JSON.stringify(events);
  });
})();