export const ownerInvocationAction = (poolId: string, contract: string, safeAddress: string) => `
async function main({ signature, userAddress, pkpId, pkpDid, nodeDid, command }) {

    const provider = new ethers.providers.JsonRpcProvider('https://base-mainnet.g.alchemy.com/v2/NFOkRqUo2swIC9g5tRJ7c');

    const signerAddress = ethers.utils.verifyMessage(
        'Request owner invocation',
        signature
    );

    const isValid = signerAddress.toLowerCase() === userAddress.toLowerCase();

    if (!isValid) {
        return { error: 'INVALID_SIGNATURE' }
    }
    
    const poolContract = new ethers.Contract(
        '${contract}',
        ['function isPoolSafe(address addr, string poolId) view returns (bool)'],
        provider
    );
    
    if (!await poolContract.isPoolSafe('${safeAddress}', '${poolId}')) {
        return { error: 'Safe is not pool owner' };
    }


    const safe = new ethers.Contract(
        '${safeAddress}',
        ['function isOwner(address owner) view returns (bool)'],
        provider
    );
    
    if (!await safe.isOwner(userAddress)) {
        return { error: 'Not a Safe signer' };
    }


    try {
        const privateKey = await Lit.Actions.getPrivateKey({ pkpId });
        const wallet = new ethers.Wallet(privateKey);
        
        const header = {
            typ: 'nuc',
            alg: 'ES256K',
            ver: '1.0.0'
        };
        
        const payload = {
            iss: pkpDid, 
            aud: nodeDid, 
            sub: pkpDid, 
            cmd: command,
            args: {},
            exp: Math.floor(Date.now() / 1000) + 30,
            nonce: Array.from({length: 32}, () => Math.floor(Math.random() * 16).toString(16)).join(''),
            prf: []
        };
        
        const b64url = (obj) => {
            const str = JSON.stringify(obj);
            const b64 = btoa(str);
            return b64.replace(/[+]/g, '-').replace(/[/]/g, '_').replace(/=+$/g, '');
        };
        
        const headerB64 = b64url(header);
        const payloadB64 = b64url(payload);
        const message = headerB64 + '.' + payloadB64;
        
        const msgBytes = new TextEncoder().encode(message);
        const hashBuffer = await crypto.subtle.digest('SHA-256', msgBytes);
        const hashArray = new Uint8Array(hashBuffer);
        const hashHex = '0x' + Array.from(hashArray).map(b => b.toString(16).padStart(2, '0')).join('');
        
        const sig = wallet._signingKey().signDigest(hashHex);
        
        const r = sig.r.slice(2);
        const s = sig.s.slice(2);
        const sigHex = r + s;
        
        const sigBytes = new Uint8Array(sigHex.match(/.{2}/g).map(byte => parseInt(byte, 16)));
        const sigB64 = btoa(String.fromCharCode(...sigBytes))
            .replace(/[+]/g, '-').replace(/[/]/g, '_').replace(/=+$/g, '');
        
        const invocation = headerB64 + '.' + payloadB64 + '.' + sigB64;
        
        return { invocation };
    } catch (e) {
        return { error: e.message, stack: e.stack };
    }
}
`;