// my suggested inline ascii-safe unicode escape
// this is ES6 \u{X} without the \u
function quote_cp(cp) {
	return `{${cp.toString(16).toUpperCase()}}`;
}

function escape_unicode(s) {
	return s.replace(/[^\.\-a-z0-9]/igu, x => quote_cp(x.codePointAt(0)));
}

function explode_cp(s) {
	return [...s].map(c => c.codePointAt(0));
}

// this is a polyfill for normalized forms
// it exists because the ES6 implementation fails many tests
// see: https://adraffy.github.io/ens-normalize.js/test/report-nf.html
// but lib-nf.js is approx 13KB as of 20211221

function norm(form, cps) {
	return explode_cp(String.fromCodePoint(...cps).normalize(form));
}

function nfc(cps) { return norm('NFC', cps); }

// https://datatracker.ietf.org/doc/html/rfc3492
// adapted from https://github.com/mathiasbynens/punycode.js
// puny format: "xn--{ascii}-{0-9a-z}"
// this function receives normalized cps such that:
// * no uppercase 
// * no overflow (#section-6.4)

function puny_decode(cps) {
	let ret = [];
	let pos = cps.lastIndexOf(0x2D); // hyphen
	for (let i = 0; i < pos; i++) {
		let cp = cps[i];
		if (cp >= 0x80) throw new Error('expected ASCII');
		ret.push(cp);
	}
	pos++; // skip hyphen
	// #section-5
	const BASE = 36; 
	const T_MIN = 1;
	const T_MAX = 26;
	const SKEW = 38;
	const DAMP = 700;
	const MAX_DELTA = (BASE - T_MIN) * T_MAX >> 1;
	let i = 0, n = 128, bias = 72;
	while (pos < cps.length) {
		let prev = i;
		for (let w = 1, k = BASE; ; k += BASE) {
			if (pos >= cps.length) throw new Error(`invalid encoding`);
			let cp = cps[pos++];
			if (cp >= 0x30 && cp <= 0x39) { // 0-9
				cp -= 0x16; // 26 + (code - 0x30)
			} else if (cp >= 0x61 && cp <= 0x7A) { // a-z
				cp -= 0x61;
			} else {
				throw new Error(`invalid character ${cp}`);
			}
			i += cp * w;
			const t = k <= bias ? T_MIN : (k >= bias + T_MAX ? T_MAX : k - bias);
			if (cp < t) break;
			w *= BASE - t;
		}
		let len = ret.length + 1;
		let delta = prev == 0 ? (i / DAMP)|0 : (i - prev) >> 1;
		delta += (delta / len)|0;
		let k = 0;
		for (; delta > MAX_DELTA; k += BASE) {
			delta = (delta / (BASE - T_MIN))|0;
		}
		bias = (k + (BASE - T_MIN + 1) * delta / (delta + SKEW))|0;
		n += (i / len)|0;
		i %= len;
		ret.splice(i++, 0, n);
	}	
	return ret;
}

