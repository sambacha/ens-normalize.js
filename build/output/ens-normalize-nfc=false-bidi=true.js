function arithmetic_decoder(e) {
    let A = 0;
    function r() {
        return e[A++] << 8 | e[A++];
    }
    var t = r();
    let l = 1, a = [ 0, 1 ];
    for (let A = 1; A < t; A++) a.push(l += r());
    var o = r();
    let C = A;
    A += o;
    let i = 0, g = 0;
    function B() {
        return 0 == i && (g = g << 8 | e[A++], i += 8), g >> --i & 1;
    }
    var o = 2 ** 31, n = o >>> 1, s = o - 1;
    let w = 0;
    for (let A = 0; A < 31; A++) w = w << 1 | B();
    let E = [], m = 0, I = o;
    for (;;) {
        var h = Math.floor(((w - m + 1) * l - 1) / I);
        let A = 0, e = t;
        for (;1 < e - A; ) {
            var D = A + e >>> 1;
            h < a[D] ? e = D : A = D;
        }
        if (0 == A) break;
        E.push(A);
        let r = m + Math.floor(I * a[A] / l), o = m + Math.floor(I * a[A + 1] / l) - 1;
        for (;0 == ((r ^ o) & n); ) w = w << 1 & s | B(), r = r << 1 & s, o = o << 1 & s | 1;
        for (;r & ~o & 536870912; ) w = w & n | w << 1 & s >>> 1 | B(), r = r << 1 ^ n, 
        o = (o ^ n) << 1 | n | 1;
        m = r, I = 1 + o - r;
    }
    let Q = t - 4;
    return E.map(A => {
        switch (A - Q) {
          case 3:
            return 65792 + Q + (e[C++] << 16 | e[C++] << 8 | e[C++]);

          case 2:
            return 256 + Q + (e[C++] << 8 | e[C++]);

          case 1:
            return Q + e[C++];

          default:
            return A - 1;
        }
    });
}

const VERSION = "1.2.0", UNICODE = "14.0.0";

class Decoder {
    constructor(A) {
        this.pos = 0, this.values = A;
    }
    read() {
        return this.values[this.pos++];
    }
    read_signed() {
        var A = this.read();
        return 1 & A ? ~A >> 1 : A >> 1;
    }
    read_counts(e) {
        let r = Array(e);
        for (let A = 0; A < e; A++) r[A] = 1 + this.read();
        return r;
    }
    read_ascending(r) {
        let o = Array(r);
        for (let A = 0, e = -1; A < r; A++) o[A] = e += 1 + this.read();
        return o;
    }
    read_deltas(r) {
        let o = Array(r);
        for (let A = 0, e = 0; A < r; A++) o[A] = e += this.read_signed();
        return o;
    }
    read_member_tables(e) {
        let r = [];
        for (let A = 0; A < e; A++) r.push(this.read_member_table());
        return r;
    }
    read_member_table() {
        let A = this.read_ascending(this.read());
        var e = this.read();
        let r = this.read_ascending(e), o = this.read_counts(e);
        return [ ...A.map(A => [ A, 1 ]), ...r.map((A, e) => [ A, o[e] ]) ].sort((A, e) => A[0] - e[0]);
    }
    read_mapped_table() {
        let A = [];
        for (;;) {
            var e = this.read();
            if (0 == e) break;
            A.push(this.read_linear_table(e));
        }
        for (;;) {
            var r = this.read() - 1;
            if (r < 0) break;
            A.push(this.read_mapped_replacement(r));
        }
        return A.flat().sort((A, e) => A[0] - e[0]);
    }
    read_ys_transposed(r, e) {
        let o = [ this.read_deltas(r) ];
        for (let A = 1; A < e; A++) {
            let e = Array(r);
            var t = o[A - 1];
            for (let A = 0; A < r; A++) e[A] = t[A] + this.read_signed();
            o.push(e);
        }
        return o;
    }
    read_mapped_replacement(A) {
        var e = 1 + this.read();
        let r = this.read_ascending(e), o = this.read_ys_transposed(e, A);
        return r.map((A, e) => [ A, o.map(A => A[e]) ]);
    }
    read_linear_table(A) {
        let r = 1 + this.read(), o = this.read();
        var e = 1 + this.read();
        let t = this.read_ascending(e), l = this.read_counts(e), a = this.read_ys_transposed(e, A);
        return t.map((A, e) => [ A, a.map(A => A[e]), l[e], r, o ]);
    }
    read_emoji() {
        let t = [];
        for (let A = this.read(); 0 < A; A--) {
            var l = 1 + this.read();
            let e = 1 + this.read();
            var a, C = 1 + this.read();
            let r = [], o = [];
            for (let A = 0; A < l; A++) o.push([]);
            for (let A = 0; A < e; A++) C & 1 << A - 1 ? (e++, r.push(A), o.forEach(A => A.push(8205))) : this.read_deltas(l).forEach((A, e) => o[e].push(A));
            for (a of r) {
                let A = t[a];
                A || (t[a] = A = []), A.push(...o);
            }
        }
        return t;
    }
}

