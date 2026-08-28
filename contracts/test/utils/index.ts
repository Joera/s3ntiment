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
