import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

// jsdom does not implement the dialog methods. Browser tests cover modal behavior.
if (typeof HTMLDialogElement.prototype.showModal !== 'function') {
  HTMLDialogElement.prototype.showModal = function () {
    this.open = true;
  };
  HTMLDialogElement.prototype.close = function () {
    this.open = false;
  };
}

afterEach(() => {
  cleanup();
});
