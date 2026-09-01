import { IServices } from "../services/services";

export const authenticate = async (services:IServices) => {
    const input = await services.waap.signMessage(`Sign into your unlinkable account`); 
    const key = await services.oprf.getSecp256k1(input)
    await services.safe.updateSignerWithKey(key);

    // After the stealth-key login completes, the waap SDK leaves its fixed
    // full-viewport modal overlay (#waap-wallet-iframe-container) mounted over
    // the whole app, swallowing every pointer event (so #next-btn in the survey
    // builder never receives clicks). Hide it now that auth is done. Runs after
    // the login step that legitimately needs the iframe, before the router shows
    // /surveys.
    services.waap.hideModal?.();
}