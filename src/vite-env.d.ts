/// <reference types="vite/client" />

declare module '*.worker.ts' {
  class WebpackWorker extends Worker {
    constructor();
  }

  export default WebpackWorker;
}
