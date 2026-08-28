import {Abi_GreetingsRegistry} from '../../generated/abis/GreetingsRegistry.js';
import {Abi_S3ntimentSurveyStore} from '../../generated/abis/S3ntimentSurveyStore.js';
import {loadAndExecuteDeploymentsFromFiles} from '../../rocketh/environment.js';
import {EthereumProvider} from 'hardhat/types/providers';

export function setupSurveyStoreFixtures(provider: EthereumProvider) {
	return {
		async deployAll() {
			const env = await loadAndExecuteDeploymentsFromFiles({
				provider: provider,
			});

			const S3ntimentSurveyStore =
				env.get<Abi_S3ntimentSurveyStore>('S3ntimentSurveyStore');

			return {
				env,
				S3ntimentSurveyStore,
				namedAccounts: env.namedAccounts,
				unnamedAccounts: env.unnamedAccounts,
			};
		},
	};
}

export function setupFixtures(provider: EthereumProvider) {
	return {
		async deployAll() {
			const env = await loadAndExecuteDeploymentsFromFiles({
				provider: provider,
			});

			// Deployment are inherently untyped since they can vary from
			//  network or even be different from current artifacts so here
			//  we type them manually assuming the artifact is still matching
			const GreetingsRegistry =
				env.get<Abi_GreetingsRegistry>('GreetingsRegistry');

			return {
				env,
				GreetingsRegistry,
				namedAccounts: env.namedAccounts,
				unnamedAccounts: env.unnamedAccounts,
			};
		},
	};
}
