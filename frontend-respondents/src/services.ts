import { 
  ViemService,
  PermissionlessSimpleService,
  LitService,
  IPFSMethods,
  NillDBUserService
} from "@s3ntiment/shared";

import {
  WaapService,
  OPRFService
} from "@s3ntiment/shared/browser";



import { base } from "viem/chains";

export interface IServices {
  viem: ViemService;
  waap: WaapService;
  account: PermissionlessSimpleService;
  ipfs: IPFSMethods
  lit: LitService;
  nillDB: NillDBUserService;
  oprf: OPRFService;
}

export class ServiceContainer implements IServices {
  private static instance: ServiceContainer | null = null;
  private initialized = false;
  
  public viem!: ViemService;
  public waap!: WaapService;
  public account!: PermissionlessSimpleService;
  public ipfs!: IPFSMethods;
  public lit!: LitService;
  public nillDB!: NillDBUserService;
  public oprf!: OPRFService
  
  private constructor() {
    if (ServiceContainer.instance) {
      throw new Error('ServiceContainer already instantiated! Use ServiceContainer.getInstance()');
    }
    ServiceContainer.instance = this;
  }
  
  static getInstance(): ServiceContainer {
    if (!ServiceContainer.instance) {
      ServiceContainer.instance = new ServiceContainer();
    }
    return ServiceContainer.instance;
  }
  
  async initialize() {
    if (this.initialized) {
      console.warn('Services already initialized');
      return;
    }
    
    this.viem = new ViemService(base, import.meta.env.VITE_ALCHEMY_KEY, import.meta.env.VITE_DRPC_KEY)
    this.waap = new WaapService();
    this.account = new PermissionlessSimpleService(base, import.meta.env.VITE_PIMLICO_KEY, import.meta.env.VITE_ALCHEMY_KEY, import.meta.env.VITE_ENTRYPOINT_ADDRESS_V07, import.meta.env.VITE_DRPC_KEY);
    const litEnv = import.meta.env.VITE_LIT_NETWORK == "prod" ? "prod" : "dev";
    console.log("LITENV", litEnv)
    this.lit = new LitService({ "environment": litEnv});

    this.ipfs = new IPFSMethods(import.meta.env.VITE_KUBO_ENDPOINT, import.meta.env.VITE_PINATA_JWT, import.meta.env.VITE_PINATA_GATEWAY)
    this.nillDB = new NillDBUserService(import.meta.env.VITE_NIL_BUILDER_DID,  import.meta.env.VITE_NILDB_NODES);
    this.oprf = new OPRFService(import.meta.env.VITE_HUMAN_NETWORK_SIGNER_URL);

    // Deferred identity (RFC-deferred-identity-persistence): the eager WaaP
    // createWallet (pops the SDK) and OPRF wasm init were the entry-funnel cost
    // Task 1 removes from the random-bootstrap path. They are no longer called at
    // startup; the extracted humanWallet.factory (WaaP login + OPRF derive) will
    // re-establish them when the post-survey persist route runs.
    this.initialized = true;

    return;
  }
  
  isInitialized(): boolean {
    return this.initialized;
  }
}

// Export the getter, not an instance
export const getServices = () => ServiceContainer.getInstance();