import.meta.url = "pi://node:crypto";
// Helper: convert hex string to Uint8Array with Buffer-like toString
function hexToBuffer(hex) {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return bufferFromBytes(bytes);
}

function bufferFromBytes(input) {
  const bytes = new Uint8Array(input.length);
  bytes.set(input);
  bytes.toString = function(enc) {
    const normalized = normalizeBufferEncoding(enc);
    if (normalized === 'hex') return bufToHex(this);
    if (normalized === 'base64') {
      let binary = '';
      let chunk = [];
      for (let i = 0; i < this.length; i++) {
        chunk.push(this[i]);
        if (chunk.length >= 4096) {
          binary += String.fromCharCode.apply(null, chunk);
          chunk.length = 0;
        }
      }
      if (chunk.length > 0) {
        binary += String.fromCharCode.apply(null, chunk);
      }
      return globalThis.btoa(binary);
    }
    if (normalized === 'latin1' || normalized === 'binary') return bytesToOneByteString(this, false);
    if (normalized === 'ascii') return bytesToOneByteString(this, true);
    return new TextDecoder().decode(this);
  };
  return bytes;
}

// Helper: Uint8Array to hex string
function bufToHex(buf) {
  return Array.from(buf).map(b => b.toString(16).padStart(2, '0')).join('');
}

function stringToOneByteBytes(input) {
  const out = new Uint8Array(input.length);
  for (let i = 0; i < input.length; i++) {
    out[i] = input.charCodeAt(i) & 0xff;
  }
  return bufferFromBytes(out);
}

function bytesToOneByteString(input, stripHighBit) {
  let output = '';
  let chunk = [];
  for (let i = 0; i < input.length; i++) {
    chunk.push(stripHighBit ? (input[i] & 0x7f) : input[i]);
    if (chunk.length >= 4096) {
      output += String.fromCharCode.apply(null, chunk);
      chunk.length = 0;
    }
  }
  if (chunk.length > 0) {
    output += String.fromCharCode.apply(null, chunk);
  }
  return output;
}

function requireCryptoHostcall(hostcallName, apiName) {
  const hostcall = globalThis[hostcallName];
  if (typeof hostcall !== 'function') {
    throw new Error(`${apiName} not available: crypto hostcalls not registered`);
  }
  return hostcall;
}

function combineChunks(chunks) {
  const totalLen = chunks.reduce((acc, c) => acc + c.length, 0);
  const combined = new Uint8Array(totalLen);
  let offset = 0;
  for (const chunk of chunks) {
    combined.set(chunk, offset);
    offset += chunk.length;
  }
  return combined;
}

function toUint8Array(input, encoding) {
  if (input instanceof Uint8Array) return input;
  if (typeof input === 'string') {
    const enc = normalizeBufferEncoding(encoding);
    if (enc === 'hex') {
      if (input.length % 2 !== 0 || /[^0-9a-f]/i.test(input)) {
        throw new Error('invalid hex input');
      }
      return hexToBuffer(input);
    }
    if (enc === 'base64') return base64ToBytes(input);
    if (enc === 'latin1' || enc === 'binary' || enc === 'ascii') {
      return stringToOneByteBytes(input);
    }
    return new TextEncoder().encode(input);
  }
  return new TextEncoder().encode(String(input ?? ''));
}

function normalizeBufferEncoding(encoding) {
  if (encoding === undefined || encoding === null) return 'utf8';
  const enc = String(encoding).toLowerCase();
  if (enc === 'utf8' || enc === 'utf-8') return 'utf8';
  if (enc === 'latin1' || enc === 'binary' || enc === 'ascii') return enc;
  if (enc === 'hex' || enc === 'base64') return enc;
  throw new Error(`unsupported input encoding '${encoding}'`);
}

function encodeOutput(bytes, encoding) {
  const out = bufferFromBytes(bytes);
  if (encoding === undefined || encoding === null) return out;
  const enc = normalizeBufferEncoding(encoding);
  if (enc === 'hex') return out.toString('hex');
  if (enc === 'base64') return out.toString('base64');
  if (enc === 'utf8') return out.toString('utf8');
  if (enc === 'latin1' || enc === 'binary' || enc === 'ascii') return out.toString(enc);
  throw new Error(`unsupported output encoding '${encoding}'`);
}

