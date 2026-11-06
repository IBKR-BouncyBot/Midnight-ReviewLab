const address = document.getElementById('support-address');
const button = document.getElementById('copy-support-address');
const status = document.getElementById('support-copy-status');

if (address && button && status) {
  button.hidden = false;
  button.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(address.textContent.trim());
      status.textContent = 'Cardano address copied.';
    } catch {
      const range = document.createRange();
      range.selectNodeContents(address);
      const selection = window.getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
      address.focus();
      status.textContent = 'Select and copy the address above manually.';
    }
  });
}