function decode_arithmetic(bytes) {
	let pos = 0;
	function u16() { return (bytes[pos++] << 8) | bytes[pos++]; }
	
	// decode the frequency table
	let symbol_count = u16();
	let total = 1;
	let acc = [0, 1]; // first symbol has frequency 1
	for (let i = 1; i < symbol_count; i++) {
		acc.push(total += u16());
	}

	// skip the sized-payload that the last 3 symbols index into
	let skip = u16();
	let pos_payload = pos;
	pos += skip;

	let read_width = 0;
	let read_buffer = 0; 
	function read_bit() {
		if (read_width == 0) {
			// this will read beyond end of buffer
			// but (undefined|0) => zero pad
			read_buffer = (read_buffer << 8) | bytes[pos++];
			read_width = 8;
		}
		return (read_buffer >> --read_width) & 1;
	}

	const N = 31;
	const FULL = 2**N;
	const HALF = FULL >>> 1;
	const QRTR = HALF >> 1;
	const MASK = FULL - 1;

	// fill register
	let register = 0;
	for (let i = 0; i < N; i++) register = (register << 1) | read_bit();

	let symbols = [];
	let low = 0;
	let range = FULL; // treat like a float
	while (true) {
		let value = Math.floor((((register - low + 1) * total) - 1) / range);
		let start = 0;
		let end = symbol_count;
		while (end - start > 1) { // binary search
			let mid = (start + end) >>> 1;
			if (value < acc[mid]) {
				end = mid;
			} else {
				start = mid;
			}
		}
		if (start == 0) break; // first symbol is end mark
		symbols.push(start);
		let a = low + Math.floor(range * acc[start]   / total);
		let b = low + Math.floor(range * acc[start+1] / total) - 1;
		while (((a ^ b) & HALF) == 0) {
			register = (register << 1) & MASK | read_bit();
			a = (a << 1) & MASK;
			b = (b << 1) & MASK | 1;
		}
		while (a & ~b & QRTR) {
			register = (register & HALF) | ((register << 1) & (MASK >>> 1)) | read_bit();
			a = (a << 1) ^ HALF;
			b = ((b ^ HALF) << 1) | HALF | 1;
		}
		low = a;
		range = 1 + b - a;
	}
	let offset = symbol_count - 4;
	return symbols.map(x => { // index into payload
		switch (x - offset) {
			case 3: return offset + 0x10100 + ((bytes[pos_payload++] << 16) | (bytes[pos_payload++] << 8) | bytes[pos_payload++]);
			case 2: return offset + 0x100 + ((bytes[pos_payload++] << 8) | bytes[pos_payload++]);
			case 1: return offset + bytes[pos_payload++];
			default: return x - 1;
		}
	});
}	

// returns an iterator which returns the next symbol
function decode_payload(s) {
	let values = decode_arithmetic(Uint8Array.from(atob(s), c => c.charCodeAt(0)));
	let pos = 0;
	return () => values[pos++];
}

// eg. [0,1,2,3...] => [0,-1,1,-2,...]
function signed(i) { 
	return (i & 1) ? (~i >> 1) : (i >> 1);
}

function read_counts(n, next) {
	let v = Array(n);
	for (let i = 0; i < n; i++) v[i] = 1 + next();
	return v;
}

function read_ascending(n, next) {
	let v = Array(n);
	for (let i = 0, x = -1; i < n; i++) v[i] = x += 1 + next();
	return v;
}

function read_deltas(n, next) {
	let v = Array(n);
	for (let i = 0, x = 0; i < n; i++) v[i] = x += signed(next());
	return v;
}

// returns [[x, n], ...] s.t. [x,3] == [x,x+1,x+2]
function read_member_table(next) {
	let v1 = read_ascending(next(), next);
	let n = next();
	let vX = read_ascending(n, next);
	let vN = read_counts(n, next);
	return [
		...v1.map(x => [x, 1]),
		...vX.map((x, i) => [x, vN[i]])
	].sort((a, b) => a[0] - b[0]);
}

// returns array of 
// [x, ys] => single replacement rule
// [x, ys, n, dx, dx] => linear map
function read_mapped_table(next) {
	let ret = [];
	while (true) {
		let w = next();
		if (w == 0) break;
		ret.push(read_linear_table(w, next));
	}
	while (true) {
		let w = next() - 1;
		if (w < 0) break;
		ret.push(read_replacement_table(w, next));
	}
	return ret.flat().sort((a, b) => a[0] - b[0]);
}

function read_ys_transposed(n, w, next) {
	let m = [read_deltas(n, next)];
	for (let j = 1; j < w; j++) {
		let v = Array(n);
		let prev = m[j - 1];
		for (let i = 0; i < n; i++) {
			v[i] = prev[i] + signed(next());
		}
		m.push(v);
	}
	return m;
}

function read_replacement_table(w, next) { 
	let n = 1 + next();
	let vX = read_ascending(n, next);
	let mY = read_ys_transposed(n, w, next);
	return vX.map((x, i) => [x, mY.map(v => v[i])])
}

function read_linear_table(w, next) {
	let dx = 1 + next();
	let dy = next();
	let n = 1 + next();
	let vX = read_ascending(n, next);
	let vN = read_counts(n, next);
	let mY = read_ys_transposed(n, w, next);
	return vX.map((x, i) => [x, mY.map(v => v[i]), vN[i], dx, dy]);
}

