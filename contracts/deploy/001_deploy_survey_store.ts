import {deployScript, artifacts} from '../rocketh/deploy.js';

export default deployScript(
	async (env) => {
		// Get named accounts configured in rocketh/config.ts
		const {deployer, admin} = env.namedAccounts;

		const deployment = await env.deploy(
			'S3ntimentSurveyStore',
			{
				account: deployer,
				artifact: artifacts.S3ntimentSurveyStore,
				args: [],
			}
		);

		// Example: interact with the deployed contract using viem
		const contract = env.viem.getContract(deployment);
		const message = await contract.read.surveyExists(['0']);
		console.log(`Current survey count for deployer: "${message}"`);
	},
	// Tags allow selective deployment (e.g., --tags SurveyStore)
	// Dependencies can be specified with: dependencies: ['OtherContract']
	{tags: ['SurveyStore', 'SurveyStore_deploy']},
);
