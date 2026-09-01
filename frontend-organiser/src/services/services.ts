/// <reference types="vite/client" />

import { 
  ViemService,
  PermissionlessSafeService,
  PermissionlessSimpleService,
  LitService,
  IPFSMethods
} from "@s3ntiment/shared";

import { OPRFService, WaapService } from "@s3ntiment/shared/browser"


import { base } from "viem/chains";
import { authenticate } from "../factories/auth.factory";

export interface IServices {
  waap: WaapService;
  viem: ViemService;
  lit: LitService;
  account: PermissionlessSimpleService;
  safe: PermissionlessSafeService;
  ipfs: IPFSMethods;
  oprf: OPRFService;
  isInitialized: () => boolean;
}

export class ServiceContainer {
  private static instance: ServiceContainer | null = null;
  private initialized = false;
  
  public waap!: WaapService;
  public lit!: LitService;
  public account!: PermissionlessSimpleService;
  public safe!: PermissionlessSafeService;
  public viem!: ViemService;
  public ipfs!: IPFSMethods;
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
    
    this.viem = new ViemService(base, import.meta.env.VITE_ALCHEMY_KEY, import.meta.env.VITE_DRPC_KEY);
    this.waap = new WaapService();
    this.safe = new PermissionlessSafeService(base, import.meta.env.VITE_PIMLICO_KEY, import.meta.env.VITE_ALCHEMY_KEY, import.meta.env.VITE_ENTRYPOINT_ADDRESS_V07, import.meta.env.VITE_DRPC_KEY);
    this.account = new PermissionlessSimpleService(base, import.meta.env.VITE_PIMLICO_KEY, import.meta.env.VITE_ALCHEMY_KEY, import.meta.env.VITE_ENTRYPOINT_ADDRESS_V07, import.meta.env.VITE_DRPC_KEY);
 
    const litEnv = import.meta.env.VITE_LIT_NETWORK == "prod" ? "prod" : "dev";
    console.log("LITENV", litEnv)
    this.lit = new LitService({ "environment": litEnv});
    
    this.ipfs = new IPFSMethods(import.meta.env.VITE_KUBO_ENDPOINT, import.meta.env.VITE_PINATA_JWT, import.meta.env.VITE_PINATA_GATEWAY)
    this.oprf = new OPRFService(import.meta.env.VITE_HUMAN_NETWORK_SIGNER_URL);

    await this.waap.login(base)
    await this.oprf.init();

    this.initialized = true;
  }
  
  isInitialized(): boolean {
    return this.initialized;
  }
}

// Export the getter, not an instance
export const getServices = () => ServiceContainer.getInstance();