/*
export function read_zwj_emoji(next) {
	let buckets = [];
	for (let k = next(); k > 0; k--) {
		let n = 1 + next(); // group size
		let w = 1 + next(); // group width w/o ZWJ
		let p = 1 + next(); // bit positions of zwj
		let z = []; // position of zwj
		let m = []; // emoji vectors
		for (let i = 0; i < n; i++) m.push([]);
		for (let i = 0; i < w; i++) {
			if (p & (1 << (i - 1))) {
				w++; // increase width
				z.push(i); // remember position
				m.forEach(v => v.push(0x200D)); // insert zwj
			} else {
				read_deltas(n, next).forEach((x, i) => m[i].push(x));
			}
		}
		for (let b of z) {
			let bucket = buckets[b];
			if (!bucket) buckets[b] = bucket = [];
			bucket.push(...m);
		}
	}
	return buckets;
}

export function read_emoji(next, sep) {
	let ret = {};
	for (let k = next(); k > 0; k--) {
		let n = 1 + next(); // group size
		let w = 1 + next(); // group width w/o sep
		let p = 1 + next(); // bit positions of sep
		let z = []; // position of sep
		let m = []; // emoji vectors
		for (let i = 0; i < n; i++) m.push([]);
		for (let i = 0; i < w; i++) {
			if (p & (1 << (i - 1))) {
				w++; // increase width
				z.push(i); // remember position
				m.forEach(v => v.push(sep)); // insert 
			} else {
				read_deltas(n, next).forEach((x, i) => m[i].push(x));
			}
		}
		for (let v of m) {
			let bucket = ret[v[0]];
			if (!bucket) bucket = ret[v[0]] = [];
			bucket.push(v.slice(1));
		}
	}
	for (let bucket of Object.values(ret)) {
		bucket.sort((a, b) => b.length - a.length);
	}
	return ret;
}
*/

function lookup_member(table, cp) {
	for (let [x, n] of table) {
		let d = cp - x;
		if (d < 0) break;
		if (d < n) return true;
	}
	return false;
}

function lookup_mapped(table, cp) {
	for (let [x, ys, n, dx, dy] of table) {
		let d = cp - x;
		if (d < 0) break;
		if (n > 0) {
			if (d < dx * n && d % dx == 0) {
				let r = d / dx;
				return ys.map(y => y + r * dy);
			} 
		} else if (d == 0) {
			return ys;
		}
	}
}

var PAYLOAD$2 = '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';

let r$2 = decode_payload(PAYLOAD$2);
const COMBINING_MARKS = read_member_table(r$2);
const IGNORED = read_member_table(r$2);
const DISALLOWED = read_member_table(r$2);
const MAPPED = read_mapped_table(r$2);

function is_disallowed(cp) {
	return lookup_member(DISALLOWED, cp);
}
function is_ignored(cp) {
	return lookup_member(IGNORED, cp);
}
function is_combining_mark(cp) {
	return lookup_member(COMBINING_MARKS, cp);
}

// this returns [[]] if empty
function tokenized_idna(cps, validate = false, emoji_parser = false) {
	let chars = [];
	let tokens = [];
	let labels = [tokens];
	function drain() { 
		while (true) {
			let pos = chars.indexOf(0x2E); // split the chars at each stop
			if (pos == -1) break;
			if (pos > 0) tokens.push({t: chars.slice(0, pos)}); // before the stop
			tokens = [];  // create a new label
			labels.push(tokens);
			chars = chars.slice(pos + 1);
		}
		if (chars.length > 0) {
			tokens.push({t: chars}); // after the stop
			chars = [];
		}
	}
	for (let i = 0; i < cps.length; i++) {
		if (emoji_parser) {
			let [len, e] = emoji_parser(cps, i);
			if (len > 0) {
				drain();
				tokens.push({e}); // these are emoji tokens
				i += len - 1;
				continue;
			}
		} 
		let cp = cps[i];
		if (is_disallowed(cp)) {
			// disallowed: Leave the code point unchanged in the string, and record that there was an error.
			if (validate) break; // fail early
			throw new Error(`Disallowed character "${escape_unicode(String.fromCodePoint(cp))}"`);
		} else if (is_ignored(cp)) {
			// ignored: Remove the code point from the string. This is equivalent to mapping the code point to an empty string.		
			if (validate) break; // fail early
		} else if (validate) {
			// With either Transitional or Nontransitional Processing, sources already in Punycode are validated without mapping. 
			// In particular, Punycode containing Deviation characters, such as href="xn--fu-hia.de" (for fuß.de) is not remapped. 
			// This provides a mechanism allowing explicit use of Deviation characters even during a transition period. 
			chars.push(cp);
		} else {
			// mapped: Replace the code point in the string by the value for the mapping in Section 5, IDNA Mapping Table.
			// deviation: Leave the code point unchanged in the string.
			// valid: Leave the code point unchanged in the string.
			chars.push(...(lookup_mapped(MAPPED, cp) ?? [cp]));
		}
	}
	drain();
	return labels;
}

