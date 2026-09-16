/* ============================================================
 * auth.js — 账号保险箱:纯 JS 加密(SHA-256/HMAC/PBKDF2/AES-CTR)与登录门控
 * 方案:每个账号持仓数据以其密码派生密钥加密内联(__VAULT__),
 *       登录 = 用密码解密自己的数据;无密码只能看到密文。
 * 加密参数与服务端一致:PBKDF2-HMAC-SHA256(iter 每账号自带,64B)
 *       blob = AES-256-CTR(encKey, iv); mac = HMAC-SHA256(macKey, iv||blob)
 * ============================================================ */
(function () {
  'use strict';

  /* ---------- 纯 JS SHA-256 ---------- */
  var K = [
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2
  ];

  function sha256Bytes(bytes) {
    var H = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];
    var l = bytes.length;
    var withOne = bytes.concat([0x80]);
    var pad = (56 - (withOne.length % 64) + 64) % 64;
    var m = withOne.concat(new Array(pad).fill(0));
    var bitLenHi = Math.floor(l / 0x20000000);
    var bitLenLo = (l << 3) >>> 0;
    m = m.concat([(bitLenHi >>> 24) & 255, (bitLenHi >>> 16) & 255, (bitLenHi >>> 8) & 255, bitLenHi & 255,
                  (bitLenLo >>> 24) & 255, (bitLenLo >>> 16) & 255, (bitLenLo >>> 8) & 255, bitLenLo & 255]);

    var w = new Array(64);
    function rotr(x, n) { return ((x >>> n) | (x << (32 - n))) >>> 0; }

    for (var off = 0; off < m.length; off += 64) {
      for (var t = 0; t < 16; t++) {
        w[t] = ((m[off + t * 4] << 24) | (m[off + t * 4 + 1] << 16) | (m[off + t * 4 + 2] << 8) | m[off + t * 4 + 3]) >>> 0;
      }
      for (t = 16; t < 64; t++) {
        var s0 = rotr(w[t - 15], 7) ^ rotr(w[t - 15], 18) ^ (w[t - 15] >>> 3);
        var s1 = rotr(w[t - 2], 17) ^ rotr(w[t - 2], 19) ^ (w[t - 2] >>> 10);
        w[t] = (w[t - 16] + s0 + w[t - 7] + s1) >>> 0;
      }
      var a = H[0], b = H[1], c = H[2], d = H[3], e = H[4], f = H[5], g = H[6], h = H[7];
      for (t = 0; t < 64; t++) {
        var S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
        var ch = (e & f) ^ (~e & g);
        var t1 = (h + S1 + ch + K[t] + w[t]) >>> 0;
        var S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
        var maj = (a & b) ^ (a & c) ^ (b & c);
        var t2 = (S0 + maj) >>> 0;
        h = g; g = f; f = e; e = (d + t1) >>> 0; d = c; c = b; b = a; a = (t1 + t2) >>> 0;
      }
      H[0] = (H[0] + a) >>> 0; H[1] = (H[1] + b) >>> 0; H[2] = (H[2] + c) >>> 0; H[3] = (H[3] + d) >>> 0;
      H[4] = (H[4] + e) >>> 0; H[5] = (H[5] + f) >>> 0; H[6] = (H[6] + g) >>> 0; H[7] = (H[7] + h) >>> 0;
    }
    var out = [];
    for (var i = 0; i < 8; i++) out.push((H[i] >>> 24) & 255, (H[i] >>> 16) & 255, (H[i] >>> 8) & 255, H[i] & 255);
    return out;
  }

  function hmacSha256(keyBytes, msgBytes) {
    var block = 64;
    var k = keyBytes.slice();
    if (k.length > block) k = sha256Bytes(k);
    while (k.length < block) k.push(0);
    var oKey = k.map(function (x) { return x ^ 0x5c; });
    var iKey = k.map(function (x) { return x ^ 0x36; });
    return sha256Bytes(oKey.concat(sha256Bytes(iKey.concat(msgBytes))));
  }

  /* PBKDF2-HMAC-SHA256,输出 dkLen 字节 */
  function pbkdf2(passwordBytes, saltBytes, iter, dkLen) {
    var blocks = Math.ceil(dkLen / 32);
    var out = [];
    for (var b = 1; b <= blocks; b++) {
      var u = hmacSha256(passwordBytes, saltBytes.concat([0, 0, 0, b]));
      var t = u.slice();
      for (var i = 1; i < iter; i++) {
        u = hmacSha256(passwordBytes, u);
        for (var j = 0; j < 32; j++) t[j] ^= u[j];
      }
      out = out.concat(t);
    }
    return out.slice(0, dkLen);
  }

  /* ---------- 纯 JS AES-256(仅需加密方向,CTR 解密用) ---------- */
  var SBOX = (function () {
    var p = new Uint8Array(256), l = [0x63, 0x7c, 0x77, 0x7b, 0xf2, 0x6b, 0x6f, 0xc5, 0x30, 0x01, 0x67, 0x2b, 0xfe, 0xd7, 0xab, 0x76,
      0xca, 0x82, 0xc9, 0x7d, 0xfa, 0x59, 0x47, 0xf0, 0xad, 0xd4, 0xa2, 0xaf, 0x9c, 0xa4, 0x72, 0xc0,
      0xb7, 0xfd, 0x93, 0x26, 0x36, 0x3f, 0xf7, 0xcc, 0x34, 0xa5, 0xe5, 0xf1, 0x71, 0xd8, 0x31, 0x15,
      0x04, 0xc7, 0x23, 0xc3, 0x18, 0x96, 0x05, 0x9a, 0x07, 0x12, 0x80, 0xe2, 0xeb, 0x27, 0xb2, 0x75,
      0x09, 0x83, 0x2c, 0x1a, 0x1b, 0x6e, 0x5a, 0xa0, 0x52, 0x3b, 0xd6, 0xb3, 0x29, 0xe3, 0x2f, 0x84,
      0x53, 0xd1, 0x00, 0xed, 0x20, 0xfc, 0xb1, 0x5b, 0x6a, 0xcb, 0xbe, 0x39, 0x4a, 0x4c, 0x58, 0xcf,
      0xd0, 0xef, 0xaa, 0xfb, 0x43, 0x4d, 0x33, 0x85, 0x45, 0xf9, 0x02, 0x7f, 0x50, 0x3c, 0x9f, 0xa8,
      0x51, 0xa3, 0x40, 0x8f, 0x92, 0x9d, 0x38, 0xf5, 0xbc, 0xb6, 0xda, 0x21, 0x10, 0xff, 0xf3, 0xd2,
      0xcd, 0x0c, 0x13, 0xec, 0x5f, 0x97, 0x44, 0x17, 0xc4, 0xa7, 0x7e, 0x3d, 0x64, 0x5d, 0x19, 0x73,
      0x60, 0x81, 0x4f, 0xdc, 0x22, 0x2a, 0x90, 0x88, 0x46, 0xee, 0xb8, 0x14, 0xde, 0x5e, 0x0b, 0xdb,
      0xe0, 0x32, 0x3a, 0x0a, 0x49, 0x06, 0x24, 0x5c, 0xc2, 0xd3, 0xac, 0x62, 0x91, 0x95, 0xe4, 0x79,
      0xe7, 0xc8, 0x37, 0x6d, 0x8d, 0xd5, 0x4e, 0xa9, 0x6c, 0x56, 0xf4, 0xea, 0x65, 0x7a, 0xae, 0x08,
      0xba, 0x78, 0x25, 0x2e, 0x1c, 0xa6, 0xb4, 0xc6, 0xe8, 0xdd, 0x74, 0x1f, 0x4b, 0xbd, 0x8b, 0x8a,
      0x70, 0x3e, 0xb5, 0x66, 0x48, 0x03, 0xf6, 0x0e, 0x61, 0x35, 0x57, 0xb9, 0x86, 0xc1, 0x1d, 0x9e,
      0xe1, 0xf8, 0x98, 0x11, 0x69, 0xd9, 0x8e, 0x94, 0x9b, 0x1e, 0x87, 0xe9, 0xce, 0x55, 0x28, 0xdf,
      0x8c, 0xa1, 0x89, 0x0d, 0xbf, 0xe6, 0x42, 0x68, 0x41, 0x99, 0x2d, 0x0f, 0xb0, 0x54, 0xbb, 0x16];
    return l;
  })();

  function expandKey256(key) { // key: 32 bytes -> 15 round keys (each 16 bytes as 4 words)
    var rcon = [0x01, 0x02, 0x04, 0x08, 0x10, 0x20, 0x40, 0x80, 0x1b, 0x36];
    var w = new Array(60);
    for (var i = 0; i < 8; i++) w[i] = (key[4 * i] << 24) | (key[4 * i + 1] << 16) | (key[4 * i + 2] << 8) | key[4 * i + 3];
    for (i = 8; i < 60; i++) {
      var t = w[i - 1];
      if (i % 8 === 0) {
        t = ((t << 8) | (t >>> 24)) >>> 0; // rotword
        t = ((SBOX[(t >>> 24) & 255] << 24) | (SBOX[(t >>> 16) & 255] << 16) | (SBOX[(t >>> 8) & 255] << 8) | SBOX[t & 255]) >>> 0;
        t = (t ^ ((rcon[i / 8 - 1] << 24) >>> 0)) >>> 0;
      } else if (i % 8 === 4) {
        t = ((SBOX[(t >>> 24) & 255] << 24) | (SBOX[(t >>> 16) & 255] << 16) | (SBOX[(t >>> 8) & 255] << 8) | SBOX[t & 255]) >>> 0;
      }
      w[i] = (w[i - 8] ^ t) >>> 0;
    }
    var rks = [];
    for (i = 0; i < 15; i++) rks.push([w[4 * i], w[4 * i + 1], w[4 * i + 2], w[4 * i + 3]]);
    return rks;
  }

  var xtime = function (x) { return ((x << 1) ^ ((x & 0x80) ? 0x1b : 0)) & 0xff; };

  function aesEncryptBlock(rks, inBytes16) { // returns 16 bytes
    var s = inBytes16.slice();
    var rk = rks[0];
    for (var i = 0; i < 16; i++) s[i] ^= (rk[i >> 2] >>> (24 - (i % 4) * 8)) & 255;

    for (var round = 1; round <= 14; round++) {
      // SubBytes
      for (i = 0; i < 16; i++) s[i] = SBOX[s[i]];
      // ShiftRows (state column-major: s[c*4+r])
      var t;
      // row1 shift left 1
      t = s[1]; s[1] = s[5]; s[5] = s[9]; s[9] = s[13]; s[13] = t;
      // row2 shift left 2
      t = s[2]; s[2] = s[10]; s[10] = t; t = s[6]; s[6] = s[14]; s[14] = t;
      // row3 shift left 3
      t = s[15]; s[15] = s[11]; s[11] = s[7]; s[7] = s[3]; s[3] = t;
      // MixColumns (skip on last round)
      if (round !== 14) {
        for (var c = 0; c < 4; c++) {
          var a0 = s[c * 4], a1 = s[c * 4 + 1], a2 = s[c * 4 + 2], a3 = s[c * 4 + 3];
          var x0 = xtime(a0), x1 = xtime(a1), x2 = xtime(a2), x3 = xtime(a3);
          s[c * 4]     = x0 ^ (a1 ^ x1) ^ a2 ^ a3;
          s[c * 4 + 1] = a0 ^ x1 ^ (a2 ^ x2) ^ a3;
          s[c * 4 + 2] = a0 ^ a1 ^ x2 ^ (a3 ^ x3);
          s[c * 4 + 3] = (a0 ^ x0) ^ a1 ^ a2 ^ x3;
        }
      }
      // AddRoundKey
      rk = rks[round];
      for (i = 0; i < 16; i++) s[i] ^= (rk[i >> 2] >>> (24 - (i % 4) * 8)) & 255;
    }
    return s;
  }

  /* AES-256-CTR 加密方向 = 解密方向(对称) */
  function aesCtr(key32, iv16, data) {
    var rks = expandKey256(key32);
    var out = new Array(data.length);
    var counter = iv16.slice();
    for (var off = 0; off < data.length; off += 16) {
      var ks = aesEncryptBlock(rks, counter);
      var n = Math.min(16, data.length - off);
      for (var i = 0; i < n; i++) out[off + i] = data[off + i] ^ ks[i];
      // counter +1 (big-endian over full 16 bytes)
      for (i = 15; i >= 0; i--) { counter[i] = (counter[i] + 1) & 255; if (counter[i]) break; }
    }
    return out;
  }

  /* ---------- 编解码工具 ---------- */
  function hexToBytes(h) { var o = []; for (var i = 0; i < h.length; i += 2) o.push(parseInt(h.substr(i, 2), 16)); return o; }
  function b64ToBytes(b64) {
    var bin = atob(b64), o = [];
    for (var i = 0; i < bin.length; i++) o.push(bin.charCodeAt(i));
    return o;
  }
  function strToBytes(s) {
    var utf8 = unescape(encodeURIComponent(s)), o = [];
    for (var i = 0; i < utf8.length; i++) o.push(utf8.charCodeAt(i));
    return o;
  }
  function bytesToStr(b) { return decodeURIComponent(escape(String.fromCharCode.apply(null, b))); }
  function constTimeEq(a, b) {
    if (a.length !== b.length) return false;
    var r = 0;
    for (var i = 0; i < a.length; i++) r |= a[i] ^ b[i];
    return r === 0;
  }

  /* ---------- Vault API ---------- */
  var VAULT = (typeof window !== 'undefined' && window.__VAULT__) || { accounts: [] };
  var SESSION_KEY = 'gsw_session_v1';
  var EXTRA_KEY = 'gsw_extra_accounts_v1'; // 本机激活的开通码账号(仍为密文,需密码解锁)

  function randomBytes(n) {
    var a = new Array(n);
    if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
      var buf = new Uint8Array(n);
      crypto.getRandomValues(buf);
      for (var i = 0; i < n; i++) a[i] = buf[i];
    } else { // 兜底:双轮 Math.random(仅极端场景)
      for (var j = 0; j < n; j++) a[j] = Math.floor(Math.random() * 256) ^ Math.floor(Math.random() * 256);
    }
    return a;
  }

  function bytesToB64(bytes) {
    var s = '', CHUNK = 0x8000;
    for (var i = 0; i < bytes.length; i += CHUNK) {
      s += String.fromCharCode.apply(null, bytes.slice(i, i + CHUNK));
    }
    return btoa(s);
  }

  /* 与 decryptAccount 对称:由密码+数据对象生成保险箱账号(浏览器端开号) */
  function encryptAccount(user, displayName, password, dataObj) {
    var salt = randomBytes(16), iv = randomBytes(16);
    var iter = 310000;
    var payload = JSON.stringify(dataObj);
    var dk = pbkdf2(strToBytes(password), salt, iter, 64);
    var encKey = dk.slice(0, 32), macKey = dk.slice(32);
    var pt = strToBytes(payload);
    var ct = aesCtr(encKey, iv, pt);
    var mac = hmacSha256(macKey, iv.concat(ct));
    return {
      user: user, display_name: displayName || user, iter: iter,
      salt: bytesToHex(salt), iv: bytesToHex(iv),
      blob: bytesToB64(ct), mac: bytesToHex(mac),
      created_at: dataObj.created_at || new Date().toISOString().slice(0, 10)
    };
  }

  function bytesToHex(b) {
    var h = '';
    for (var i = 0; i < b.length; i++) h += (b[i] < 16 ? '0' : '') + b[i].toString(16);
    return h;
  }

  function readExtraAccounts() {
    try {
      var raw = localStorage.getItem(EXTRA_KEY);
      var arr = raw ? JSON.parse(raw) : [];
      return Array.isArray(arr) ? arr : [];
    } catch (e) { return []; }
  }

  function writeExtraAccounts(arr) {
    try { localStorage.setItem(EXTRA_KEY, JSON.stringify(arr)); return true; }
    catch (e) { return false; }
  }

  /** 查找账号:内置保险箱优先,其次本机激活账号 */
  function findAccount(user) {
    var builtin = (VAULT.accounts || []).find(function (a) { return a.user === user; });
    if (builtin) return builtin;
    return readExtraAccounts().find(function (a) { return a.user === user; }) || null;
  }

  function decryptAccount(acc, password) {
    var salt = hexToBytes(acc.salt);
    var iv = hexToBytes(acc.iv);
    var ct = b64ToBytes(acc.blob);
    var mac = hexToBytes(acc.mac);
    var iter = acc.iter || 310000;
    var pwBytes = strToBytes(password);
    var dk = pbkdf2(pwBytes, salt, iter, 64);
    var encKey = dk.slice(0, 32), macKey = dk.slice(32);
    var calc = hmacSha256(macKey, iv.concat(ct));
    if (!constTimeEq(calc, mac)) return null;
    var pt = aesCtr(encKey, iv, ct);
    try {
      var obj = JSON.parse(bytesToStr(pt));
      obj._account = { user: acc.user, display_name: acc.display_name };
      return obj;
    } catch (e) { return null; }
  }

  var Auth = {
    current: null, // { user, display_name, data }

    accountCount: function () { return (VAULT.accounts || []).length + readExtraAccounts().length; },

    /** admin 开号:生成保险箱账号并返回开通码(纯密文,不含密码) */
    createAccount: function (opts) {
      var user = (opts.user || '').trim();
      var password = opts.password || '';
      if (!user || !password) return { ok: false, error: '用户名和密码不能为空' };
      if (/\s/.test(user)) return { ok: false, error: '用户名不能含空格' };
      if (findAccount(user)) return { ok: false, error: '用户名已存在(含本机已激活账号)' };
      if (password.length < 10) return { ok: false, error: '密码至少 10 位' };
      var today = new Date().toISOString().slice(0, 10);
      var dataObj = {
        user: user,
        positions: opts.positions || [],
        trades: opts.trades || [],
        updated_at: today,
        created_at: today
      };
      var acc = encryptAccount(user, opts.display_name, password, dataObj);
      var code = bytesToB64(strToBytes(JSON.stringify(acc)));
      return { ok: true, account: acc, code: code };
    },

    /** 登录门激活:解析开通码,校验后存本机(localStorage,仍为密文) */
    activateWithCode: function (codeStr) {
      var raw = (codeStr || '').trim();
      if (!raw) return { ok: false, error: '请粘贴开通码' };
      var acc;
      try {
        acc = JSON.parse(bytesToStr(b64ToBytes(raw)));
      } catch (e) { return { ok: false, error: '开通码格式无效' }; }
      var need = ['user', 'salt', 'iv', 'blob', 'mac'];
      for (var i = 0; i < need.length; i++) {
        if (!acc[need[i]]) return { ok: false, error: '开通码缺少字段 ' + need[i] + ',已拒绝' };
      }
      if ((VAULT.accounts || []).some(function (a) { return a.user === acc.user; })) {
        return { ok: false, error: '该账号已是网站内置账号,直接登录即可' };
      }
      var extra = readExtraAccounts().filter(function (a) { return a.user !== acc.user; });
      extra.push(acc);
      if (!writeExtraAccounts(extra)) return { ok: false, error: '本机存储失败,无法激活' };
      return { ok: true, user: acc.user, display_name: acc.display_name || acc.user, permanent: false };
    },

    /** 本机已激活账号列表(用户名+显示名) */
    activatedList: function () {
      return readExtraAccounts().map(function (a) { return { user: a.user, display_name: a.display_name || a.user }; });
    },

    /** 移除本机激活账号 */
    removeActivated: function (user) {
      var left = readExtraAccounts().filter(function (a) { return a.user !== user; });
      return writeExtraAccounts(left);
    },

    login: function (user, password) {
      var acc = findAccount(user);
      if (!acc) return { ok: false, error: '账号不存在' };
      var data = decryptAccount(acc, password);
      if (!data) return { ok: false, error: '用户名或密码错误' };
      Auth.current = { user: user, display_name: data._account.display_name || user, data: data };
      try {
        sessionStorage.setItem(SESSION_KEY, JSON.stringify({ user: user, data: data }));
      } catch (e) { /* 忽略存储失败 */ }
      return { ok: true };
    },

    restoreSession: function () {
      try {
        var raw = sessionStorage.getItem(SESSION_KEY);
        if (!raw) return false;
        var s = JSON.parse(raw);
        if (s && s.user && s.data) {
          Auth.current = { user: s.user, display_name: (s.data._account && s.data._account.display_name) || s.user, data: s.data };
          return true;
        }
      } catch (e) { /* 忽略 */ }
      return false;
    },

    logout: function () {
      Auth.current = null;
      try { sessionStorage.removeItem(SESSION_KEY); } catch (e) { /* 忽略 */ }
    }
  };

  window.Auth = Auth;
  /* 同时挂到 AIInvest 命名空间,保证 app.js 等模块的 global.Auth 引用可用 */
  if (typeof window.AIInvest !== 'undefined') { window.AIInvest.Auth = Auth; }
  /* 测试导出口(对拍用,无安全影响) */
  window.__crypto_test = {
    sha256Bytes: sha256Bytes,
    hmacSha256: hmacSha256,
    pbkdf2: pbkdf2,
    aesCtr: aesCtr,
    hexToBytes: hexToBytes,
    b64ToBytes: b64ToBytes,
    strToBytes: strToBytes,
    bytesToStr: bytesToStr
  };
})();
