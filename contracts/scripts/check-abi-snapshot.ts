#!/usr/bin/env tsx
/**
 * ABI snapshot seam check (seam-coverage Pattern 2, nice-to-have).
 *
 * Verifies that the `abi` field the FRONTENDS import
 *   contracts/deployments/base/<Contract>.json   (rocketh deploy-export pipeline)
 * matches the `abi` that the CONTRACT TESTS compile / use
 *   artifacts/src/.../<Contract>.json            (hardhat compile emitted artifact)
 *   generated/abis/<Contract>.ts                 (generateTypedArtifacts — imported by tests)
 *
 * Why this exists: the two pipelines (rocketh deploy-export vs. hardhat compile)
 * can diverge and nothing cross-checks them today. A frontend that imports the
 * shipped deployment JSON would then send calldata against an ABI that no
 * longer matches the source the tests actually exercise.
 *
 * Dependency / fresh-checkout behaviour:
 *   - `deployments/base/*.json` is COMMITTED (ships in the workspace package).
 *   - `artifacts/` and `generated/` are BUILD ARTIFACTS and are NOT committed
 *     (gitignored). On a fresh checkout they are absent, so this script runs
 *     `pnpm compile` (hardhat compile) itself to (re)produce them before
 *     comparing. `pnpm install` already triggers `prepare` → `pnpm compile`,
 *     so in practice they exist; the explicit compile here makes the check
 *     self-sufficient regardless of how it is invoked.
 *
 * Fails loudly (exit code != 0) on any divergence; passes (exit 0) when the
 * ABIs are identical. Run with:
 *     pnpm check:abi            (or: npx tsx scripts/check-abi-snapshot.ts)
 */
import {execFileSync} from 'node:child_process';
import {existsSync, readdirSync, readFileSync} from 'node:fs';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';

const contractsDir = join(dirname(fileURLToPath(import.meta.url)), '..');
const deploymentsBaseDir = join(contractsDir, 'deployments', 'base');

const CHAIN = 'base';

function fail(msg: string): never {
	console.error(`\n[abi-snapshot] ✗ ${msg}\n`);
	process.exit(1);
}

function runCompile(): void {
	console.log(
		'[abi-snapshot] build artifacts missing — running `pnpm compile` (hardhat compile) …',
	);
	execFileSync('pnpm', ['compile'], {cwd: contractsDir, stdio: 'inherit'});
}

/** Extract the runtime `export const Abi_<Name> = [...]` array from a generated typed-Abi .ts file. */
function extractGeneratedAbi(file: string, contractName: string): unknown {
	const src = readFileSync(file, 'utf8');
	const marker = `export const Abi_${contractName}`;
	const start = src.indexOf(marker);
	if (start === -1) {
		fail(
			`generated typed ABI ${file} does not export \`${marker}\` — stale / unexpected generated output?`,
		);
	}
	const bracket = src.indexOf('[', start);
	const end = src.lastIndexOf(']');
	if (bracket === -1 || end === -1 || end <= bracket) {
		fail(`could not locate the ABI array literal in generated file ${file}`);
	}
	const core = src.slice(bracket, end + 1);
	try {
		return JSON.parse(core);
	} catch (err) {
		fail(
			`generated typed ABI ${file} is not parseable as JSON: ${String(err)}`,
		);
	}
}

/** Minimal structural diff: reports the first divergent path, if any. */
function firstDivergence(a: unknown, b: unknown, path = '$'): string | null {
	if (Object.is(a, b)) return null;
	if (
		typeof a !== 'object' ||
		typeof b !== 'object' ||
		a === null ||
		b === null
	) {
		return `${path}: expected ${JSON.stringify(a)}, got ${JSON.stringify(b)}`;
	}
	const aIsArr = Array.isArray(a);
	const bIsArr = Array.isArray(b);
	if (aIsArr !== bIsArr) {
		return `${path}: expected ${aIsArr ? 'array' : 'object'}, got ${bIsArr ? 'array' : 'object'}`;
	}
	if (aIsArr) {
		const aa = a as unknown[];
		const bb = b as unknown[];
		if (aa.length !== bb.length) {
			return `${path}: expected array length ${aa.length}, got ${bb.length}`;
		}
		for (let i = 0; i < aa.length; i++) {
			const d = firstDivergence(aa[i], bb[i], `${path}[${i}]`);
			if (d) return d;
		}
		return null;
	}
	const ka = Object.keys(a as Record<string, unknown>);
	const kb = Object.keys(b as Record<string, unknown>);
	for (const k of ka) {
		if (!(k in (b as Record<string, unknown>)))
			return `${path}.${k}: key missing in compiled ABI`;
		const d = firstDivergence(
			(a as Record<string, unknown>)[k],
			(b as Record<string, unknown>)[k],
			`${path}.${k}`,
		);
		if (d) return d;
	}
	for (const k of kb) {
		if (!(k in (a as Record<string, unknown>)))
			return `${path}.${k}: extra key in compiled ABI`;
	}
	return null;
}

