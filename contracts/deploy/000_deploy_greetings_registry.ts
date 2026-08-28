import {deployScript, artifacts} from '../rocketh/deploy.js';

// Deploys the GreetingsRegistry contract that the existing
// `test/GreetingsRegistry.test.ts` suite exercises. The contract source was
// removed from the repo while its test was left behind; restoring this
// deployment keeps that pre-existing test runnable.
export default deployScript(
	async (env) => {
		const {deployer} = env.namedAccounts;

		await env.deploy('GreetingsRegistry', {
			account: deployer,
			artifact: artifacts.GreetingsRegistry,
			// Empty prefix matches the test's expectation that a greeting is
			// stored verbatim (no prefix prepended).
			args: [''],
		});
	},
	{tags: ['GreetingsRegistry', 'GreetingsRegistry_deploy']},
);