function lookup_mapped(l, a) {
    for (let [ A, r, e, o, t ] of l) {
        var C = a - A;
        if (C < 0) break;
        if (0 < e) {
            if (C < o * e && C % o == 0) {
                let e = C / o;
                return r.map(A => A + e * t);
            }
        } else if (0 == C) return r;
    }
}

function lookup_member(A, e) {
    for (var [ r, o ] of A) {
        r = e - r;
        if (r < 0) break;
        if (r < o) return !0;
    }
    return !1;
}

function escape_unicode(A) {
    return A.replace(/[^\.\-a-z0-9]/giu, A => `{${A.codePointAt(0).toString(16).toUpperCase()}}`);
}

const str_from_cp = String.fromCodePoint;

let r = new Decoder(arithmetic_decoder(Uint8Array.from(atob("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qjuwVaqACmM+jEZEUmlGPt8+4z7fPtk+1T7hPuE+3T7dPt0+3T7bPts+1z7XPtc+1z7hzHDMbsxsI1QzTCJFASMVRQAvOA0zRzkFE043JWIQ39Lf0N/O38zfyt/I38bfxN/C38Df0t/Q387fzN/KNTM1NTUzMzNCA0IPQg/KKsooyibKJMoiyiDKHsocyhrKGMoqyijKJsokyiLKIMoeyhzKGsoYyirKKNzcXgRs7TqnO61Vp4AHYzuMQ0RPaUMfF7oHVAezyOs/JD7BSkIqG65tPs49Ckg+5h5SYg5oPEQwOjwmGCMxMx8pDRD1QhBCJPY+5RYQYQsVcl48JwseqUIDQhMACScnL0ViOB04RScVPBYGBlMIQTHHF2AQX7NAQDI4PBYjJxE5HSNBUDcVWjIXNjALOiAYQiIlFlIVBkhCQgMx1lhgGl81QEIiJ0IDBkEC55AJkE2IApjEApjJApjECCgC55AJlALnkE2IApjIApjJApjKAufWCQgJAueQfgLnkAmQAqRvAphUAAQAnABgagOgtAmtCZACo5kCl94MApoF9gLnjAKaY6QClywqRgBclgFoBPoCpQ+kApcsKkYAXJYBaAT6AqUPpAKXLCpGAFyWAWgE+gKluQKlnAfbCWgCpmMCl4ICmI8ItgKb/gKjqwKcCAE/Ab9ycwLnkAmQAua2TYgCojICojECojICojECojICojECojICojECojICojECojICojECojICojECojICojECojICojECojICojECojICojECojICojECojICojECojICojECojIC55AJkALmth4C55AJkALmtk2IAufWAueQCZAC5rYCAgLyYgmRCZACpG8CmFQABACcAGBqA6C0CakJkALmtgLlyAKYnaQClywqRgBclgFoBPoCpQ+kApcsKkYAXJYBaAT6AqUPpAKXLCpGAFyWAWgE+gKlD6QClywqRgBclgFoBPoCpQ+kApcsKkYAXJYBaAT6AqUPpAKXLCpGAFyWAWgE+gKlD6QClywqRgBclgFoBPoCpQ+kApcsKkYAXJYBaAT6AqUPpAKXLCpGAFyWAWgE+gKlD6QClywqRgBclgFoBPoCpQ+kApcsKkYAXJYBaAT6AqUPpAKXLCpGAFyWAWgE+gKlD6QClywqRgBclgFoBPoCpQ+kApcsKkYAXJYBaAT6AqUPpAKX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"), A => A.charCodeAt(0)))), COMBINING_MARKS = r.read_member_table(), IGNORED = r.read_member_table(), DISALLOWED = r.read_member_table(), JOIN_T = r.read_member_table(), JOIN_LD = r.read_member_table(), JOIN_RD = r.read_member_table(), MAPPED = r.read_mapped_table(), ZWNJ_EMOJI = r.read_emoji(), COMBINING_RANK, VIRAMA, DECOMP, COMP_EXCLUSIONS;

VIRAMA = r.read_member_table();

let BIDI;

BIDI = {
    R_AL: r.read_member_table(),
    L: r.read_member_table(),
    AN: r.read_member_table(),
    EN: r.read_member_table(),
    ECTOB: r.read_member_table(),
    NSM: r.read_member_table()
};