function base64ToBytes(input) {
  const binary = globalThis.atob(String(input));
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    out[i] = binary.charCodeAt(i);
  }
  return out;
}

function decodePemKey(input, label, apiName) {
  const text = String(input ?? '');
  const begin = `-----BEGIN ${label}-----`;
  const end = `-----END ${label}-----`;
  const start = text.indexOf(begin);
  const finish = text.indexOf(end);
  if (start < 0 || finish < 0 || finish <= start) {
    throw new Error(`${apiName}: Ed25519 ${label} PEM is required`);
  }
  const body = text
    .slice(start + begin.length, finish)
    .replace(/\s+/g, '');
  if (body.length === 0) {
    throw new Error(`${apiName}: empty Ed25519 ${label} PEM`);
  }
  return base64ToBytes(body);
}

function keyMaterialToDer(key, label, apiName) {
  let material = key;
  if (material && typeof material === 'object' && !(material instanceof Uint8Array)) {
    if (!Object.prototype.hasOwnProperty.call(material, 'key')) {
      throw new Error(`${apiName}: unsupported Ed25519 key object`);
    }
    if (material.format && material.format !== 'pem' && material.format !== 'der') {
      throw new Error(`${apiName}: unsupported Ed25519 key format '${material.format}'`);
    }
    material = material.key;
  }
  if (material instanceof Uint8Array) {
    return material;
  }
  if (typeof material === 'string') {
    return decodePemKey(material, label, apiName);
  }
  throw new Error(`${apiName}: Ed25519 ${label} key must be PEM text or DER bytes`);
}

function normalizeSignVerifyAlgorithm(algorithm, apiName) {
  if (algorithm === null || algorithm === undefined) {
    return 'ed25519';
  }
  const name = normalizeDigestName(algorithm);
  throw new Error(`${apiName}: unsupported algorithm '${name}'; only Ed25519 with null/undefined algorithm is supported`);
}