var PAYLOAD$1 = 'ABIAAQB6AEAAOAAoACYAHwAiABgAFgAOAAsACwAMAY8AfgADApRonwQDRkWQ3QAuAiUsAiIvBhU4AiUsJi8kKTYseCU6THF1fq0BBhoII4t62iwOppXxAggMZXl0EsSlI08hJQIm4E4iAtIB79QGUASzYEOiTVaSUvcJTQB0XwF4jlgA6ew/UKmGaYIABxsLHETXAfIAdP8hPSx8N2c2HCEwIwpPAQJQEhAxFgIxDAk4Bc1bBw8sEmFTBF4FQUoAhQwEBQHJAqYREREzAzNrjAPPMi5BJyYGEy4uiwe5AT8NJ1cLEOIBO2B0xxtDACaQDTcSKidebh9SBREAygJuBXwdngEwAHiMLacsJTgYRCcEV54OLBy5YuEOSGJe+fOKGCMHIgCJSwltQgBUFC41sTEDUEv/EVEhASgDFokGryxRBFAE+wCtBNVlCxXN0WEeBgwJERUQMRIRAwEBAAcfCAEoIwACUeEMBRKVIhs4xw8OcpTxFKQAhAF+IwUcFhMYABsJEgJBaAkYCAAOV1iOqmFxBIwUAEQBIQ4QLdgnARcAEgBKEyQTAjUFEqYbAgBBFw5ylPEODgO9FgUUEB5qCSxuZxMKCA5jWI6qYXEEhhoASQEgEhAz2CgPUA8kEgoEDEoTIwMUBgM1IQg/cXFxcXFxcXFuYXG7BqGPAX/VESx5eBeJgF4AJ+hdQwT4GwAr+GamVOZx7nFoZv8AmEUEQwCXAEkMLQHvBcwDhzn0Mgb7AvgCcRkkAIsAuokwVSwLAmIGPhgnKACLCRkAEicBAQbgO8+xBTABBxcQJgAEQDf6MASDMBD0HwwoDAsu9wDA6hMtcgxWABIITU3k0SHxGPGp8QBhA+dvYj7xAEEFTY2l8Q8x0RWBKEEG8QtKx0dLASBJGLFQ8QBfWx4AFKXRDyrPFXMcIgEPEjzPFaX2Ao9mHqWFELTTP3p6A6f7Xr5EE2R6Ej3HtIV0adYJhLJ9+stTShtJ4R8UgNAPWt0U+he/ohDJ+AuBs5WPUriHRqVyUMryLbfH9cVl9Vb37ztdowEx0WUt+gLVTQGvMkUqORUp6sP7e55HtUVFs4KDB7A06gkRg/ik+DQt6MqdEffNyVDlbXKlCQYPdZuu35KzmouZEE+uvwR58pbLmOw0kws7Wx+VDS+5p7vG8dRotOFjKDKyy2cbI3i64lt3U6/wo0TIibvJOUBVdSbSjLFlTWX2u/KW7j+HF3x6/UuhFOxbEjbdHSkxAycg/YlPDCbyMQLfHigCMdeWtJD2NWpUfk6BralKEmM3KR0Wr4s0GWoCBxSytxpuJ+l984mZrIwoTRq6ahu7znDRTb+hLRnDqqcI4moRTAOhyWD4YzWKYeRntJBZ4aVfoVNeWuBzy+9oyzvROZ89IGTr/3anZuGn+2G+jzjacEahH3JPOhT8k+LFPClF+c5gMeKg';