const S0 = 44032, L0 = 4352, V0 = 4449, T0 = 4519, L_COUNT = 19, V_COUNT = 21, T_COUNT = 28, N_COUNT = V_COUNT * T_COUNT, S_COUNT = L_COUNT * N_COUNT, S1 = S0 + S_COUNT, L1 = L0 + L_COUNT, V1 = V0 + V_COUNT, T1 = T0 + T_COUNT;

function is_hangul(A) {
    return A >= S0 && A < S1;
}

function decompose(A, e) {
    if (A < 128) e(A); else if (is_hangul(A)) {
        var r = A - S0, o = r / N_COUNT | 0, t = r % N_COUNT / T_COUNT | 0, r = r % T_COUNT;
        e(L0 + o), e(V0 + t), 0 < r && e(T0 + r);
    } else {
        r = lookup_mapped(DECOMP, A);
        if (r) for (var l of r) decompose(l, e); else e(A);
    }
}

function compose_pair(A, e) {
    if (A >= L0 && A < L1 && e >= V0 && e < V1) {
        var r = A - L0, o = e - V0, o = r * N_COUNT + o * T_COUNT;
        return S0 + o;
    }
    if (is_hangul(A) && e > T0 && e < T1 && (A - S0) % T_COUNT == 0) return A + (e - T0);
    for (var [ t, l ] of DECOMP) if (2 == l.length && l[0] == A && l[1] == e) {
        if (lookup_member(COMP_EXCLUSIONS, t)) break;
        return t;
    }
    return -1;
}

function decomposer(A, r) {
    let o = [];
    function t() {
        o.sort((A, e) => A[0] - e[0]).forEach(([ A, e ]) => r(A, e)), o.length = 0;
    }
    function e(e) {
        var A = 1 + COMBINING_RANK.findIndex(A => lookup_member(A, e));
        0 == A ? (t(), r(A, e)) : o.push([ A, e ]);
    }
    A.forEach(A => decompose(A, e)), t();
}

function nfd(A) {
    return [ ...str_from_cp(A).normalize("NFD") ].map(A => A.codePointAt(0));
}

function nfc(A) {
    return [ ...str_from_cp(A).normalize("NFC") ].map(A => A.codePointAt(0));
}

function puny_decode(o) {
    let r = [], t = o.lastIndexOf(45);
    for (let A = 0; A < t; A++) {
        var e = o[A];
        if (128 <= e) throw new Error("expected ASCII");
        r.push(e);
    }
    t++;
    let l = 0, a = 128, C = 72;
    for (;t < o.length; ) {
        var i = l;
        for (let e = 1, r = 36; ;r += 36) {
            if (t >= o.length) throw new Error("invalid encoding");
            let A = o[t++];
            if (48 <= A && A <= 57) A -= 22; else {
                if (!(97 <= A && A <= 122)) throw new Error("invalid character " + A);
                A -= 97;
            }
            l += A * e;
            var g = r <= C ? 1 : r >= C + 26 ? 26 : r - C;
            if (A < g) break;
            e *= 36 - g;
        }
        var B = r.length + 1;
        let A = 0 == i ? l / 700 | 0 : l - i >> 1;
        A += A / B | 0;
        let e = 0;
        for (;455 < A; e += 36) A = A / 35 | 0;
        C = e + 36 * A / (A + 38) | 0, a += l / B | 0, l %= B, r.splice(l++, 0, a);
    }
    return r;
}

function is_zwnj_emoji(r, o) {
    var t = r.length;
    for (let e = Math.min(o, ZWNJ_EMOJI.length); 0 < e; e--) {
        var A = ZWNJ_EMOJI[e];
        if (A) A: for (var l of A) {
            let A = o - e;
            for (var a of l) {
                if (A >= t) continue A;
                if (65039 !== r[A]) {
                    if (a != r[A++]) continue A;
                } else A++;
            }
            return !0;
        }
    }
    return !1;
}

function is_disallowed(A) {
    return lookup_member(DISALLOWED, A);
}

function is_ignored(A) {
    return lookup_member(IGNORED, A);
}

function get_mapped(A) {
    return lookup_mapped(MAPPED, A)?.slice();
}

class DisallowedLabelError extends Error {
    constructor(A, e) {
        super(`Disallowed label "${escape_unicode(str_from_cp(...e))}": ` + A), this.codePoints = e;
    }
}

class DisallowedCharacterError extends Error {
    constructor(A, e = "") {
        super(`Disallowed character "${escape_unicode(str_from_cp(A))}"` + (e ? ": " + e : "")), 
        this.codePoint = A;
    }
}