function normalizeDigestName(input) {
  if (input === undefined || input === null) return 'sha1';
  return String(input)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

function unsupportedCryptoApi(name) {
  throw new Error(`${name} is not implemented in the Pi node:crypto shim`);
}

function normalizeCryptoOptionsEncoding(options, apiName) {
  if (options === undefined || options === null) return undefined;
  if (typeof options !== 'object') {
    throw new Error(`${apiName}: options must be an object`);
  }
  if (!Object.prototype.hasOwnProperty.call(options, 'encoding')) return undefined;
  return normalizeBufferEncoding(options.encoding);
}

function normalizeCipherAlgorithm(algorithm, apiName) {
  if (algorithm === undefined || algorithm === null || String(algorithm).trim() === '') {
    throw new Error(`${apiName}: algorithm is required`);
  }
  return String(algorithm).trim().toLowerCase();
}

function validateAesGcmParams(algorithm, key, iv, apiName) {
  const algo = normalizeCipherAlgorithm(algorithm, apiName);
  if (algo !== 'aes-128-gcm' && algo !== 'aes-256-gcm') {
    throw new Error(`${apiName}: unsupported cipher algorithm '${algo}'`);
  }
  const keyBuf = toUint8Array(key);
  const expectedKeyLen = algo === 'aes-128-gcm' ? 16 : 32;
  if (keyBuf.length !== expectedKeyLen) {
    throw new Error(`${apiName}: ${algo} key must be exactly ${expectedKeyLen} bytes`);
  }
  const ivBuf = toUint8Array(iv);
  if (ivBuf.length !== 12) {
    throw new Error(`${apiName}: AES-GCM IV must be exactly 12 bytes`);
  }
  return { algo, keyBuf, ivBuf };
}

export function randomUUID() {
  const randomUuidNative = requireCryptoHostcall(
    '__pi_crypto_random_uuid_native',
    'randomUUID',
  );
  return randomUuidNative();
}

export function createHash(algorithm) {
  if (algorithm === undefined || algorithm === null || String(algorithm).trim() === '') {
    throw new Error('createHash: algorithm is required');
  }
  const algo = normalizeDigestName(algorithm);
  const chunks = [];
  let finalized = false;
  return {
    update(input, inputEncoding) {
      if (finalized) {
        throw new Error('Hash.digest() already called');
      }
      chunks.push(toUint8Array(input, inputEncoding));
      return this;
    },
    digest(encoding) {
      if (finalized) {
        throw new Error('Hash.digest() already called');
      }
      finalized = true;
      const hashNative = requireCryptoHostcall('__pi_crypto_hash_native', 'createHash');
      const data = combineChunks(chunks);
      const hex = hashNative(algo, data, 'hex');
      if (!encoding) return hexToBuffer(hex);
      if (encoding === 'hex') return hex;
      if (encoding === 'base64') {
        const buf = hexToBuffer(hex);
        return globalThis.btoa(String.fromCharCode(...buf));
      }
      throw new Error(`createHash.digest: unsupported encoding '${encoding}'`);
    },
  };
}

export function createHmac(algorithm, key, options) {
  if (algorithm === undefined || algorithm === null || String(algorithm).trim() === '') {
    throw new Error('createHmac: algorithm is required');
  }
  const algo = normalizeDigestName(algorithm);
  const chunks = [];
  const keyBuf = toUint8Array(key, normalizeCryptoOptionsEncoding(options, 'createHmac'));
  let finalized = false;
  return {
    update(input, inputEncoding) {
      if (finalized) {
        throw new Error('Hmac.digest() already called');
      }
      chunks.push(toUint8Array(input, inputEncoding));
      return this;
    },
    digest(encoding) {
      if (finalized) {
        throw new Error('Hmac.digest() already called');
      }
      finalized = true;
      const hmacNative = requireCryptoHostcall('__pi_crypto_hmac_native', 'createHmac');
      const data = combineChunks(chunks);
      const hex = hmacNative(algo, keyBuf, data, 'hex');
      if (!encoding) return hexToBuffer(hex);
      if (encoding === 'hex') return hex;
      if (encoding === 'base64') {
        const buf = hexToBuffer(hex);
        return globalThis.btoa(String.fromCharCode(...buf));
      }
      throw new Error(`createHmac.digest: unsupported encoding '${encoding}'`);
    },
  };
}

export function randomBytes(size) {
  if (!Number.isSafeInteger(size) || size < 0) {
    throw new Error('randomBytes: size must be a non-negative integer');
  }
  const randomBytesNative = requireCryptoHostcall(
    '__pi_crypto_random_bytes_native',
    'randomBytes',
  );
  return hexToBuffer(randomBytesNative(size));
}

export function randomInt(min, max) {
  if (max === undefined) { max = min; min = 0; }
  if (!Number.isSafeInteger(min) || !Number.isSafeInteger(max)) {
    throw new Error('randomInt: min/max must be safe integers');
  }
  if (min >= max) {
    throw new Error('randomInt: min must be less than max');
  }
  const randomIntNative = requireCryptoHostcall(
    '__pi_crypto_random_int_native',
    'randomInt',
  );
  return randomIntNative(min, max);
}

export function timingSafeEqual(a, b) {
  if (typeof globalThis.__pi_crypto_timing_safe_equal_native === 'function') {
    return globalThis.__pi_crypto_timing_safe_equal_native(a, b);
  }
  if (a.length !== b.length) throw new Error('Input buffers must have the same byte length');
  let result = 0;
  for (let i = 0; i < a.length; i++) result |= a[i] ^ b[i];
  return result === 0;
}


export function getHashes() {
  return ['md5', 'sha1', 'sha256', 'sha384', 'sha512'];
}

export function pbkdf2Sync(password, salt, iterations, keylen, digest) {
  const algo = normalizeDigestName(digest);
  if (!Number.isSafeInteger(iterations) || iterations <= 0) {
    throw new Error('pbkdf2Sync: iterations must be a positive integer');
  }
  if (!Number.isSafeInteger(keylen) || keylen <= 0) {
    throw new Error('pbkdf2Sync: keylen must be a positive integer');
  }
  if (iterations > 1000000) {
    throw new Error('pbkdf2Sync: iterations must be <= 1000000');
  }
  if (keylen > 1048576) {
    throw new Error('pbkdf2Sync: keylen must be <= 1048576');
  }
  const pbkdf2Native = requireCryptoHostcall(
    '__pi_crypto_pbkdf2_native',
    'pbkdf2Sync',
  );
  const hex = pbkdf2Native(
    toUint8Array(password),
    toUint8Array(salt),
    iterations,
    keylen,
    algo,
    'hex',
  );
  return hexToBuffer(hex);
}

export function pbkdf2(password, salt, iterations, keylen, digest, callback) {
  if (typeof digest === 'function') {
    callback = digest;
    digest = undefined;
  }
  if (typeof callback !== 'function') {
    throw new Error('pbkdf2: callback is required');
  }
  try {
    const value = pbkdf2Sync(password, salt, iterations, keylen, digest);
    callback(null, value);
  } catch (e) {
    callback(e);
  }
}

export function createCipheriv(algorithm, key, iv) {
  const { algo, keyBuf, ivBuf } = validateAesGcmParams(algorithm, key, iv, 'createCipheriv');
  const encryptNative = requireCryptoHostcall(
    '__pi_crypto_aes_gcm_encrypt_native',
    'createCipheriv',
  );
  const chunks = [];
  let aad = new Uint8Array(0);
  let finalized = false;
  let authTag = null;
  return {
    setAAD(input) {
      if (finalized) throw new Error('Cipher already finalized');
      if (chunks.length > 0) throw new Error('Cipher.setAAD() must be called before update()');
      aad = toUint8Array(input);
      return this;
    },
    update(input, inputEncoding, outputEncoding) {
      if (finalized) throw new Error('Cipher.final() already called');
      chunks.push(toUint8Array(input, inputEncoding));
      return encodeOutput(new Uint8Array(0), outputEncoding);
    },
    final(outputEncoding) {
      if (finalized) throw new Error('Cipher.final() already called');
      finalized = true;
      const combinedHex = encryptNative(algo, keyBuf, ivBuf, aad, combineChunks(chunks), 'hex');
      const combined = hexToBuffer(combinedHex);
      authTag = bufferFromBytes(combined.slice(combined.length - 16));
      const ciphertext = combined.slice(0, combined.length - 16);
      return encodeOutput(ciphertext, outputEncoding);
    },
    getAuthTag() {
      if (!finalized || authTag === null) {
        throw new Error('Cipher.getAuthTag() requires final() first');
      }
      return bufferFromBytes(authTag);
    },
  };
}

export function createDecipheriv(algorithm, key, iv) {
  const { algo, keyBuf, ivBuf } = validateAesGcmParams(algorithm, key, iv, 'createDecipheriv');
  const decryptNative = requireCryptoHostcall(
    '__pi_crypto_aes_gcm_decrypt_native',
    'createDecipheriv',
  );
  const chunks = [];
  let aad = new Uint8Array(0);
  let authTag = null;
  let finalized = false;
  return {
    setAAD(input) {
      if (finalized) throw new Error('Decipher already finalized');
      if (chunks.length > 0) throw new Error('Decipher.setAAD() must be called before update()');
      aad = toUint8Array(input);
      return this;
    },
    setAuthTag(tag) {
      if (finalized) throw new Error('Decipher already finalized');
      const tagBuf = toUint8Array(tag);
      if (tagBuf.length !== 16) {
        throw new Error('Decipher.setAuthTag() requires a 16-byte tag');
      }
      authTag = tagBuf;
      return this;
    },
    update(input, inputEncoding, outputEncoding) {
      if (finalized) throw new Error('Decipher.final() already called');
      chunks.push(toUint8Array(input, inputEncoding));
      return encodeOutput(new Uint8Array(0), outputEncoding);
    },
    final(outputEncoding) {
      if (finalized) throw new Error('Decipher.final() already called');
      if (authTag === null) throw new Error('Decipher.final() requires setAuthTag() first');
      finalized = true;
      const plaintextHex = decryptNative(
        algo,
        keyBuf,
        ivBuf,
        aad,
        combineChunks(chunks),
        authTag,
        'hex',
      );
      return encodeOutput(hexToBuffer(plaintextHex), outputEncoding);
    },
  };
}

export function scryptSync(password, salt, keylen, options) {
  if (!Number.isSafeInteger(keylen) || keylen <= 0) {
    throw new Error('scryptSync: keylen must be a positive integer');
  }
  if (keylen > 1048576) {
    throw new Error('scryptSync: keylen must be <= 1048576');
  }
  let encoding;
  let opts = {};
  if (typeof options === 'string') {
    encoding = options;
  } else if (options && typeof options === 'object') {
    opts = options;
    if (typeof options.encoding === 'string') {
      encoding = options.encoding;
    }
  }
  const nRaw = Number.isSafeInteger(opts.N)
    ? opts.N
    : (Number.isSafeInteger(opts.cost) ? opts.cost : 16384);
  const r = Number.isSafeInteger(opts.r) ? opts.r : 8;
  const p = Number.isSafeInteger(opts.p) ? opts.p : 1;
  if (r <= 0 || p <= 0) {
    throw new Error('scryptSync: r/p must be positive integers');
  }
  if (!Number.isSafeInteger(nRaw) || nRaw <= 1) {
    throw new Error('scryptSync: N must be an integer > 1');
  }
  const logN = Math.log2(nRaw);
  if (!Number.isFinite(logN) || Math.floor(logN) !== logN) {
    throw new Error('scryptSync: N must be a power of two');
  }
  if (logN > 20) {
    throw new Error('scryptSync: N must be <= 2^20');
  }
  if (r > 16 || p > 16) {
    throw new Error('scryptSync: r/p must be <= 16');
  }
  const maxMem = 32 * 1024 * 1024;
  const n = 1 << logN;
  const memBytes = 128 * r * n * p;
  if (memBytes > maxMem) {
    throw new Error(`scryptSync: parameters exceed memory limit (${maxMem} bytes)`);
  }
  const scryptNative = requireCryptoHostcall(
    '__pi_crypto_scrypt_native',
    'scryptSync',
  );
  const hex = scryptNative(
    toUint8Array(password),
    toUint8Array(salt),
    keylen,
    logN,
    r,
    p,
    'hex',
  );
  const buffer = hexToBuffer(hex);
  return encoding ? buffer.toString(encoding) : buffer;
}

export function scrypt(password, salt, keylen, options, callback) {
  if (typeof options === 'function') { callback = options; }
  if (typeof callback !== 'function') {
    throw new Error('scrypt: callback is required');
  }
  try {
    const value = scryptSync(password, salt, keylen, options);
    callback(null, value);
  } catch (e) {
    callback(e);
  }
}

export function generateKeyPairSync() { unsupportedCryptoApi('generateKeyPairSync'); }
export function publicEncrypt() { unsupportedCryptoApi('publicEncrypt'); }
export function privateDecrypt() { unsupportedCryptoApi('privateDecrypt'); }
export function sign(algorithm, data, key) {
  normalizeSignVerifyAlgorithm(algorithm, 'sign');
  const signNative = requireCryptoHostcall('__pi_crypto_ed25519_sign_native', 'sign');
  const keyDer = keyMaterialToDer(key, 'PRIVATE KEY', 'sign');
  const hex = signNative(keyDer, toUint8Array(data), 'hex');
  return hexToBuffer(hex);
}

export function verify(algorithm, data, key, signature) {
  normalizeSignVerifyAlgorithm(algorithm, 'verify');
  const verifyNative = requireCryptoHostcall('__pi_crypto_ed25519_verify_native', 'verify');
  const keyDer = keyMaterialToDer(key, 'PUBLIC KEY', 'verify');
  return verifyNative(keyDer, toUint8Array(data), toUint8Array(signature));
}

export default {
  randomUUID, createHash, createHmac, randomBytes,
  randomInt, timingSafeEqual, getHashes, pbkdf2Sync, pbkdf2,
  createCipheriv, createDecipheriv, scryptSync, scrypt,
  generateKeyPairSync, publicEncrypt, privateDecrypt, sign, verify,
};