let r$1 = decode_payload(PAYLOAD$1);
const JOIN_T = read_member_table(r$1);
const JOIN_LD = read_member_table(r$1);
const JOIN_RD = read_member_table(r$1);
const VIRAMA = read_member_table(r$1);
const SCRIPT_GREEK = read_member_table(r$1);
const SCRIPT_HEBREW = read_member_table(r$1);
const SCRIPT_HKH = read_member_table(r$1);

function validate_context(chunks) {
	// apply relative checks
	for (let cps of chunks) {
		for (let i = 0, e = cps.length - 1; i <= e; i++) {
			switch (cps[i]) {
				case 0x200C: { 
					// ZERO WIDTH NON-JOINER (ZWNJ)
					// ContextJ: https://datatracker.ietf.org/doc/html/rfc5892#appendix-A.1	
					// If Canonical_Combining_Class(Before(cp)) .eq.  Virama Then True;
					if (i > 0 && lookup_member(VIRAMA, cps[i - 1])) continue;
					// If RegExpMatch((Joining_Type:{L,D})(Joining_Type:T)*\u200C(Joining_Type:T)*(Joining_Type:{R,D})) Then True;
					if (i > 0 && i < e) { // there is room on either side
						let head = i - 1;
						while (head > 0 && lookup_member(JOIN_T, cps[head])) head--; // T*
						if (lookup_member(JOIN_LD, cps[head])) { // L or D
							let tail = i + 1;
							while (tail < e && lookup_member(JOIN_T, cps[tail])) tail++; // T*
							if (lookup_member(JOIN_RD, cps[tail])) { // R or D
								continue;
							}
						}
					}
					break;
				}
				case 0x200D: {
					// ZERO WIDTH JOINER (ZWJ)
					// ContextJ: https://datatracker.ietf.org/doc/html/rfc5892#appendix-A.2
					// If Canonical_Combining_Class(Before(cp)) .eq.  Virama Then True;
					if (i > 0 && lookup_member(VIRAMA, cps[i-1])) continue;
					break;
				}
				case 0x00B7: {
					// MIDDLE DOT
					// ContextO: https://datatracker.ietf.org/doc/html/rfc5892#appendix-A.3
					// Between 'l' (U+006C) characters only, used to permit the Catalan
					// character ela geminada to be expressed.
					if (i > 0 && i < e && cps[i-1] == 0x6C && cps[i+1] == 0x6C) continue; 
					break;
				}
				case 0x0375: {
					// GREEK LOWER NUMERAL SIGN (KERAIA)
					// ContextO: https://datatracker.ietf.org/doc/html/rfc5892#appendix-A.4
					// The script of the following character MUST be Greek.
					if (i < e && lookup_member(SCRIPT_GREEK, cps[i+1])) continue; 
					break;
				}
				case 0x05F3:
					// HEBREW PUNCTUATION GERESH
					// ContextO: https://datatracker.ietf.org/doc/html/rfc5892#appendix-A.5
					// The script of the preceding character MUST be Hebrew.
				case 0x05F4: {
					// HEBREW PUNCTUATION GERSHAYIM
					// ContextO: https://datatracker.ietf.org/doc/html/rfc5892#appendix-A.6		
					// The script of the preceding character MUST be Hebrew.
					if (i > 0 && lookup_member(SCRIPT_HEBREW, cps[i-1])) continue;
					break;
				}
				default: continue;
			}
			// the default behavior above is to continue if the context is valid
			// we only fall-through if no context was matched
			throw new Error(`No context for "${escape_unicode(String.fromCodePoint(cps[i]))}"`);
		}
	}
	// apply global checks
	let cps = chunks.flat();
	// 
	// ARABIC-INDIC DIGITS
	// ContextO: https://datatracker.ietf.org/doc/html/rfc5892#appendix-A.8
	// Can not be mixed with Extended Arabic-Indic Digits.
	// For All Characters: If cp .in. 06F0..06F9 Then False; End For;
	// EXTENDED ARABIC-INDIC DIGITS
	// ContextO: https://datatracker.ietf.org/doc/html/rfc5892#appendix-A.9
	// Can not be mixed with Arabic-Indic Digits.
	// For All Characters: If cp .in. 0660..0669 Then False; End For
	if (cps.some(cp => cp >= 0x0660 && cp <= 0x0669) && cps.some(cp => cp >= 0x06F0 && cp <= 0x06F9)) {
		throw new Error(`Disallowed arabic-indic digit mixture`);
	}
	// KATAKANA MIDDLE DOT
	// ContextO: https://datatracker.ietf.org/doc/html/rfc5892#appendix-A.7
	// For All Characters: If Script(cp) .in. {Hiragana, Katakana, Han} Then True; End For;
	if (cps.includes(0x30FB) && !cps.every(cp => cp == 0x30FB || lookup_member(SCRIPT_HKH, cp))) {
		throw new Error(`Disallowed katakana`);
	}
}