function checkContract(contractName: string): void {
	const deploymentFile = join(deploymentsBaseDir, `${contractName}.json`);
	if (!existsSync(deploymentFile)) {
		fail(
			`deployment artifact ${deploymentFile} not found (this file is committed and should exist).`,
		);
	}
	const deploymentRaw = JSON.parse(readFileSync(deploymentFile, 'utf8'));
	const deploymentAbi = deploymentRaw.abi as unknown;
	if (!Array.isArray(deploymentAbi)) {
		fail(`deployment artifact ${deploymentFile} has no "abi" array.`);
	}
	const sourceName: string = deploymentRaw.sourceName;
	if (typeof sourceName !== 'string' || !sourceName.endsWith('.sol')) {
		fail(
			`deployment artifact ${deploymentFile} has no valid "sourceName" to locate the compiled artifact.`,
		);
	}

	// 1) The artifact `hardhat compile` emits.
	const artifactFile = join(
		contractsDir,
		'artifacts',
		sourceName,
		`${contractName}.json`,
	);
	if (!existsSync(artifactFile)) {
		runCompile();
		if (!existsSync(artifactFile)) {
			fail(
				`compiled artifact ${artifactFile} still missing after \`pnpm compile\` — did hardhat emit it?`,
			);
		}
	}
	const artifactAbi = JSON.parse(readFileSync(artifactFile, 'utf8'))
		.abi as unknown;
	if (!Array.isArray(artifactAbi)) {
		fail(`compiled artifact ${artifactFile} has no "abi" array.`);
	}

	// 2) The typed ABI the contract tests compile / use (generateTypedArtifacts).
	const generatedFile = join(
		contractsDir,
		'generated',
		'abis',
		`${contractName}.ts`,
	);
	if (!existsSync(generatedFile)) {
		runCompile();
		if (!existsSync(generatedFile)) {
			fail(
				`generated typed ABI ${generatedFile} still missing after \`pnpm compile\``,
			);
		}
	}
	const generatedAbi = extractGeneratedAbi(generatedFile, contractName);

	const checks: Array<[string, unknown]> = [
		[
			`hardhat compile artifact (${artifactFile.replace(`${contractsDir}/`, '')})`,
			artifactAbi,
		],
		[
			`typed ABI used by tests (${generatedFile.replace(`${contractsDir}/`, '')})`,
			generatedAbi,
		],
	];

	for (const [label, compiledAbi] of checks) {
		if (JSON.stringify(deploymentAbi) === JSON.stringify(compiledAbi)) continue;
		const diff =
			firstDivergence(deploymentAbi, compiledAbi) ?? 'ABIs differ (structural)';
		fail(
			[
				`frontend-imported ABI (${deploymentFile.replace(`${contractsDir}/`, '')}) DIVERGES from ${label}.`,
				`  first divergence: ${diff}`,
				'',
				'This means what the frontends ship/import no longer matches what the contract tests compile and use.',
				'Regenerate the deployment export from the compiled source (rocketh deploy-export) so the shipped ABI matches,',
				'e.g. `pnpm hardhat --network base deploy` + `pnpm rocketh-export -e base`.',
			].join('\n'),
		);
	}

	console.log(
		`[abi-snapshot] ✓ ${contractName}: deployment ABI (${CHAIN}) matches compile artifact + typed ABI (${(deploymentAbi as unknown[]).length} entries)`,
	);
}

const deploymentJsons = readdirSync(deploymentsBaseDir).filter((f) =>
	f.endsWith('.json'),
);
if (deploymentJsons.length === 0) {
	fail(`no committed deployments found under ${deploymentsBaseDir}.`);
}
for (const f of deploymentJsons) {
	checkContract(f.replace(/\.json$/, ''));
}
console.log(
	'[abi-snapshot] ✓ all checked contracts match (deployments/base vs. compiled ABI).',
);
