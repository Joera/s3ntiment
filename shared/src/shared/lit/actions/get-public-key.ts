export const getPkpPublicKeyAction = `
async function main({ pkpId }) {
  const privateKey = await Lit.Actions.getPrivateKey({ pkpId });
  const wallet = new ethers.Wallet(privateKey);
  
  return { publicKey: wallet.publicKey, address: wallet.address };
}
`;