var PAYLOAD = 'AA4ABgA0ACQADQARAAoAEAALAAcADQClABIABwDeAPDcDyYZQZ8faQza/5zoMqxDCxYIEwMWHhE/BAQChgPQAgFPALxgwLSBCgFKAdgJFgkazRP1AD9yC10fGABnCgBmxATotEYJAwEFDA4JAgsGIBUFEgoAlADGCwDFKhUWZSYTpRlXBRwbQgIdAA5JPxQJDwIGBAATQy0ZCAED4gAiBQ0mOReHBRUFBQUAAQkPDxdWAxkZQAoNSDQNQBgFASUyBhcSAB8yAgDy8QglE9EAy4E3qggOxQsACBIBATUMRjkMJgAAy61tFRDkFqVeAVkNAW4K5yIACAIM/xZUAVZnt/QwxGkR2dUaO+BrLm0nUYc3bNEmAqYWRfTUIhzb5VknAZECFLn+A0WP9qTsVAifJJ3u95mDKp2SBpiQDbJgWxIogCB8nRlYeVGreT1qtqoEwLpNQlIiWO3Y/7BBUUSrg1n9TV6ZoURMAIJ55pWAptGZF598MWnRXScnYTBVGGc=';

let r = decode_payload(PAYLOAD);
const REGIONAL = read_member_table(r);
const KEYCAP_OG = read_member_table(r);
const KEYCAP_FIXED = read_member_table(r);const EMOJI_OPT = read_member_table(r);
const EMOJI_REQ = read_member_table(r);
const MODIFIER = read_member_table(r);
const MODIFIER_BASE = read_member_table(r);
const TAG_SPEC = read_member_table(r);

const FE0F = 0xFE0F;
const ZWJ = 0x200D;
const KEYCAP_END = 0x20E3;
const TAG_END = 0xE007F;

function find_emoji_chr_mod_pre(cps, pos) {
	let cp = cps[pos];
	let cp2 = cps[pos+1]; // out of bounds, but unassigned
	// emoji_modifier_sequence := emoji_modifier_base emoji_modifier
	let base = lookup_member(MODIFIER_BASE, cp);
	if (base && cp2 && lookup_member(MODIFIER, cp2)) {
		return [2, [cp, cp2]];
	}
	// emoji_modifier_base is a emoji_character 
	// emoji_presentation_sequence := emoji_character \x{FE0F}
	// but some emoji dont need presentation
	// and previously valid emoji are already registered
	// we call these emoji optional
	let opt = base || lookup_member(EMOJI_OPT, cp); 
	if (cp2 == FE0F) {
		// these have optional FE0F 
		if (opt) return [2, [cp]]; // drop FE0F
		// these require FE0F
		// these are the new emoji 
		// all future emoji should be added 
		// through this mechanism, if appropriate 
		if (lookup_member(EMOJI_REQ, cp)) return [2, [cp, FE0F]]; // keep FE0F
	}
	// emoji_character 
	// we also allow single regional 
	if (base || opt || lookup_member(REGIONAL, cp) || lookup_member(MODIFIER, cp)) {
		return [1, [cp]];	
	}
}

