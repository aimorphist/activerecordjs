/**
 * Package entry check: the published core subpath must not reach a Node
 * builtin, the postgres driver, or PGlite — through static imports, re-exports,
 * or dynamic import(). Walks our sources and the packages they import.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { builtinModules } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));

const builtins = new Set(builtinModules);
const FORBIDDEN_PACKAGES = new Set(['postgres', '@electric-sql/pglite']);

function packageName(spec: string): string {
	const parts = spec.split('/');
	return spec.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0];
}

function forbiddenReason(spec: string): string | null {
	if (spec.startsWith('node:')) return 'node: builtin';
	if (builtins.has(packageName(spec))) return 'node builtin';
	if (FORBIDDEN_PACKAGES.has(packageName(spec))) return 'driver package';
	return null;
}

/** Runtime specifiers: static import/export-from (not type-only), bare imports, dynamic import(). */
function runtimeSpecifiers(source: string): string[] {
	const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
	const specs: string[] = [];
	const fromRe = /\b(import|export)\s+(type\s+)?([^'"`;]*?)\s+from\s+['"]([^'"]+)['"]/g;
	for (const m of code.matchAll(fromRe)) {
		if (m[2]) continue; // import type / export type
		const clause = m[3].trim();
		// `import { type A, type B }` is erased too.
		const braced = clause.match(/^\{([\s\S]*)\}$/);
		if (braced && braced[1].split(',').every((s) => !s.trim() || /^type\s/.test(s.trim()))) continue;
		specs.push(m[4]);
	}
	for (const m of code.matchAll(/\bimport\s+['"]([^'"]+)['"]/g)) specs.push(m[1]);
	for (const m of code.matchAll(/\bimport\s*\(\s*['"`]([^'"`]+)['"`]\s*\)/g)) specs.push(m[1]);
	for (const m of code.matchAll(/\brequire\s*\(\s*['"]([^'"]+)['"]\s*\)/g)) specs.push(m[1]);
	return specs;
}

function resolveFile(base: string): string | null {
	const candidates = [base, `${base}.ts`, `${base}.js`, `${base}.mjs`, join(base, 'index.ts'), join(base, 'index.js')];
	for (const c of candidates) {
		if (existsSync(c) && statSync(c).isFile()) return c;
	}
	return null;
}

function pickExport(target: any): string | null {
	if (typeof target === 'string') return target;
	if (!target || typeof target !== 'object') return null;
	for (const key of ['import', 'module', 'default']) {
		if (key in target) {
			const picked = pickExport(target[key]);
			if (picked) return picked;
		}
	}
	return null;
}

function resolvePackage(spec: string, fromFile: string): string {
	const name = packageName(spec);
	const sub = spec.slice(name.length);
	let dir = dirname(fromFile);
	while (true) {
		const candidate = join(dir, 'node_modules', name);
		if (existsSync(join(candidate, 'package.json'))) {
			const meta = JSON.parse(readFileSync(join(candidate, 'package.json'), 'utf8'));
			const key = sub ? `.${sub}` : '.';
			const target = meta.exports ? pickExport(meta.exports[key] ?? (key === '.' ? meta.exports : undefined)) : null;
			const file = target
				? resolveFile(join(candidate, target))
				: resolveFile(join(candidate, sub || meta.module || meta.main || 'index.js'));
			if (!file) throw new Error(`cannot resolve ${spec} from ${fromFile}`);
			return file;
		}
		const parent = dirname(dir);
		if (parent === dir) throw new Error(`package not found: ${spec} (from ${fromFile})`);
		dir = parent;
	}
}

interface Offence {
	file: string;
	spec: string;
	reason: string;
}

function walk(entry: string): { files: Set<string>; offences: Offence[] } {
	const files = new Set<string>();
	const offences: Offence[] = [];
	const queue = [entry];
	while (queue.length) {
		const file = queue.pop()!;
		if (files.has(file)) continue;
		files.add(file);
		for (const spec of runtimeSpecifiers(readFileSync(file, 'utf8'))) {
			const reason = forbiddenReason(spec);
			if (reason) {
				offences.push({ file: file.replace(root + '/', ''), spec, reason });
				continue;
			}
			const next = spec.startsWith('.') ? resolveFile(resolve(dirname(file), spec)) : resolvePackage(spec, file);
			if (!next) throw new Error(`cannot resolve ${spec} from ${file}`);
			queue.push(next);
		}
	}
	return { files, offences };
}

function entryFile(subpath: string): string {
	const target = pkg.exports?.[subpath];
	expect(target, `package.json exports ${subpath}`).toBeTypeOf('string');
	return resolve(root, target);
}

describe('package entries', () => {
	it('publishes core, postgres-js, and node as separate subpaths', () => {
		const core = entryFile('.');
		const pg = entryFile('./postgres-js');
		const node = entryFile('./node');
		expect(new Set([core, pg, node]).size).toBe(3);
	});

	it('core import graph has no node: builtin, no postgres, no @electric-sql/pglite', () => {
		const { files, offences } = walk(entryFile('.'));
		expect(offences).toEqual([]);
		expect(files.has(entryFile('./node'))).toBe(false);
		expect(files.has(entryFile('./postgres-js'))).toBe(false);
	});

	it('the checker sees dynamic import() and flags forbidden specifiers', () => {
		const specs = runtimeSpecifiers(
			"import type { X } from 'postgres';\nconst m = await import('node:fs');\nexport { a } from './a';\nimport { type Y } from 'postgres';"
		);
		expect(specs).toEqual(['./a', 'node:fs']);
		expect(forbiddenReason('node:async_hooks')).toBe('node: builtin');
		expect(forbiddenReason('async_hooks')).toBe('node builtin');
		expect(forbiddenReason('postgres')).toBe('driver package');
		expect(forbiddenReason('@electric-sql/pglite')).toBe('driver package');
		expect(forbiddenReason('drizzle-orm')).toBeNull();
	});

	it('the checker catches a driver reached through a package (drizzle-orm/postgres-js)', () => {
		const pgEntry = walk(entryFile('./postgres-js'));
		expect(pgEntry.offences.some((o) => o.spec === 'postgres')).toBe(true);
	});

	it('postgres-js and node entries load without loading each other', () => {
		const pg = walk(entryFile('./postgres-js'));
		const node = walk(entryFile('./node'));
		expect(pg.files.has(entryFile('./node'))).toBe(false);
		expect(node.files.has(entryFile('./postgres-js'))).toBe(false);
		// node entry reaches node:async_hooks but no driver
		expect(node.offences.filter((o) => o.reason === 'driver package')).toEqual([]);
	});

	it('each published subpath loads as a module', async () => {
		const core = await import(/* @vite-ignore */ entryFile('.'));
		const pg = await import(/* @vite-ignore */ entryFile('./postgres-js'));
		const node = await import(/* @vite-ignore */ entryFile('./node'));
		expect(typeof core.Model).toBe('function');
		expect(typeof core.createScope).toBe('function');
		expect('setGlobalConnection' in core).toBe(false);
		expect('createActiveRecordJS' in core).toBe(false);
		expect('createConnection' in core).toBe(false);
		expect(typeof pg.createPostgresJsScope).toBe('function');
		expect(typeof pg.createConnection).toBe('function');
		expect(typeof node.createActiveRecordJS).toBe('function');
		expect(typeof node.setGlobalConnection).toBe('function');
		expect(typeof node.runWithConnection).toBe('function');
	});
});
