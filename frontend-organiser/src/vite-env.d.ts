/// <reference types="vite/client" />

import { StringToBytesErrorType } from "viem"

interface ImportMetaEnv {
  readonly VITE_PROD: string
  readonly VITE_ETHEREUM_PRIVATE_KEY: string
  readonly VITE_PINATA_KEY: string
  readonly VITE_PINATA_SECRET: string
  readonly VITE_PINATA_JWT: string
  readonly VITE_PINATA_GATEWAY: string
  readonly VITE_ALCHEMY_KEY: string
  readonly VITE_DRPC_KEY: string
  readonly VITE_PIMLICO_KEY: string
  readonly VITE_ETHERSCAN_API_KEY: string
  readonly VITE_BACKEND_PROD: string
  readonly VITE_BACKEND_DEV: string
  readonly VITE_FRONTEND_PROD: string
  readonly VITE_FRONTEND_DEV: string
  readonly VITE_SURVEYSTORE_CONTRACT: string
  readonly VITE_L2: string
  readonly VITE_KUBO_ENDPOINT: string
  readonly VITE_LIT_NETWORK: string
  readonly VITE_ENTRYPOINT_ADDRESS_V07: string
  readonly VITE_USE_SAFE: string
  readonly VITE_HUMAN_NETWORK_SIGNER_URL: string

}

interface ImportMeta {
  readonly env: ImportMetaEnv
}