function consume_emoji_sequence(cps, pos) {
	let cp = cps[pos];
	let len = cps.length;
	// [ED-14] emoji flag sequence
	// https://www.unicode.org/reports/tr51/#def_emoji_flag_sequence
	// A sequence of two Regional Indicator characters, where the corresponding ASCII characters are valid region sequences as specified 
	if (pos+1 < len && lookup_member(REGIONAL, cp)) {
		// emoji_flag_sequence := regional_indicator regional_indicator
		let cp2 = cps[pos+1];
		if (lookup_member(REGIONAL, cp2)) {
			return [2, [cp, cp2]];
		}
	} 
	// [ED-14c] emoji keycap sequence
	// https://unicode.org/reports/tr51/#def_emoji_keycap_sequence
	// A sequence of the following form: 
	// emoji_keycap_sequence := [0-9#*] \x{FE0F 20E3}
	let keycap_og = lookup_member(KEYCAP_OG, cp);
	if (pos+1 < len && keycap_og && cps[pos+1] == KEYCAP_END) {
		return [2, [cp, KEYCAP_END]];
	} else if (pos+2 < len && (keycap_og || lookup_member(KEYCAP_FIXED, cp)) && cps[pos+1] == FE0F && cps[pos+2] == KEYCAP_END) {
		return [3, keycap_og ? [cp, KEYCAP_END] : [cp, FE0F, KEYCAP_END]];		
	}
	// [ED-15] emoji core sequence
	// emoji_core_sequence := emoji_character | emoji_presentation_sequence | emoji_keycap_sequence | emoji_modifier_sequence | emoji_flag_sequence 
	// [ED-15a] emoji zwj element
	// emoji_zwj_element := emoji_character | emoji_presentation_sequence | emoji_modifier_sequence
	// [ED-16] emoji zwj sequence 
	// emoji_zwj_sequence := emoji_zwj_element ( \x{200d} emoji_zwj_element )+
	// [ED-17] emoji sequence
	// emoji_sequence := emoji_core_sequence | emoji_zwj_sequence | emoji_tag_sequence 
	let emoji0 = find_emoji_chr_mod_pre(cps, pos);
	if (!emoji0) return [0];
	let [pos2, stack] = emoji0;
	pos2 += pos;
	let zwj = false;
	while (pos2+1 < len && cps[pos2] === ZWJ) {
		let emoji = find_emoji_chr_mod_pre(cps, pos2 + 1);
		if (!emoji) break;
		zwj = true;
		pos2 += 1 + emoji[0];
		stack.push(ZWJ, ...emoji[1]);
	}
	if (!zwj) {
		// [ED-14a] emoji tag sequence (ETS) 
		// https://www.unicode.org/reports/tr51/#def_emoji_tag_sequence
		// A sequence of the following form:
		//  emoji_tag_sequence := tag_base tag_spec tag_end
		//   tag_base := emoji_character 
		//             | emoji_modifier_sequence     => emoji_modifier_base emoji_modifier
		//             | emoji_presentation_sequence => emoji_character \x{FE0F}
		//   tag_spec := [\x{E0020}-\x{E007E}]+
		//   tag_end  := \x{E007F}		
		if (pos2+2 < len && lookup_member(TAG_SPEC, cps[pos2])) {
			let pos3 = pos2 + 1;
			while (pos3+1 < len && lookup_member(TAG_SPEC, cps[pos3])) pos3++;
			if (cps[pos3++] == TAG_END) {
				// these are crazy dangerous because they don't render
				// ignore the sequence
				// return [pos3 - pos, stack.concat(cps.slice(pos2, pos3 - pos2))];
				return [pos3 - pos, stack];
			}
		}
	}
	return [pos2 - pos, stack];}

// built: 2021-12-22T11:29:42.663Z



function flatten_label_tokens(tokens) {
	return tokens.flatMap(token => token.e ?? nfc(token.t));
}

function label_error(cps, message) {
	return new Error(`Disallowed label "${escape_unicode(String.fromCodePoint(...cps))}": ${message}`);
}