function nfc_idna_contextj_emoji(o, A = !1) {
    const t = [];
    return nfc(o.map((e, r) => {
        if (is_disallowed(e)) {
            if (A) return t;
            throw new DisallowedCharacterError(e);
        }
        if (is_ignored(e)) return t;
        if (8204 === e) {
            if (0 < r && lookup_member(VIRAMA, o[r - 1])) return e;
            if (0 < r && r < o.length - 1) {
                let A = r - 1;
                for (;0 < A && lookup_member(JOIN_T, o[A]); ) A--;
                if (lookup_member(JOIN_LD, o[A])) {
                    let A = r + 1;
                    for (;A < o.length - 1 && lookup_member(JOIN_T, o[A]); ) A++;
                    if (lookup_member(JOIN_RD, o[A])) return e;
                }
            }
            if (A) return t;
            throw new DisallowedCharacterError(e, "ZWJ outside of context");
        }
        if (8205 !== e) return lookup_mapped(MAPPED, e) ?? e;
        if (0 < r && lookup_member(VIRAMA, o[r - 1])) return e;
        if (is_zwnj_emoji(o, r)) return e;
        if (A) return t;
        throw new DisallowedCharacterError(e, "ZWNJ outside of context");
    }).flat());
}

function ens_normalize(A, e = !1, r = !0) {
    var o;
    let t = split(nfc_idna_contextj_emoji([ ...A ].map(A => A.codePointAt(0), e)), 46).map(e => {
        if (4 <= e.length && 45 == e[2] && 45 == e[3] && 120 == e[0] && 110 == e[1]) {
            let A;
            try {
                A = puny_decode(e.slice(4));
            } catch (A) {
                throw new DisallowedLabelError("punycode: " + A.message, e);
            }
            let r = nfc_idna_contextj_emoji(A, !0);
            if (A.length != r.length || !A.every((A, e) => A == r[e])) throw new DisallowedLabelError("puny not idna", e);
            e = A;
        }
        return e;
    });
    for (o of t) if (0 != o.length) {
        if (4 <= o.length && 45 == o[2] && 45 == o[3]) throw new DisallowedLabelError("invalid label extension", o);
        if (45 == o[0]) throw new DisallowedLabelError("leading hyphen", o);
        if (45 == o[o.length - 1]) throw new DisallowedLabelError("trailing hyphen", o);
        if (lookup_member(COMBINING_MARKS, o[0])) throw new DisallowedLabelError("leading combining mark", o);
    }
    if (r && t.some(A => A.some(A => lookup_member(BIDI.R_AL, A) || lookup_member(BIDI.AN, A)))) for (var l of t) if (0 != l.length) if (lookup_member(BIDI.R_AL, l[0])) {
        if (!l.every(A => lookup_member(BIDI.R_AL, A) || lookup_member(BIDI.AN, A) || lookup_member(BIDI.EN, A) || lookup_member(BIDI.ECTOB, A) || lookup_member(BIDI.NSM, A))) throw new DisallowedLabelError("bidi RTL: disallowed properties", l);
        let A = l.length - 1;
        for (;lookup_member(BIDI.NSM, l[A]); ) A--;
        if (A = l[A], !(lookup_member(BIDI.R_AL, A) || lookup_member(BIDI.EN, A) || lookup_member(BIDI.AN, A))) throw new DisallowedLabelError("bidi RTL: disallowed ending", l);
        var a = l.some(A => lookup_member(BIDI.EN, A)), C = l.some(A => lookup_member(BIDI.AN, A));
        if (a && C) throw new DisallowedLabelError("bidi RTL: AN+EN", l);
    } else {
        if (!lookup_member(BIDI.L, l[0])) throw new DisallowedLabelError("bidi without direction", l);
        {
            if (!l.every(A => lookup_member(BIDI.L, A) || lookup_member(BIDI.EN, A) || lookup_member(BIDI.ECTOB, A) || lookup_member(BIDI.NSM, A))) throw new DisallowedLabelError("bidi LTR: disallowed properties", l);
            let A = l.length - 1;
            for (;lookup_member(BIDI.NSM, l[A]); ) A--;
            if (A = l[A], !lookup_member(BIDI.L, A) && !lookup_member(BIDI.EN, A)) throw new DisallowedLabelError("bidi LTR: disallowed ending", l);
        }
    }
    return t.map(A => str_from_cp(...A)).join(str_from_cp(46));
}

function split(A, e) {
    let r = [], o = 0;
    for (;;) {
        var t = A.indexOf(e, o);
        if (-1 == t) break;
        r.push(A.slice(o, t)), o = t + 1;
    }
    return r.push(A.slice(o)), r;
}

export {
    VERSION,
    UNICODE,
    nfd,
    nfc,
    is_disallowed,
    is_ignored,
    get_mapped,
    DisallowedLabelError,
    DisallowedCharacterError,
    ens_normalize
};