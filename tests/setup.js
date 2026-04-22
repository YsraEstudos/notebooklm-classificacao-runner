const visibleRect = {
  x: 0,
  y: 0,
  width: 120,
  height: 24,
  top: 0,
  left: 0,
  right: 120,
  bottom: 24,
  toJSON() {
    return this;
  },
};

Object.defineProperty(Element.prototype, 'getClientRects', {
  configurable: true,
  value() {
    const style = this.style || {};
    if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') {
      return [];
    }

    return [visibleRect];
  },
});

Object.defineProperty(Element.prototype, 'getBoundingClientRect', {
  configurable: true,
  value() {
    return visibleRect;
  },
});

if (typeof window.InputEvent !== 'function') {
  class InputEventPolyfill extends Event {
    constructor(type, init = {}) {
      super(type, init);
      this.data = init.data || null;
      this.inputType = init.inputType || '';
    }
  }

  window.InputEvent = InputEventPolyfill;
  globalThis.InputEvent = InputEventPolyfill;
}

if (typeof HTMLFormElement !== 'undefined') {
  Object.defineProperty(HTMLFormElement.prototype, 'requestSubmit', {
    configurable: true,
    value(submitter) {
      this.dispatchEvent(new Event('submit', {
        bubbles: true,
        cancelable: true,
        composed: true,
      }));
      return submitter;
    },
  });
}

if (typeof window.matchMedia !== 'function') {
  window.matchMedia = () => ({
    matches: false,
    media: '',
    onchange: null,
    addListener() {},
    removeListener() {},
    addEventListener() {},
    removeEventListener() {},
    dispatchEvent() {
      return false;
    },
  });
}
