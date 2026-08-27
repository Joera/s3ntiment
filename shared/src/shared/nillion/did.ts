import { base58btc } from 'multiformats/bases/base58';

export const publicKeyToDidKey = (publicKeyHex: string): string => {
    let pubKeyHex = publicKeyHex.replace('0x', '');
    
    if (pubKeyHex.length === 130 && pubKeyHex.startsWith('04')) {
        const x = BigInt('0x' + pubKeyHex.slice(2, 66));
        const y = BigInt('0x' + pubKeyHex.slice(66, 130));
        const prefix = (y % 2n === 0n) ? '02' : '03';
        pubKeyHex = prefix + pubKeyHex.slice(2, 66);
    }
    
    const pubKeyBytes = new Uint8Array(pubKeyHex.match(/.{2}/g)!.map(b => parseInt(b, 16)));
    const prefixedKey = new Uint8Array([0xe7, 0x01, ...pubKeyBytes]);
    
    const encoded = base58btc.encode(prefixedKey);
    return `did:key:${encoded}`;
};