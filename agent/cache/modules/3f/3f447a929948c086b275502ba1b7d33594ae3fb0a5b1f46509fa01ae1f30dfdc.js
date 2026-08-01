import.meta.url = "pi://node:events";
class EventEmitter {
  constructor() {
    this._events = Object.create(null);
    this._maxListeners = 10;
  }

  on(event, listener) {
    if (!this._events[event]) this._events[event] = [];
    this._events[event].push(listener);
    return this;
  }

  addListener(event, listener) { return this.on(event, listener); }

  once(event, listener) {
    const wrapper = (...args) => {
      this.removeListener(event, wrapper);
      listener.apply(this, args);
    };
    wrapper._original = listener;
    return this.on(event, wrapper);
  }

  off(event, listener) { return this.removeListener(event, listener); }

  removeListener(event, listener) {
    const list = this._events[event];
    if (!list) return this;
    this._events[event] = list.filter(
      fn => fn !== listener && fn._original !== listener
    );
    if (this._events[event].length === 0) delete this._events[event];
    return this;
  }

  removeAllListeners(event) {
    if (event === undefined) {
      this._events = Object.create(null);
    } else {
      delete this._events[event];
    }
    return this;
  }

  emit(event, ...args) {
    const list = this._events[event];
    if (!list || list.length === 0) return false;
    for (const fn of list.slice()) {
      try { fn.apply(this, args); } catch (e) {
        if (event !== 'error') this.emit('error', e);
      }
    }
    return true;
  }

  listeners(event) {
    const list = this._events[event];
    if (!list) return [];
    return list.map(fn => fn._original || fn);
  }

  listenerCount(event) {
    const list = this._events[event];
    return list ? list.length : 0;
  }

  eventNames() { return Object.keys(this._events); }

  setMaxListeners(n) { this._maxListeners = n; return this; }
  getMaxListeners() { return this._maxListeners; }

  prependListener(event, listener) {
    if (!this._events[event]) this._events[event] = [];
    this._events[event].unshift(listener);
    return this;
  }

  prependOnceListener(event, listener) {
    const wrapper = (...args) => {
      this.removeListener(event, wrapper);
      listener.apply(this, args);
    };
    wrapper._original = listener;
    return this.prependListener(event, wrapper);
  }

  rawListeners(event) {
    return this._events[event] ? this._events[event].slice() : [];
  }
}

EventEmitter.EventEmitter = EventEmitter;
EventEmitter.defaultMaxListeners = 10;

export { EventEmitter };
export default EventEmitter;