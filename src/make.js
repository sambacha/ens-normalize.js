import {CHARS, EMOJI} from '@adraffy/ensip-norm';
import {Encoder, unsafe_btoa} from './encoder.js';
import {readFileSync, writeFileSync} from 'node:fs';

// combining_rank  => https://www.unicode.org/Public/14.0.0/ucd/extracted/DerivedCombiningClass.txt 
// decomp          => https://www.unicode.org/Public/14.0.0/ucd/DerivedNormalizationProps.txt
// comp_exclusions => https://www.unicode.org/Public/14.0.0/ucd/CompositionExclusions.txt
let {combining_rank, decomp, comp_exclusions} = JSON.parse(readFileSync(new URL('./nf.json', import.meta.url)));

// https://www.unicode.org/Public/14.0.0/ucd/DerivedNormalizationProps.txt
// NFC_QC where NFC_Quick_Check = No/Maybe
let nfc_qc = JSON.parse(readFileSync(new URL('./nfc-qc.json', import.meta.url)));

// union of non-zero combining class + nfc_qc
let nfc_check = [...new Set([combining_rank, nfc_qc].flat(Infinity))];

class Node {
	constructor() {
		this.branches = {};
	}
	get nodes() {
		return Object.values(this.branches).reduce((a, x) => a + 1 + x.nodes, 0);
	}
	add(cp) {
		if (cp == 0xFE0F) {
			this.fe0f = true;
			return this;
		}
		let node = this.branches[cp];
		if (!node) this.branches[cp] = node = new Node();
		return node;
	}
	scan(fn, path = []) {
		fn(this, path);
		for (let [k, node] of Object.entries(this.branches)) {
			node.scan(fn, [...path, [k, node]]);
		}
	}
	collapse_nodes(memo = {}) {
		for (let [k, node] of Object.entries(this.branches)) {
			node.collapse_nodes(memo);
			let key = JSON.stringify(node);
			let dup = memo[key];
			if (dup) {
				this.branches[k] = dup;
			} else {
				memo[key] = node;
			}
		}
	}
	collapse_keys() {
		let m = Object.entries(this.branches);
		let u = this.branches = {};
		while (m.length) {
			let [key, node] = m.pop();
			u[[...m.filter(kv => kv[1] === node).map(kv => kv[0]), key].sort().join()] = node;
			m = m.filter(kv => kv[1] !== node);
			node.collapse_keys();
		}
	}
}

// insert every emoji sequence
let root = new Node();
for (let cps of EMOJI) {
	let node = root;
	for (let cp of cps) {
		node = node.add(cp);
	}
	node.valid = true;
}

// there are sequences of the form:
// a__ MOD b__ MOD2 c__
// where MOD != MOD2 (5x4 = 20 combinations)
// if we remember the first mod, 
// we can pretend the second mod is non-exclusionary (5x5)
// which allows further compression 
// (12193 to 11079 bytes -> saves 1KB, ~10%)
let modifier_set = new Set(['127995', '127996', '127997', '127998', '127999']); // 1F3FB..1F3FF
root.scan((node, path) => {
	// find nodes that are missing 1 modifier
	let v = Object.keys(node.branches);
	if (v.length != modifier_set.size - 1) return; // missing 1
	if (!v.every(k => modifier_set.has(k))) return; // all mods
	// where another modifier already exists in the path
	let m = path.filter(kv => modifier_set.has(kv[0]));
	if (m.length == 0) return;
	let parent = m[m.length - 1][1]; // find closest
	// complete the map so we can collapse
	for (let cp of modifier_set) {
		if (!node.branches[cp]) {
			node.branches[cp] = node.branches[v[0]]; // fake branch
			break;
		}
	}
	// set save on the first modifier
	parent.save_mod = true;
	// set check on the second modifiers
	for (let b of Object.values(node.branches)) {
		b.check_mod = true;
	}
});

// check every emoji sequence for non-standard FE0F handling
for (let cps0 of EMOJI) {
	let node = root;
	let bits = 0;
	let index = 0;
	for (let i = 0; i < cps0.length; ) {
		let cp = cps0[i++];
		node = node.branches[cp];
		if (node.fe0f) {
			if (i < cps0.length && cps0[i] == 0xFE0F) {
				i++;
			} else {
				if (index != 0) throw new Error('expected first FE0F');
				if (i != 1) throw new Error('expected second character');
				bits |= 1 << index;
			}
			index++;
		}
	}
	node.bits = bits; // 0 or 1
}

// compress
console.log(`Before: ${root.nodes}`);
root.collapse_nodes();
root.collapse_keys();
console.log(`After: ${root.nodes}`);

function encode_emoji(enc, node, map) {
	for (let [keys, x] of Object.entries(node.branches)) {
		enc.write_member(keys.split(',').map(k => map[k]));
		encode_emoji(enc, x, map);
	}
	enc.write_member([]);
	let valid = node.bits ? 2 : node.valid ? 1 : 0;
	let mod = node.check_mod ? 2 : node.save_mod ? 1 : 0;
	let fe0f = node.fe0f ? 1 : 0;
	//enc.unsigned(6*valid + 2*mod + fe0f); // 11888
	//enc.unsigned(6*mod + 2*valid + fe0f); // 11866
	//enc.unsigned(9*fe0f + 3*mod + valid); // 11844
	enc.unsigned(6*mod + 3*fe0f + valid); // 11833
}

function unique_sorted(v) {
	return [...new Set(v)].sort((a, b) => a - b);
}
function index_map(v) {
	return Object.fromEntries(v.map((x, i) => [x, i]));
}

let sorted_valid = unique_sorted(CHARS.valid);
let sorted_valid_map = index_map(sorted_valid);

let sorted_emoji = unique_sorted(EMOJI.flat());
let sorted_emoji_map = index_map(sorted_emoji);

let enc = new Encoder();
enc.write_member(CHARS.valid);
enc.write_member(CHARS.ignored);
enc.write_mapped([
	[1, 1, 0], // adjacent that map to a constant
	[2, 1, 0], // eg. AAAA..BBBB => CCCC
	[1, 1, 1], // alphabets: ABC
	[1, 2, 2], // paired-alphabets: AaBbCc
//	[1, 2, 1],
//	[1, 3, 3],
//	[3, 1, 0],
//	[4, 1, 0],
], CHARS.mapped); //.map(kv => [kv[0], kv[1].map(x => sorted_valid_map[x])]));
enc.write_member(CHARS.cm.map(cp => sorted_valid_map[cp]));
enc.write_member(sorted_emoji);
encode_emoji(enc, root, sorted_emoji_map);
//write('include-only'); // only saves 300 bytes
enc.write_member(nfc_check.flatMap(cp => sorted_valid_map[cp] ?? []));
write('include-ens');

// just nf 
// (only ~30 bytes saved using joined file)
enc = new Encoder();
for (let v of combining_rank) enc.write_member(v);
enc.write_member([]);
enc.write_mapped([
	[1, 1, 0],
	[1, 1, 1],	
], decomp);
enc.write_member(comp_exclusions);
write('include-nf');

function write(name) {
	let buf = Buffer.from(enc.compressed());
	console.log(`${name} = ${buf.length} bytes`);
	let encoded = unsafe_btoa(buf);
	writeFileSync(new URL(`./${name}.js`, import.meta.url), [
		`// created ${new Date().toJSON()}`,
		`import {read_compressed_payload} from './decoder.js';`,
		`export default read_compressed_payload('${encoded}');`,
	].join('\n'));
}
