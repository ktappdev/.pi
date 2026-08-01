import.meta.url = "pi://typebox";
// Auto-generated npm proxy stub (Pattern 4) for "typebox"
const __pkg = "typebox";
const __handler = {
  get(_target, prop) {
    if (typeof prop === 'symbol') {
      if (prop === Symbol.toPrimitive) return () => '';
      return undefined;
    }
    if (prop === '__esModule') return true;
    if (prop === 'default') return __stub;
    if (prop === 'toString') return () => '';
    if (prop === 'valueOf') return () => '';
    if (prop === 'name') return __pkg;
    // Promise assimilation guard: do not pretend to be then-able.
    if (prop === 'then') return undefined;
    return __stub;
  },
  apply() { return __stub; },
  construct() { return __stub; },
  has() { return false; },
  ownKeys() { return []; },
  getOwnPropertyDescriptor() {
    return { configurable: true, enumerable: false };
  },
};
const __stub = new Proxy(function __pijs_noop() {}, __handler);
export const Type = __stub;
export default __stub;
export const __pijs_proxy_stub = __stub;
export const __esModule = true;
