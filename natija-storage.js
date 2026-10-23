/* Preview has its own local data and never connects to production Firebase. */
window.NatijaPreview = new URLSearchParams(location.search).get('preview') === '1';
window.NatijaStorage = {
  getItem(key) { return localStorage.getItem((window.NatijaPreview ? 'natija-preview:' : '') + key); },
  setItem(key,value) { localStorage.setItem((window.NatijaPreview ? 'natija-preview:' : '') + key,value); },
  removeItem(key) { localStorage.removeItem((window.NatijaPreview ? 'natija-preview:' : '') + key); }
};