// Primary API
// throws TypeError if not a string
// throws Error if not normalizable
// returns a string ready for namehash
function ens_normalize(name) { 
	// https://github.com/ethereum/EIPs/blob/master/EIPS/eip-137.md
	// "UTS46 with the options transitional=false and useSTD3AsciiRules=true."
	// see: build-tables.js
	// assumptions:
	// * CheckHyphens = true
	// * CheckJoiners = true
	// * CheckBidi = unknown
	// https://unicode.org/reports/tr46/#Processing
	// https://unicode.org/reports/tr46/#Validity_Criteria
	// [Processing] 1.) Map
	// [Processing] 2.) Normalize: Normalize the domain_name string to Unicode Normalization Form C.
	// [Processing] 3.) Break: Break the string into labels at U+002E ( . ) FULL STOP.
	const HYPHEN = 0x2D; // HYPHEN MINUS	
	// note: idna will throw
	let labels = tokenized_idna(explode_cp(name), false, consume_emoji_sequence).map(tokens => {
		let cps = flatten_label_tokens(tokens);
		// [Processing] 4.) Convert/Validate
		if (cps.length >= 4 && cps[2] == HYPHEN && cps[3] == HYPHEN) { // "**--"
			if (cps[0] == 0x78 && cps[1] == 0x6E) { // "xn--"
				let cps_decoded;
				try {
					// Attempt to convert the rest of the label to Unicode according to Punycode [RFC3492].
					// If that conversion fails, record that there was an error, and continue with the next label.
					cps_decoded = puny_decode(cps.slice(4));
					// With either Transitional or Nontransitional Processing, sources already in Punycode are validated without mapping. 
					// In particular, Punycode containing Deviation characters, such as href="xn--fu-hia.de" (for fuß.de) is not remapped. 
					// This provides a mechanism allowing explicit use of Deviation characters even during a transition period. 
					tokens = tokenized_idna(cps_decoded, true, consume_emoji_sequence).flat();
					let expected = flatten_label_tokens(tokens);
					if (cps_decoded.length != expected.length || !cps_decoded.every((x, i) => x == expected[i])) throw new Error('not normalized');
				} catch (err) {
					throw label_error(cps, `punycode: ${err.message}`);
				}
				// Otherwise replace the original label in the string by the results of the conversion. 
				cps = cps_decoded;
				// warning: this could be empty
				// warning: this could be **--
			}
		}
		if (cps.length > 0) {
			// [Validity] 1.) The label must be in Unicode Normalization Form NFC.
			// => satsified by nfc()
			// [Validity] 2.) If CheckHyphens, the label must not contain a U+002D HYPHEN-MINUS character in both the third and fourth positions.
			// note: we check this here (rather than above) because puny can expand into "aa--bb"
			if (cps.length >= 4 && cps[2] == HYPHEN && cps[3] == HYPHEN) throw label_error(cps, `invalid label extension`);
			// [Validity] 3.) If CheckHyphens, the label must neither begin nor end with a U+002D HYPHEN-MINUS character.
			if (cps[0] == HYPHEN) throw label_error(cps, `leading hyphen`);
			if (cps[cps.length - 1] == HYPHEN) throw label_error(cps, `trailing hyphen`);		
			// [Validity] 4.) The label must not contain a U+002E ( . ) FULL STOP.
			// => satisfied by [Processing] 3.) Break
			// [Validity] 5.) The label must not begin with a combining mark, that is: General_Category=Mark.
			if (is_combining_mark(cps[0])) throw label_error(cps, `leading combining mark`);
			// [Validity] 6.) For Nontransitional Processing, each value must be either valid or deviation.
			// => satisfied by transform()
			// [Validity] 7.) If CheckJoiners, the label must satisify the ContextJ rules
			// this also does ContextO
			try {
				// emoji are invisible to context rules
				// IDEA: they could get replaced by a space
				validate_context(tokens.map(({t}) => t).filter(x => x));
			} catch (err) {
				throw label_error(cps, err.message);
			}
			// [Validity] 8.) see below
		}
		return tokens;
	});
	// [Validity] 8.) If CheckBidi, and if the domain name is a Bidi domain name, then the label 
	// must satisfy all six of the numbered conditions in [IDNA2008] RFC 5893, Section 2.
	
	return labels.map(tokens => String.fromCodePoint(...flatten_label_tokens(tokens))).join('.');
}

export { ens_normalize };
