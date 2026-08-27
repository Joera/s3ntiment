export const getDecryptForRespondentAction = (poolId: string, contract: string) => `
    async function main({ pkpId, ciphertext, userAddress, signature}) {

    const signerAddress = ethers.utils.verifyMessage(
        'Request capability to decrypt',
        signature
    );

    const isValid = signerAddress.toLowerCase() === userAddress.toLowerCase();

    if (!isValid) {
        return { error: 'INVALID_SIGNATURE' }
    }

    const provider = new ethers.providers.JsonRpcProvider('https://base-mainnet.g.alchemy.com/v2/NFOkRqUo2swIC9g5tRJ7c');

    const poolContract = new ethers.Contract(
        '${contract}',
        ['function isPoolMember(string poolId, address member) view returns (bool)'],
        provider
    );

    const isMember = await poolContract.isPoolMember('${poolId}', userAddress);
    console.log('ISMEMBER', isMember);
    
    if (!isMember) {
        return { error: 'Not a pool member' };
    }
  
    const plaintext = await Lit.Actions.Decrypt({ pkpId, ciphertext });
        return { plaintext };
    }
`;